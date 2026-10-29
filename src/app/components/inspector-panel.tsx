import { memo, useId, useState } from "react";
import {
  ChevronDown,
  Crop,
  Film,
  Frame,
  Image as ImageIcon,
  ImageDown,
  Info,
  Settings2,
  X,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Bounds } from "@/domain/export/layout";
import {
  MAX_MAX_FILE_SIZE_MEGABYTES,
  MIN_MAX_FILE_SIZE_MEGABYTES,
} from "@/domain/export/optimization";
import type { ExportFormat } from "@/domain/export/protocol";

import { ExportSettingsList } from "./export-settings-list";
import { IconButton } from "./icon-button";

export type ExportPanelSettings = {
  format: ExportFormat;
  width: number;
  height: number;
  autoFit: boolean;
  padding: number;
  fps: number;
  quality: number;
  sizeLimitEnabled: boolean;
  maxFileSizeMegabytes: number;
  transparent: boolean;
  background: string;
  framing: "auto" | "custom";
};

type InspectorPanelProps = {
  selectedAnimation: string;
  stackedLayers: number;
  duration: number;
  settings: ExportPanelSettings;
  capabilities: Record<ExportFormat, boolean>;
  customBounds: Bounds | null;
  cropEditing: boolean;
  exporting: boolean;
  busy: boolean;
  onSettingsChange: (settings: ExportPanelSettings) => void;
  onEditFrame: () => void;
  onResetFrame: () => void;
  onExport: () => void;
  onExportFrame: () => void;
  onClose?: () => void;
};

type ExportEditor =
  | "export-format"
  | "export-dimensions"
  | "export-frame-rate"
  | "export-quality"
  | "export-file-limit"
  | "export-frame";

const EXPORT_FORMATS = ["webm", "mp4", "gif"] as const satisfies readonly ExportFormat[];
const EXPORT_EDITORS = [
  "export-format",
  "export-dimensions",
  "export-frame-rate",
  "export-quality",
  "export-file-limit",
  "export-frame",
] as const satisfies readonly ExportEditor[];

function isExportEditor(value: string): value is ExportEditor {
  return EXPORT_EDITORS.some((editor) => editor === value);
}

const FORMAT_COPY = {
  webm: { label: "WebM", detail: "VP8 或 VP9 视频，可选透明。" },
  mp4: { label: "MP4", detail: "H.264 视频，使用纯色背景。" },
  gif: { label: "GIF", detail: "颜色有限的动态图。" },
} satisfies Record<ExportFormat, { label: string; detail: string }>;

const FORMAT_ITEMS = EXPORT_FORMATS.map((format) => ({
  label: FORMAT_COPY[format].label,
  value: format,
}));

function clampInteger(value: number, minimum: number, maximum: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
}

function clampFileSize(value: number): number {
  const finite = Number.isFinite(value) ? value : MIN_MAX_FILE_SIZE_MEGABYTES;
  return Math.min(MAX_MAX_FILE_SIZE_MEGABYTES, Math.max(MIN_MAX_FILE_SIZE_MEGABYTES, finite));
}

