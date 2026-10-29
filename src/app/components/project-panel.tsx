import { memo, useCallback, useId, useMemo, useState, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ChevronDown,
  FileArchive,
  FileImage,
  FileJson2,
  Repeat2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { SkeletonFormat, SpineAssetBundle } from "@/domain/spine/assets";
import { isSupportedVersion, type SpineVersionFamily } from "@/domain/spine/version";
import type { PremultipliedAlphaMode } from "@/render/spine-renderer";
import { cn } from "@/lib/utils";

import { IconButton } from "./icon-button";

export type ConversionPanelSettings = {
  family: SpineVersionFamily;
  version: string;
  format: SkeletonFormat;
  removeCurves: boolean;
};

const ALPHA_MODES = [
  "auto",
  "premultiplied",
  "straight",
] as const satisfies readonly PremultipliedAlphaMode[];

const ALPHA_MODE_LABELS = {
  auto: "自动（跟随图集）",
  premultiplied: "预乘",
  straight: "直通",
} satisfies Record<PremultipliedAlphaMode, string>;

const SKELETON_FORMATS = ["json", "skel"] as const satisfies readonly SkeletonFormat[];

const ALPHA_MODE_ITEMS = ALPHA_MODES.map((mode) => ({
  label: ALPHA_MODE_LABELS[mode],
  value: mode,
}));

const SKELETON_FORMAT_ITEMS = SKELETON_FORMATS.map((format) => ({
  label: format.toUpperCase(),
  value: format,
}));

function alphaModeLabel(mode: string): string {
  const known = ALPHA_MODES.find((candidate) => candidate === mode);
  return known ? ALPHA_MODE_LABELS[known] : mode;
}

export type ConversionDownload = {
  version: string;
  format: SkeletonFormat;
};

type ProjectPanelProps = {
  bundle: SpineAssetBundle | null;
  version: string | null;
  settings: ConversionPanelSettings;
  families: readonly SpineVersionFamily[];
  busy: boolean;
  loading: boolean;
  converting: boolean;
  download: ConversionDownload | null;
  premultipliedAlpha: PremultipliedAlphaMode;
  atlasPremultipliedAlpha: boolean;
  onPremultipliedAlphaChange: (mode: PremultipliedAlphaMode) => void;
  onChooseFiles: () => void;
  onDropFiles: (files: FileList) => void;
  onSettingsChange: (settings: ConversionPanelSettings) => void;
  onConvert: () => void;
  onDownload: () => void;
  /** Closes the mobile drawer. */
  onClose?: () => void;
};

/** Shows loaded files and conversion settings. */
export const ProjectPanel = memo(function ProjectPanel({
  bundle,
  version,
  settings,
  families,
  busy,
  loading,
  converting,
  download,
  premultipliedAlpha,
  atlasPremultipliedAlpha,
  onPremultipliedAlphaChange,
  onChooseFiles,
  onDropFiles,
  onSettingsChange,
  onConvert,
  onDownload,
  onClose,
}: ProjectPanelProps) {
  const familyId = useId();
  const versionId = useId();
  const formatId = useId();
  const curvesId = useId();
  const alphaId = useId();
  const versionErrorId = `${versionId}-error`;
  const [dragging, setDragging] = useState(false);
  const normalizedVersion = settings.version.trim();
  const versionValid =
    isSupportedVersion(normalizedVersion) && normalizedVersion.startsWith(`${settings.family}.`);
  const accepting = !busy;
  const familyItems = useMemo(
    () => families.map((family) => ({ label: `Spine ${family}`, value: family })),
    [families],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (accepting) setDragging(true);
    },
    [accepting],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // SAFETY: a drag's related target is an element of this document or null.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      if (accepting && event.dataTransfer.files.length > 0) onDropFiles(event.dataTransfer.files);
    },
    [accepting, onDropFiles],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="工程与转换">
      <header className="flex h-touch-target shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 workspace:h-control">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold">工程</h2>
          <p className="truncate text-2xs text-muted-foreground">
            {bundle ? `${bundle.pageNames.length + 2} 个文件` : "空"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {version ? (
            <Badge
              variant="secondary"
              className="font-mono tracking-data text-focus"
              title={`源资源包由 Spine ${version} 制作`}
            >
              {version}
            </Badge>
          ) : null}
          {onClose ? (
            <IconButton label="关闭工程面板" onClick={onClose}>
              <X />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col transition-colors",
          dragging && "bg-primary-soft/40",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-3">
            {bundle ? (
              <div className="flex flex-col gap-1" aria-label="已加载文件">
                <FileRow
                  icon={<FileJson2 />}
                  label="骨骼"
                  name={bundle.skeleton.name}
                  detail={bundle.skeletonFormat.toUpperCase()}
                />
                <FileRow
                  icon={<FileArchive />}
                  label="图集"
                  name={bundle.atlas.name}
                  detail={`${bundle.pageNames.length} 页`}
                />
                <FileRow
                  icon={<FileImage />}
                  label="贴图"
                  name={bundle.pageNames.join(", ")}
                  detail={String(bundle.pageNames.length)}
                />
                <Field className="pt-3">
                  <FieldLabel htmlFor={alphaId}>贴图 Alpha</FieldLabel>
                  <Select
                    items={ALPHA_MODE_ITEMS}
                    value={premultipliedAlpha}
                    onValueChange={(value) => {
                      const mode = ALPHA_MODES.find((candidate) => candidate === value);
                      if (mode) onPremultipliedAlphaChange(mode);
                    }}
                  >
                    <SelectTrigger id={alphaId} className="w-full">
                      <SelectValue>{(mode: string) => alphaModeLabel(mode)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="auto">自动</SelectItem>
                        <SelectItem value="premultiplied">预乘</SelectItem>
                        <SelectItem value="straight">直通</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {premultipliedAlpha === "auto"
                      ? `图集声明为${atlasPremultipliedAlpha ? "预乘" : "直通"} Alpha。如果边缘发黑或发白，可以改掉它。`
                      : "正在覆盖图集设置。预览和导出都会使用这项。"}
                  </FieldDescription>
                </Field>

                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 w-full justify-start text-muted-foreground"
                  disabled={!accepting}
                  onClick={onChooseFiles}
                >
                  {loading ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Upload data-icon="inline-start" />
                  )}
                  打开其他资源包
                </Button>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "flex min-h-control items-center gap-2 rounded-lg border border-dashed border-border bg-canvas px-3 py-2 text-xs text-muted-foreground transition-colors",
                    dragging && "border-primary bg-primary-soft/40 text-foreground",
                    accepting && !dragging && "hover:border-primary hover:bg-primary-soft/30",
                    !accepting && "opacity-60",
                  )}
                  aria-label="把完整的 Spine 资源包拖到这里"
                >
                  {loading ? (
                    <Spinner className="size-icon text-primary" aria-hidden="true" />
                  ) : (
                    <Upload className="size-icon text-cyan" aria-hidden="true" />
                  )}
                  <span>{loading ? "正在打开资源包…" : "把完整资源包拖到这里"}</span>
                </div>

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck
                    className="mt-0.5 size-icon shrink-0 text-success"
                    aria-hidden="true"
                  />
                  解析、渲染、转换和编码都在这台设备上完成。
                </p>
              </>
            )}

            {bundle ? <Separator /> : null}

            {bundle ? (
              <Collapsible defaultOpen>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="group/collapse h-auto w-full justify-start px-2 py-2 text-left"
                    />
                  }
                >
                  <div>
                    <h3 className="text-sm font-semibold">转换版本</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      生成兼容的 JSON 或 SKEL 数据。
                    </p>
                  </div>
                  <ChevronDown
                    data-icon="inline-end"
                    className="ml-auto text-muted-foreground transition-transform group-data-panel-open/collapse:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FieldGroup className="gap-4 pt-4">
                    <Field>
                      <FieldLabel htmlFor={familyId}>目标系列</FieldLabel>
                      <Select
                        items={familyItems}
                        value={settings.family}
                        onValueChange={(value) => {
                          const family = families.find((candidate) => candidate === value);
                          if (family) onSettingsChange({ ...settings, family });
                        }}
                      >
                        <SelectTrigger id={familyId} className="w-full">
                          <SelectValue>{(family: string) => `Spine ${family}`}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {families.map((family) => (
                              <SelectItem key={family} value={family}>
                                Spine {family}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-2">
                      <Field data-invalid={!versionValid}>
                        <FieldLabel htmlFor={versionId}>精确版本</FieldLabel>
                        <Input
                          id={versionId}
                          value={settings.version}
                          inputMode="decimal"
                          className="font-mono"
                          aria-invalid={!versionValid}
                          aria-describedby={!versionValid ? versionErrorId : undefined}
                          onChange={(event) =>
                            onSettingsChange({ ...settings, version: event.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={formatId}>格式</FieldLabel>
                        <Select
                          items={SKELETON_FORMAT_ITEMS}
                          value={settings.format}
                          onValueChange={(value) => {
                            const format = SKELETON_FORMATS.find(
                              (candidate) => candidate === value,
                            );
                            if (format) onSettingsChange({ ...settings, format });
                          }}
                        >
                          <SelectTrigger id={formatId} className="w-full font-mono">
                            <SelectValue>{(format: string) => format.toUpperCase()}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="json">JSON</SelectItem>
                              <SelectItem value="skel">SKEL</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    {!versionValid ? (
                      <FieldError id={versionErrorId} className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 size-icon shrink-0" aria-hidden="true" />
                        <span>
                          请填写完整的 {settings.family}.x 版本，例如{" "}
                          <span className="font-mono">{settings.family}.0</span>。
                        </span>
                      </FieldError>
                    ) : null}

                    <Field orientation="horizontal" className="rounded-lg bg-surface-raised p-3">
                      <FieldContent>
                        <FieldLabel htmlFor={curvesId}>去除跨代曲线</FieldLabel>
                        <FieldDescription>只在兼容性比缓动精度更重要时使用。</FieldDescription>
                      </FieldContent>
                      <Switch
                        id={curvesId}
                        checked={settings.removeCurves}
                        onCheckedChange={(removeCurves) =>
                          onSettingsChange({ ...settings, removeCurves })
                        }
                        aria-label="去除跨代曲线"
                      />
                    </Field>

                    <Button
                      className="w-full"
                      disabled={!bundle || busy || !versionValid}
                      onClick={onConvert}
                    >
                      {converting ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Repeat2 data-icon="inline-start" />
                      )}
                      {converting ? "转换中…" : "转换资源包"}
                    </Button>

                    {download ? (
                      <Button className="w-full" variant="secondary" onClick={onDownload}>
                        <ArrowDownToLine data-icon="inline-start" />
                        保存 {download.format.toUpperCase()}（{download.version}）
                      </Button>
                    ) : null}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        </ScrollArea>

        {dragging ? (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-workspace/70">
            <p className="text-sm font-semibold">
              {bundle ? "松开以替换资源包" : "松开以放入完整资源包"}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
});

function FileRow({
  icon,
  label,
  name,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  detail: string;
}) {
  return (
    <Item size="xs" className="min-w-0 flex-nowrap border-0">
      <ItemMedia variant="icon" className="text-cyan" aria-hidden="true">
        {icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <p className="text-2xs font-medium tracking-data text-muted-foreground uppercase">
          {label}
        </p>
        <ItemTitle className="block truncate text-xs" title={name}>
          {name}
        </ItemTitle>
      </ItemContent>
      <span className="shrink-0 font-mono text-2xs tracking-data text-muted-foreground uppercase">
        {detail}
      </span>
    </Item>
  );
}
