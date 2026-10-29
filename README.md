# Spine Thing

Spine Thing 是一个跑在浏览器里的 Spine 动画查看器、JSON/SKEL 转换器和媒体导出工具。它读取 Spine 3.3 到 4.2 的 JSON 与 SKEL 文件，可在支持的版本与格式之间转换，并用官方 Spine WebGL 运行时预览。本地资源不会离开这台设备。画廊模式会从配置好的服务器以只读方式下载资源包，并放进同一个工作区。

## 运行

请使用 Node.js 20.19 或同系列的更新版本，或者 Node.js 22.12 及以上。浏览器还需要支持 WebGL。

```sh
npm ci
npm run dev
```

打开 Vite 打印出的本地地址。在画布模式下，请一次性选择或拖入完整资源包：

- 一份 JSON 或二进制骨骼，也包括 Unity 风格名称，例如 `.json.bytes`、`.skel.bytes`
- 一份图集，也包括 `.atlas.txt`
- 图集中列出的每一张 PNG、JPEG 或 WebP 贴图页

加载器会先检查文件结构和字节签名，再回退到文件名或 MIME 类型。转换与媒体编码都在专用 Worker 中运行。

导出 GIF 不依赖 WebCodecs。导出 WebM 需要通过 `VideoEncoder` 支持 VP8 或 VP9，导出 MP4 需要支持 H.264。应用会检测这些编解码器，并禁用浏览器无法编码的格式。

## 部署到 Vercel

把公开的 GitHub 仓库导入 Vercel。构建命令使用 `npm run build`，输出目录使用 `dist`；对 Vite 项目，Vercel 通常会自动识别这两项。

生产构建会生成 `robots.txt`、`sitemap.xml`、规范链接、Open Graph 元数据和结构化应用数据。公开站点地址按以下顺序解析：

1. 显式配置的 `SITE_URL`；
2. Vercel 系统变量 `VERCEL_PROJECT_PRODUCTION_URL`；
3. 本地构建回退地址 `https://spine-thing.vercel.app/`。

请在 Vercel 项目中开启 **Automatically expose System Environment Variables**，或将 `SITE_URL` 设为完整的生产地址。使用自定义域名时尤其重要。部署后请检查 `/robots.txt` 和 `/sitemap.xml`，把站点加入 Google Search Console，并提交站点地图。搜索引擎决定何时、是否收录；这些文件让部署后的应用可被抓取，并提供预期的规范链接。

若希望在 GitHub 上更容易被发现，请给公开仓库写一句简洁的 About 描述，把 Vercel 部署地址设为网站，并添加相关主题，例如 `spine`、`spine-animation`、`animation-viewer`、`webgl`、`wasm`、`skeleton-animation`。

## 画廊源

内置源列表在 `src/config/gallery-sources.json`。默认包含十个目录，其中包括 [`langrisser-spiner-db` 目录](https://github.com/OldBernhardt/langrisser-spiner-db)。用户可在画廊模式中添加其他 HTTP 或 HTTPS 清单地址。浏览器必须能在主机的 CORS 策略下拉取每个清单及其资源。

开发时设置 `VITE_GALLERY_MANIFEST_URL`，可替换第一个内置清单地址。通过界面添加的自定义源会保存在该设备的本地存储中。

版本 1 清单可以声明 `skeleton`、`atlas` 和 `textures`，也可以提供 `assets` 数组，按内容识别角色。相对资源地址会相对清单地址解析。应用可以校验声明的字节数和 SHA-256 摘要。

TanStack Query 会取消已放弃的请求，并对网络或服务器失败重试。它会缓存目录和已选资源包。请求不携带凭据。加载器 ID 通过 `src/services/gallery-client.ts` 中的本地注册表解析；清单不能加载远程代码。可用 `registerGalleryBundleLoader` 注册应用自有的加载器。

## 支持矩阵

| 能力         | 3.3 | 3.4 | 3.5 | 3.6 | 3.7 | 3.8 | 4.0 | 4.1 | 4.2 |
| ------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JSON 读写    | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  |
| SKEL 读写    | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  |
| 跨版本转换   | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  | 是  |

转换器会根据文件内容检测输入版本。请填写完整的 `major.minor.patch` 目标版本，因为转换器会把该值写入输出。降级无法保留旧版 Spine 格式表达不了的数据，所以请保留源文件，并在目标运行时中验证结果。转换下载只包含骨骼数据。应用会用图集和贴图做预览，但不会改写它们。

## 实现说明

- 来自 `SpineSkeletonDataConverter` 的 C++ 读写核心，经内存 C API 编译为 WebAssembly。`native/source.lock.json` 记录了已提交产物所用的 commit。
- 转换器会生成规范的 Spine 4.2 JSON 供预览。下载请求走另一次独立转换，因此预览归一化不会改动下载文件。
- 导出动画前，渲染器会采样每个输出时间戳，并合并附件包围盒。自动尺寸会保持合并后的宽高比，应用请求的留白，并把宽高当作上限。
- 编码 Worker 将 GIF 帧输入限制在 512 MiB，并用 modern-gif 编码。Mediabunny 通过浏览器的 `VideoEncoder` 写出 VP9 或 VP8 的 WebM，以及 H.264 的 MP4。

数据流见 [docs/architecture.md](docs/architecture.md)，原生构建细节见 [native/README.md](native/README.md)。

## 开发

运行全部必要检查：

```sh
npm run verify
```

该命令会检查格式、lint 规则、单元测试、生产构建和 Playwright 测试。也可以单独运行每一步：

```sh
npm run typecheck
npm run test
npm run lint
npm run format
npm run build
npm run test:e2e
```

项目使用 TypeScript 7、具备类型感知的 Oxlint 规则，以及 Oxfmt。仓库会跟踪生成的转换器文件，因此前端开发不需要安装 Emscripten。

重建转换器前请先安装 Emscripten：

```sh
npm run build:converter
```

默认构建使用 `native/source.lock.json` 中的 commit。若旁边有干净且匹配的同级检出，会优先使用；否则使用缓存检出。运行 `npm run build:converter:update` 可解析配置的 ref，并在编译成功后更新 lock。`SPINE_CONVERTER_COMMIT` 用于指定精确 commit，更新命令会把它记入 lock。`SPINE_CONVERTER_SOURCE` 可指定本地检出且不改 lock，`EMXX` 用于选择 Emscripten C++ 编译器。

Playwright 矩阵覆盖全部九个支持版本系列的 JSON 读取、JSON 写入，以及 JSON → SKEL → JSON 往返。其他浏览器测试覆盖本地上传、画廊加载、WebGL 预览、叠加动画、PNG 截取，以及 GIF、WebM 和可用的 MP4 下载。当旁边有匹配的转换器检出时，reference-corpus 测试会检查真实的 JSON 与 SKEL 导出结果。

## 许可

Spine Thing 的原创项目代码采用宽松的 [MIT License](LICENSE)。该许可允许对原创代码进行使用、修改、分发、再许可和商业使用。

MIT 许可不会重新授权第三方组件。完整构建还集成了带有额外下游条件的软件：

- 官方 Spine 运行时有自己的许可，可能要求每位用户持有 Spine Editor 许可；
- 转换器核心以及生成的 `public/wasm/converter.js` 和 `public/wasm/converter.wasm` 产物仍受 PolyForm Noncommercial 1.0.0 约束，因此完整构建不能无限制商用；
- 其余第三方包仍遵循各自许可。

再分发应用前，请阅读 [第三方声明](THIRD_PARTY_NOTICES.md) 以及随构建产物一起提供的声明。