export const InspectorPanel = memo(function InspectorPanel({
  selectedAnimation,
  stackedLayers,
  duration,
  settings,
  capabilities,
  customBounds,
  cropEditing,
  exporting,
  busy,
  onSettingsChange,
  onEditFrame,
  onResetFrame,
  onExport,
  onExportFrame,
  onClose,
}: InspectorPanelProps) {
  const [activeEditor, setActiveEditor] = useState<ExportEditor | null>(null);
  const widthId = useId();
  const heightId = useId();
  const fpsId = useId();
  const qualityId = useId();
  const fileLimitId = useId();
  const maxFileSizeId = useId();
  const paddingId = useId();
  const transparentId = useId();
  const autoFitId = useId();
  const selectedFormatAvailable = capabilities[settings.format];
  const frameCount = duration > 0 ? Math.max(1, Math.ceil(duration * settings.fps)) : 0;
  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="动画导出">
      <header className="flex h-touch-target shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 workspace:h-control">
        <h2 className="truncate text-sm font-semibold">导出</h2>
        {onClose ? (
          <IconButton label="关闭导出面板" onClick={onClose}>
            <X />
          </IconButton>
        ) : null}
      </header>

      {frameCount === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Film aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>还没有可导出的内容</EmptyTitle>
            <EmptyDescription>打开资源包并选择一个动画，即可配置导出。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 p-3">
              <section className="flex flex-col gap-2" aria-labelledby="output-summary-title">
                <h3 id="output-summary-title" className="text-xs font-semibold">
                  输出概览
                </h3>
                <ExportSettingsList.Root
                  value={activeEditor}
                  onValueChange={(value) => {
                    if (value === null || isExportEditor(value)) setActiveEditor(value);
                  }}
                >
                  <ExportSettingsList.Item
                    id="export-format"
                    label="格式"
                    value={FORMAT_COPY[settings.format].label}
                  >
                    <FieldGroup className="gap-2">
                      <Field>
                        <FieldLabel htmlFor="export-format-select">导出格式</FieldLabel>
                        <Select
                          items={FORMAT_ITEMS}
                          value={settings.format}
                          onValueChange={(value) => {
                            const format = EXPORT_FORMATS.find((candidate) => candidate === value);
                            if (!format) return;
                            onSettingsChange({
                              ...settings,
                              format,
                              transparent: format === "mp4" ? false : settings.transparent,
                            });
                          }}
                        >
                          <SelectTrigger id="export-format-select" className="w-full">
                            <SelectValue>
                              {(format: ExportFormat) => FORMAT_COPY[format].label}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {EXPORT_FORMATS.map((format) => (
                                <SelectItem
                                  key={format}
                                  value={format}
                                  disabled={!capabilities[format]}
                                >
                                  {FORMAT_COPY[format].label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldDescription>{FORMAT_COPY[settings.format].detail}</FieldDescription>
                      </Field>
                    </FieldGroup>
                  </ExportSettingsList.Item>

                  <ExportSettingsList.Item
                    id="export-dimensions"
                    label="尺寸"
                    value={`${settings.autoFit ? "不超过 " : ""}${clampInteger(settings.width, 2, 4096)} × ${clampInteger(settings.height, 2, 4096)}`}
                    valueClassName="font-mono tracking-data tabular-nums"
                  >
                    <div className="flex items-end gap-2">
                      <Field className="min-w-0 flex-1">
                        <FieldLabel htmlFor={widthId}>
                          {settings.autoFit ? "最大宽度" : "宽度"}
                        </FieldLabel>
                        <Input
                          id={widthId}
                          type="number"
                          min={2}
                          max={4096}
                          value={settings.width}
                          className="font-mono"
                          onChange={(event) =>
                            onSettingsChange({ ...settings, width: Number(event.target.value) })
                          }
                          onBlur={() =>
                            onSettingsChange({
                              ...settings,
                              width: clampInteger(settings.width, 2, 4096),
                            })
                          }
                        />
                      </Field>
                      <span
                        className="pb-2 font-mono text-xs text-muted-foreground"
                        aria-hidden="true"
                      >
                        ×
                      </span>
                      <Field className="min-w-0 flex-1">
                        <FieldLabel htmlFor={heightId}>
                          {settings.autoFit ? "最大高度" : "高度"}
                        </FieldLabel>
                        <Input
                          id={heightId}
                          type="number"
                          min={2}
                          max={4096}
                          value={settings.height}
                          className="font-mono"
                          onChange={(event) =>
                            onSettingsChange({ ...settings, height: Number(event.target.value) })
                          }
                          onBlur={() =>
                            onSettingsChange({
                              ...settings,
                              height: clampInteger(settings.height, 2, 4096),
                            })
                          }
                        />
                      </Field>
                    </div>
                  </ExportSettingsList.Item>

                  <ExportSettingsList.Item
                    id="export-frame-rate"
                    label="帧率"
                    value={`${clampInteger(settings.fps, 1, 120)} FPS`}
                    valueClassName="font-mono tracking-data tabular-nums"
                  >
                    <Field>
                      <FieldLabel htmlFor={fpsId}>每秒帧数</FieldLabel>
                      <Input
                        id={fpsId}
                        type="number"
                        min={1}
                        max={120}
                        value={settings.fps}
                        className="font-mono"
                        onChange={(event) =>
                          onSettingsChange({ ...settings, fps: Number(event.target.value) })
                        }
                        onBlur={() =>
                          onSettingsChange({ ...settings, fps: clampInteger(settings.fps, 1, 120) })
                        }
                      />
                    </Field>
                  </ExportSettingsList.Item>

                  <ExportSettingsList.Item
                    id="export-quality"
                    label="质量"
                    value={`${Math.round(settings.quality * 100)}%`}
                    valueClassName="font-mono tracking-data tabular-nums"
                  >
                    <Field>
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel htmlFor={qualityId}>偏好质量</FieldLabel>
                        <output className="font-mono text-2xs tracking-data text-muted-foreground">
                          {Math.round(settings.quality * 100)}%
                        </output>
                      </div>
                      <Slider
                        id={qualityId}
                        aria-label="偏好导出质量"
                        min={10}
                        max={100}
                        step={5}
                        value={[settings.quality * 100]}
                        onValueChange={(values) => {
                          const value = Array.isArray(values) ? (values[0] ?? 80) : values;
                          onSettingsChange({ ...settings, quality: value / 100 });
                        }}
                      />
                      <FieldDescription>GIF 的质量决定调色板大小。</FieldDescription>
                    </Field>
                  </ExportSettingsList.Item>

                  <ExportSettingsList.Item
                    id="export-file-limit"
                    label="大小限制"
                    value={
                      settings.sizeLimitEnabled ? `${settings.maxFileSizeMegabytes} MB` : "不限制"
                    }
                    valueClassName={
                      settings.sizeLimitEnabled ? "font-mono tracking-data tabular-nums" : undefined
                    }
                  >
                    <FieldGroup className="gap-3">
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel htmlFor={fileLimitId}>限制文件大小</FieldLabel>
                          <FieldDescription>关闭限制时只编码一次。</FieldDescription>
                        </FieldContent>
                        <Switch
                          id={fileLimitId}
                          checked={settings.sizeLimitEnabled}
                          onCheckedChange={(sizeLimitEnabled) =>
                            onSettingsChange({ ...settings, sizeLimitEnabled })
                          }
                        />
                      </Field>
                      {settings.sizeLimitEnabled ? (
                        <Field>
                          <FieldLabel htmlFor={maxFileSizeId}>最大体积（MB）</FieldLabel>
                          <Input
                            id={maxFileSizeId}
                            type="number"
                            inputMode="decimal"
                            min={MIN_MAX_FILE_SIZE_MEGABYTES}
                            max={MAX_MAX_FILE_SIZE_MEGABYTES}
                            step={0.1}
                            value={settings.maxFileSizeMegabytes}
                            className="font-mono"
                            onChange={(event) =>
                              onSettingsChange({
                                ...settings,
                                maxFileSizeMegabytes: Number(event.target.value),
                              })
                            }
                            onBlur={() =>
                              onSettingsChange({
                                ...settings,
                                maxFileSizeMegabytes: clampFileSize(settings.maxFileSizeMegabytes),
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <Alert>
                        <Info aria-hidden="true" />
                        <AlertDescription>
                          限制体积可能更久，因为可能会多次编码。会先降低质量，再缩小尺寸，帧率和时长保持不变。
                        </AlertDescription>
                      </Alert>
                    </FieldGroup>
                  </ExportSettingsList.Item>

                  <ExportSettingsList.Item
                    id="export-frame"
                    label="画面"
                    value={settings.framing === "custom" ? "自定义" : "整段"}
                  >
                    <div className="flex flex-col gap-3">
                      <ToggleGroup
                        className="grid w-full grid-cols-2"
                        variant="outline"
                        size="sm"
                        value={[settings.framing]}
                        onValueChange={(values) => {
                          const framing = values[0];
                          if (framing === "auto" || framing === "custom") {
                            onSettingsChange({ ...settings, framing });
                          }
                        }}
                        aria-label="导出画面"
                      >
                        <ToggleGroupItem value="auto">整段</ToggleGroupItem>
                        <ToggleGroupItem value="custom">自定义</ToggleGroupItem>
                      </ToggleGroup>
                      {settings.framing === "custom" ? (
                        <div className="rounded-lg bg-primary-soft p-3">
                          <div className="flex items-start gap-2">
                            <Frame
                              className="mt-0.5 size-icon shrink-0 text-focus"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold">
                                {customBounds ? "自定义选框已就绪" : "在画布上绘制选框"}
                              </p>
                              {customBounds ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {customBounds.width.toFixed(1)} × {customBounds.height.toFixed(1)}
                                  {" Spine 单位"}
                                </p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button size="sm" onClick={onEditFrame}>
                                  <Crop data-icon="inline-start" />
                                  {cropEditing
                                    ? "正在编辑"
                                    : customBounds
                                      ? "编辑选框"
                                      : "绘制选框"}
                                </Button>
                                {customBounds ? (
                                  <Button size="sm" variant="ghost" onClick={onResetFrame}>
                                    重置
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </ExportSettingsList.Item>
                </ExportSettingsList.Root>
              </section>

              {!selectedFormatAvailable ? (
                <Alert>
                  <Info aria-hidden="true" />
                  <AlertDescription className="text-warning">
                    此浏览器无法编码 {FORMAT_COPY[settings.format].label}。请改用其他格式。
                  </AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <Collapsible>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="group/advanced w-full justify-start px-2 text-left"
                    />
                  }
                >
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <Settings2 data-icon="inline-start" aria-hidden="true" />
                    画布与背景
                  </span>
                  <ChevronDown
                    data-icon="inline-end"
                    className="ml-auto text-muted-foreground transition-transform group-data-panel-open/advanced:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FieldGroup className="gap-4 pt-4">
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor={autoFitId}>裁掉空白画布</FieldLabel>
                        <FieldDescription>
                          {settings.framing === "custom"
                            ? "裁到自定义选框。框外的动作会被切掉。"
                            : "测量每一帧导出画面，再裁掉空白的一边。"}
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id={autoFitId}
                        checked={settings.autoFit}
                        onCheckedChange={(autoFit) => onSettingsChange({ ...settings, autoFit })}
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor={paddingId}>边缘留白</FieldLabel>
                      <Input
                        id={paddingId}
                        type="number"
                        min={0}
                        max={2047}
                        value={settings.padding}
                        className="font-mono"
                        onChange={(event) =>
                          onSettingsChange({ ...settings, padding: Number(event.target.value) })
                        }
                        onBlur={() =>
                          onSettingsChange({
                            ...settings,
                            padding: clampInteger(settings.padding, 0, 2047),
                          })
                        }
                      />
                    </Field>

                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor={transparentId}>透明背景</FieldLabel>
                        <FieldDescription>
                          {settings.format === "mp4" ? "MP4 使用底色。" : "保留透明通道。"}
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id={transparentId}
                        disabled={settings.format === "mp4"}
                        checked={settings.transparent && settings.format !== "mp4"}
                        onCheckedChange={(transparent) =>
                          onSettingsChange({ ...settings, transparent })
                        }
                      />
                    </Field>

                    {!settings.transparent || settings.format === "mp4" ? (
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel htmlFor={`${transparentId}-matte`}>底色</FieldLabel>
                          <FieldDescription className="font-mono text-2xs tracking-data">
                            {settings.background.toUpperCase()}
                          </FieldDescription>
                        </FieldContent>
                        <Input
                          id={`${transparentId}-matte`}
                          type="color"
                          value={settings.background}
                          className="size-control p-1"
                          onChange={(event) =>
                            onSettingsChange({ ...settings, background: event.target.value })
                          }
                        />
                      </Field>
                    ) : null}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <footer className="flex shrink-0 flex-col gap-2 border-t border-border-soft p-3">
            <output className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
              <span className="block truncate">
                动画 <span className="font-medium text-foreground">{selectedAnimation}</span>
                {stackedLayers > 0 ? ` + ${stackedLayers} 个叠加` : null}
              </span>
              <span className="block truncate font-mono tracking-data tabular-nums">
                {settings.autoFit ? "不超过 " : ""}
                {clampInteger(settings.width, 2, 4096)} × {clampInteger(settings.height, 2, 4096)}
                {` · ${frameCount} 帧 · ${duration.toFixed(2)} 秒`}
              </span>
            </output>
            <Button
              className="w-full"
              disabled={busy || !selectedFormatAvailable}
              onClick={onExport}
            >
              {exporting ? (
                <Spinner data-icon="inline-start" />
              ) : settings.format === "gif" ? (
                <ImageIcon data-icon="inline-start" />
              ) : (
                <Film data-icon="inline-start" />
              )}
              {exporting
                ? "导出中…"
                : settings.sizeLimitEnabled
                  ? `导出 ${FORMAT_COPY[settings.format].label}，不超过 ${settings.maxFileSizeMegabytes} MB`
                  : `导出 ${FORMAT_COPY[settings.format].label}`}
            </Button>
            <Button variant="outline" className="w-full" disabled={busy} onClick={onExportFrame}>
              <ImageDown data-icon="inline-start" />
              将此帧存为 PNG
            </Button>
          </footer>
        </>
      )}
    </section>
  );
});
