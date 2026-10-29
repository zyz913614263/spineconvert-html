#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <regex>
#include <string>
#include <vector>

#include "SkeletonData.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SPINE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SPINE_EXPORT
#endif

namespace {

enum class SpineVersion {
    version33 = 0,
    version34,
    version35,
    version36,
    version37,
    version38,
    version40,
    version41,
    version42,
    invalid = -1,
};

enum class FileFormat {
    json = 0,
    skel = 1,
};

std::vector<std::uint8_t> outputBuffer;
std::string lastError;
std::string detectedVersion;

SpineVersion parseVersionFamily(const std::string& version) {
    static const std::regex completeVersion(R"(^(\d+)\.(\d+)\.(\d+)$)");
    std::smatch match;
    if (!std::regex_match(version, match, completeVersion)) return SpineVersion::invalid;

    const std::string family = match[1].str() + "." + match[2].str();
    if (family == "3.3") return SpineVersion::version33;
    if (family == "3.4") return SpineVersion::version34;
    if (family == "3.5") return SpineVersion::version35;
    if (family == "3.6") return SpineVersion::version36;
    if (family == "3.7") return SpineVersion::version37;
    if (family == "3.8") return SpineVersion::version38;
    if (family == "4.0") return SpineVersion::version40;
    if (family == "4.1") return SpineVersion::version41;
    if (family == "4.2") return SpineVersion::version42;
    return SpineVersion::invalid;
}

SpineVersion detectVersion(const std::uint8_t* data, std::size_t size) {
    if (data == nullptr || size == 0) return SpineVersion::invalid;
    static const std::regex versionPattern(R"((\d+)\.(\d+)\.(\d+))");

    std::size_t firstContent = 0;
    if (size >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf) firstContent = 3;
    while (firstContent < size && std::isspace(static_cast<unsigned char>(data[firstContent]))) {
        firstContent += 1;
    }
    if (firstContent < size && data[firstContent] == '{') {
        try {
            const Json json = Json::parse(data + firstContent, data + size);
            if (json.contains("skeleton") && json["skeleton"].is_object()) {
                const Json& skeleton = json["skeleton"];
                if (skeleton.contains("spine") && skeleton["spine"].is_string()) {
                    const std::string declaredVersion = skeleton["spine"].get<std::string>();
                    std::smatch match;
                    if (std::regex_search(declaredVersion, match, versionPattern)) {
                        detectedVersion = match[0].str();
                        return parseVersionFamily(detectedVersion);
                    }
                }
            }
        } catch (...) {
            // readData reports the JSON parse error during conversion.
        }
    }

    const std::size_t headerSize = std::min<std::size_t>(size, 512);
    const std::string header(reinterpret_cast<const char*>(data), headerSize);
    std::smatch match;
    if (!std::regex_search(header, match, versionPattern)) return SpineVersion::invalid;

    detectedVersion = match[0].str();
    return parseVersionFamily(detectedVersion);
}

SkeletonData readData(
    SpineVersion version,
    FileFormat format,
    const std::uint8_t* data,
    std::size_t size
) {
    Binary binary(data, data + size);
    Json json;
    if (format == FileFormat::json) {
        json = Json::parse(binary.begin(), binary.end());
    }

    switch (version) {
        case SpineVersion::version33:
            return format == FileFormat::skel ? spine33::readBinaryData(binary) : spine33::readJsonData(json);
        case SpineVersion::version34:
            return format == FileFormat::skel ? spine34::readBinaryData(binary) : spine34::readJsonData(json);
        case SpineVersion::version35:
            return format == FileFormat::skel ? spine35::readBinaryData(binary) : spine35::readJsonData(json);
        case SpineVersion::version36:
            return format == FileFormat::skel ? spine36::readBinaryData(binary) : spine36::readJsonData(json);
        case SpineVersion::version37:
            return format == FileFormat::skel ? spine37::readBinaryData(binary) : spine37::readJsonData(json);
        case SpineVersion::version38:
            return format == FileFormat::skel ? spine38::readBinaryData(binary) : spine38::readJsonData(json);
        case SpineVersion::version40:
            return format == FileFormat::skel ? spine40::readBinaryData(binary) : spine40::readJsonData(json);
        case SpineVersion::version41:
            return format == FileFormat::skel ? spine41::readBinaryData(binary) : spine41::readJsonData(json);
        case SpineVersion::version42:
            return format == FileFormat::skel ? spine42::readBinaryData(binary) : spine42::readJsonData(json);
        case SpineVersion::invalid:
            break;
    }
    throw std::runtime_error("Unsupported input Spine version");
}

void normalizeAcrossFamilies(
    SkeletonData& skeleton,
    SpineVersion inputVersion,
    SpineVersion outputVersion,
    bool removeCurves
) {
    const bool inputIs4x = inputVersion >= SpineVersion::version40;
    const bool outputIs4x = outputVersion >= SpineVersion::version40;

    if (inputIs4x && !outputIs4x) {
        convertSpacingMode4xTo3x(skeleton);
        convertRotateTimeline4xTo3x(skeleton);
        if (!removeCurves) {
            convertCurve4xTo3x(skeleton);
        }
    } else if (!inputIs4x && outputIs4x) {
        convertRotateTimeline3xTo4x(skeleton);
        if (!removeCurves) {
            convertCurve3xTo4x(skeleton);
        }
    }

    if (removeCurves) removeCurve(skeleton);

    if (inputVersion >= SpineVersion::version42 && outputVersion <= SpineVersion::version41) {
        convertOrder42ToBelow(skeleton);
    }
}

void ensureDefaultSkin(SkeletonData& skeleton) {
    const auto defaultSkin = std::find_if(
        skeleton.skins.begin(),
        skeleton.skins.end(),
        [](const Skin& skin) { return skin.name == "default"; }
    );
    if (defaultSkin == skeleton.skins.end()) {
        Skin skin;
        skin.name = "default";
        skeleton.skins.insert(skeleton.skins.begin(), skin);
    }
}

Binary writeBinary(SpineVersion version, SkeletonData& skeleton) {
    // Upstream binary writers subtract the default skin from the skin count.
    // Add it when absent to prevent unsigned underflow.
    ensureDefaultSkin(skeleton);
    switch (version) {
        case SpineVersion::version33: return spine33::writeBinaryData(skeleton);
        case SpineVersion::version34: return spine34::writeBinaryData(skeleton);
        case SpineVersion::version35: return spine35::writeBinaryData(skeleton);
        case SpineVersion::version36: return spine36::writeBinaryData(skeleton);
        case SpineVersion::version37: return spine37::writeBinaryData(skeleton);
        case SpineVersion::version38: return spine38::writeBinaryData(skeleton);
        case SpineVersion::version40: return spine40::writeBinaryData(skeleton);
        case SpineVersion::version41: return spine41::writeBinaryData(skeleton);
        case SpineVersion::version42: return spine42::writeBinaryData(skeleton);
        case SpineVersion::invalid: break;
    }
    throw std::runtime_error("Unsupported output Spine version");
}

Json writeJson(SpineVersion version, const SkeletonData& skeleton) {
    switch (version) {
        case SpineVersion::version33: return spine33::writeJsonData(skeleton);
        case SpineVersion::version34: return spine34::writeJsonData(skeleton);
        case SpineVersion::version35: return spine35::writeJsonData(skeleton);
        case SpineVersion::version36: return spine36::writeJsonData(skeleton);
        case SpineVersion::version37: return spine37::writeJsonData(skeleton);
        case SpineVersion::version38: return spine38::writeJsonData(skeleton);
        case SpineVersion::version40: return spine40::writeJsonData(skeleton);
        case SpineVersion::version41: return spine41::writeJsonData(skeleton);
        case SpineVersion::version42: return spine42::writeJsonData(skeleton);
        case SpineVersion::invalid: break;
    }
    throw std::runtime_error("Unsupported output Spine version");
}

}  // namespace

extern "C" {

SPINE_EXPORT const char* st_detect_version(const std::uint8_t* data, std::size_t size) {
    lastError.clear();
    detectedVersion.clear();
    try {
        if (detectVersion(data, size) == SpineVersion::invalid) {
            lastError = "Could not detect a supported Spine version in the input header";
            return nullptr;
        }
        return detectedVersion.c_str();
    } catch (const std::exception& exception) {
        lastError = exception.what();
        return nullptr;
    } catch (...) {
        lastError = "Unknown version detection error";
        return nullptr;
    }
}

SPINE_EXPORT int st_convert(
    const std::uint8_t* input,
    std::size_t inputSize,
    int inputFormatValue,
    int outputFormatValue,
    const char* outputVersionValue,
    int removeCurvesValue
) {
    outputBuffer.clear();
    lastError.clear();
    detectedVersion.clear();

    try {
        if (input == nullptr || inputSize == 0) throw std::runtime_error("Input file is empty");
        if (inputFormatValue < 0 || inputFormatValue > 1) throw std::runtime_error("Invalid input format");
        if (outputFormatValue < 0 || outputFormatValue > 1) throw std::runtime_error("Invalid output format");
        if (outputVersionValue == nullptr) throw std::runtime_error("Output version is required");

        const SpineVersion inputVersion = detectVersion(input, inputSize);
        if (inputVersion == SpineVersion::invalid) {
            throw std::runtime_error("Input must be a Spine 3.3-4.2 JSON or SKEL file with a complete version header");
        }

        const std::string outputVersionString(outputVersionValue);
        const SpineVersion outputVersion = parseVersionFamily(outputVersionString);
        if (outputVersion == SpineVersion::invalid) {
            throw std::runtime_error("Output version must be a complete 3.3.x-4.2.x version");
        }

        const auto inputFormat = static_cast<FileFormat>(inputFormatValue);
        const auto outputFormat = static_cast<FileFormat>(outputFormatValue);
        SkeletonData skeleton = readData(inputVersion, inputFormat, input, inputSize);
        skeleton.version = outputVersionString;
        normalizeAcrossFamilies(skeleton, inputVersion, outputVersion, removeCurvesValue != 0);

        if (outputFormat == FileFormat::skel) {
            outputBuffer = writeBinary(outputVersion, skeleton);
        } else {
            const std::string json = dumpJson(writeJson(outputVersion, skeleton));
            outputBuffer.assign(json.begin(), json.end());
        }
        return 0;
    } catch (const std::exception& exception) {
        lastError = exception.what();
        outputBuffer.clear();
        return 1;
    } catch (...) {
        lastError = "Unknown conversion error";
        outputBuffer.clear();
        return 1;
    }
}

SPINE_EXPORT const std::uint8_t* st_output_data() {
    return outputBuffer.empty() ? nullptr : outputBuffer.data();
}

SPINE_EXPORT std::size_t st_output_size() {
    return outputBuffer.size();
}

SPINE_EXPORT const char* st_last_error() {
    return lastError.c_str();
}

}  // extern "C"
