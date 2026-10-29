import {
  memo,
  useCallback,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import {
  Bone,
  ChevronFirst,
  ChevronLast,
  Crop,
  GalleryVerticalEnd,
  ImageDown,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { Bounds } from "@/domain/export/layout";
import type { AnimationInfo, RenderState } from "@/render/spine-renderer";
import { cn } from "@/lib/utils";

import { AnimationLayerPicker, AnimationPicker } from "./animation-picker";
import { IconButton } from "./icon-button";
import { usePlayhead, type PlaybackClock } from "../playback-clock";
import { useProjectedBounds, useZoomPercent, type ViewStore } from "../view-store";

export type FrameDragAction =
  | "draw"
  | "move"
  | "northWest"
  | "northEast"
  | "southWest"
  | "southEast";

const FRAME_HANDLE_LABELS = {
  northWest: "左上角",
  northEast: "右上角",
  southWest: "左下角",
  southEast: "右下角",
} as const satisfies Record<Exclude<FrameDragAction, "draw" | "move">, string>;

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const;
const SPEED_ITEMS = SPEEDS.map((speed) => ({ label: `${speed}×`, value: String(speed) }));

type PreviewStageProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  clock: PlaybackClock;
  viewStore: ViewStore;
  hasSource: boolean;
  animations: readonly AnimationInfo[];
  layers: readonly string[];
  skins: readonly string[];
  selectedSkin: string;
  renderState: RenderState;
  debug: boolean;
  looping: boolean;
  speed: number;
  fps: number;
  cropEditing: boolean;
  emptyMode: "canvas" | "gallery";
  customBounds: Bounds | null;
  exportWidth: number;
  exportHeight: number;
  onChooseFiles: () => void;
  onDropFiles: (files: FileList) => void;
  onAnimationChange: (name: string) => void;
  onLayersChange: (names: readonly string[]) => void;
  onSkinChange: (name: string) => void;
  onFit: () => void;
  onToggleDebug: () => void;
  onToggleCrop: () => void;
  onResetFrame: () => void;
  onExportFrame: () => void;
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onCanvasPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onCanvasPointerEnd: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onCanvasWheel: (event: WheelEvent<HTMLCanvasElement>) => void;
  onFramePointerDown: (event: ReactPointerEvent<HTMLElement>, action: FrameDragAction) => void;
  onFrameKeyDown: (event: ReactKeyboardEvent<HTMLElement>, action: FrameDragAction) => void;
  onPlayingChange: (playing: boolean) => void;
  onToggleLoop: () => void;
  onStepFrames: (frames: number) => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
};

/** Renders the animation canvas and its playback controls. */
export const PreviewStage = memo(function PreviewStage({
  canvasRef,
  clock,
  viewStore,
  hasSource,
  animations,
  layers,
  skins,
  selectedSkin,
  renderState,
  debug,
  looping,
  speed,
  fps,
  cropEditing,
  emptyMode,
  customBounds,
  exportWidth,
  exportHeight,
  onChooseFiles,
  onDropFiles,
  onAnimationChange,
  onLayersChange,
  onSkinChange,
  onFit,
  onToggleDebug,
  onToggleCrop,
  onResetFrame,
  onExportFrame,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerEnd,
  onCanvasWheel,
  onFramePointerDown,
  onFrameKeyDown,
  onPlayingChange,
  onToggleLoop,
  onStepFrames,
  onSeek,
  onSpeedChange,
}: PreviewStageProps) {
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const hasPlayableClip = Boolean(renderState.animation && renderState.duration > 0);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // SAFETY: a drag's related target is an element of this document or null.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      if (event.dataTransfer.files.length > 0) onDropFiles(event.dataTransfer.files);
    },
    [onDropFiles],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      setTouched(true);
      onCanvasPointerDown(event);
    },
    [onCanvasPointerDown],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      setTouched(true);
      onCanvasWheel(event);
    },
    [onCanvasWheel],
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-canvas" aria-label="动画预览工作区">
      <header className="flex h-touch-target shrink-0 items-center justify-between gap-2 border-b border-border-soft bg-workspace px-2 medium:h-control">
        {hasSource ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <AnimationPicker
              animations={animations}
              selected={renderState.animation ?? ""}
              onChange={onAnimationChange}
            />

            {animations.length > 1 ? (
              <AnimationLayerPicker
                animations={animations}
                base={renderState.animation ?? ""}
                layers={layers}
                onChange={onLayersChange}
              />
            ) : null}

            {skins.length > 1 ? (
              <Select
                items={skins.map((skin) => ({ label: skin, value: skin }))}
                value={selectedSkin}
                onValueChange={(value) => onSkinChange(value ?? "")}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="选择皮肤"
                  className="w-24 shrink-0 border-transparent bg-surface compact:w-32 medium:w-40"
                >
                  <SelectValue className="min-w-0 truncate" placeholder="皮肤">
                    {(skin: string) => (
                      <>
                        <span className="shrink-0 text-2xs font-medium text-muted-foreground">
                          皮肤
                        </span>
                        <span className="truncate">{skin}</span>
                      </>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectGroup>
                    {skins.map((skin) => (
                      <SelectItem key={skin} value={skin}>
                        {skin}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : (
          <p className="truncate px-1 text-xs text-muted-foreground">
            官方 Spine WebGL 运行时 · 3.3–4.2 资源包
          </p>
        )}

        {hasSource ? (
          <div className="flex shrink-0 items-center gap-1" role="toolbar" aria-label="画布工具">
            <div className="hidden items-center gap-1 medium:flex">
              <IconButton label="适配完整骨骼" shortcut="F" onClick={onFit}>
                <Maximize />
              </IconButton>
              <IconButton
                label={debug ? "隐藏骨骼调试" : "显示骨骼调试"}
                shortcut="B"
                active={debug}
                onClick={onToggleDebug}
              >
                <Bone />
              </IconButton>
              <IconButton
                label={cropEditing ? "完成导出框" : "绘制导出框"}
                shortcut="C"
                active={cropEditing}
                onClick={onToggleCrop}
              >
                <Crop />
              </IconButton>
              <IconButton
                label="将此帧存为透明 PNG"
                shortcut="Ctrl Shift E"
                onClick={onExportFrame}
              >
                <ImageDown />
              </IconButton>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground medium:hidden"
                    aria-label="画布工具"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem className="max-medium:min-h-touch-target" onClick={onFit}>
                    <Maximize />
                    适配完整骨骼
                    <DropdownMenuShortcut>F</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="max-medium:min-h-touch-target"
                    onClick={onToggleDebug}
                  >
                    <Bone />
                    {debug ? "隐藏骨骼调试" : "显示骨骼调试"}
                    <DropdownMenuShortcut>B</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="max-medium:min-h-touch-target"
                    onClick={onToggleCrop}
                  >
                    <Crop />
                    {cropEditing ? "完成导出框" : "绘制导出框"}
                    <DropdownMenuShortcut>C</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="max-medium:min-h-touch-target"
                    disabled={!customBounds}
                    onClick={onResetFrame}
                  >
                    <RotateCcw />
                    重置自定义选框
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="max-medium:min-h-touch-target"
                    onClick={onExportFrame}
                  >
                    <ImageDown />
                    将此帧存为 PNG
                    <DropdownMenuShortcut>Ctrl Shift E</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </header>

      <ContextMenu disabled={!hasSource}>
        <ContextMenuTrigger
          render={
            <div
              className={cn(
                "relative min-h-0 flex-1 overflow-hidden bg-canvas",
                cropEditing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          }
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 size-full touch-none"
            aria-label="Spine 动画预览。拖动平移，滚轮缩放，或使用适配重置镜头。"
            onPointerDown={handlePointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerEnd}
            onPointerCancel={onCanvasPointerEnd}
            onWheel={handleWheel}
          />

          {!hasSource ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <Empty className="pointer-events-auto max-w-prose border-0">
                <EmptyHeader>
                  <EmptyMedia
                    variant="icon"
                    className="size-12 rounded-2xl bg-primary-soft text-focus"
                  >
                    {emptyMode === "gallery" ? (
                      <GalleryVerticalEnd aria-hidden="true" />
                    ) : (
                      <Upload aria-hidden="true" />
                    )}
                  </EmptyMedia>
                  <EmptyTitle className="text-xl">
                    {emptyMode === "gallery" ? "选择一个托管动画" : "把动画放到画面中央"}
                  </EmptyTitle>
                  <EmptyDescription className="max-w-prose">
                    {emptyMode === "gallery"
                      ? "打开画廊面板，选中一个 Spine 资源包，预览和导出控件保持不变。"
                      : "把骨骼、图集和每一张贴图拖到画布上。文件不会离开浏览器。"}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={onChooseFiles}>
                    {emptyMode === "gallery" ? "浏览画廊" : "选择资源包"}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : null}

          {cropEditing && customBounds ? (
            <ExportFrameOverlay
              viewStore={viewStore}
              bounds={customBounds}
              width={exportWidth}
              height={exportHeight}
              onPointerDown={onFramePointerDown}
              onKeyDown={onFrameKeyDown}
            />
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5">
            {hasSource ? <ZoomBadge viewStore={viewStore} onFit={onFit} /> : null}
            {hasSource && !touched ? (
              <span className="hidden rounded-md bg-hud px-2 py-1 text-2xs text-muted-foreground shadow-xs medium:inline">
                <MousePointer2 className="mr-1 inline size-3" aria-hidden="true" />
                拖动平移 · 滚轮缩放
              </span>
            ) : null}
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-workspace/70">
              <p className="text-sm font-semibold">拖入完整资源包</p>
            </div>
          ) : null}
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-56">
          <ContextMenuGroup>
            <ContextMenuItem onClick={onFit}>
              <Maximize />
              适配完整骨骼
              <ContextMenuShortcut>F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={onToggleDebug}>
              <Bone />
              {debug ? "隐藏骨骼调试" : "显示骨骼调试"}
              <ContextMenuShortcut>B</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={onToggleCrop}>
              <Crop />
              {cropEditing ? "完成导出框" : "绘制导出框"}
              <ContextMenuShortcut>C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!customBounds} onClick={onResetFrame}>
              <RotateCcw />
              重置自定义选框
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onExportFrame}>
              <ImageDown />
              将此帧存为 PNG
              <ContextMenuShortcut>Ctrl Shift E</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>

      {hasPlayableClip ? (
        <div className="flex min-h-timeline shrink-0 flex-col justify-center gap-1.5 border-t border-border-soft bg-workspace px-2 py-2">
          <Scrubber
            clock={clock}
            duration={renderState.duration}
            fps={fps}
            disabled={false}
            onSeek={onSeek}
          />

          <div className="flex flex-wrap items-center gap-1">
            <IconButton label="上一帧" shortcut="←" onClick={() => onStepFrames(-1)}>
              <ChevronFirst />
            </IconButton>
            <Button
              size="icon-sm"
              className="shrink-0 rounded-full"
              aria-label={renderState.playing ? "暂停" : "播放"}
              onClick={() => onPlayingChange(!renderState.playing)}
            >
              {renderState.playing ? <Pause /> : <Play />}
            </Button>
            <IconButton label="下一帧" shortcut="→" onClick={() => onStepFrames(1)}>
              <ChevronLast />
            </IconButton>
            <IconButton
              label={looping ? "关闭循环播放" : "开启循环播放"}
              shortcut="L"
              active={looping}
              onClick={onToggleLoop}
            >
              <Repeat />
            </IconButton>

            <div className="hidden min-w-0 flex-1 compact:block" />

            <Timecode clock={clock} duration={renderState.duration} fps={fps} />

            <Select
              items={SPEED_ITEMS}
              value={String(speed)}
              onValueChange={(value) => onSpeedChange(Number(value))}
            >
              <SelectTrigger size="sm" className="w-16 shrink-0 font-mono" aria-label="播放速度">
                <SelectValue>{(value: string) => `${value}×`}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {SPEEDS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}×
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </section>
  );
});

/** Reads zoom without rerendering the stage. */
const ZoomBadge = memo(function ZoomBadge({
  viewStore,
  onFit,
}: {
  viewStore: ViewStore;
  onFit: () => void;
}) {
  const zoomPercent = useZoomPercent(viewStore);
  return (
    <IconButton
      label={`缩放 ${zoomPercent}%。适配视图。`}
      shortcut="F"
      className="pointer-events-auto w-16 bg-hud px-2 text-center font-mono text-2xs tracking-data tabular-nums shadow-xs"
      onClick={onFit}
    >
      {zoomPercent}%
    </IconButton>
  );
});

/** Reads playback time without rerendering the stage. */
const Scrubber = memo(function Scrubber({
  clock,
  duration,
  fps,
  disabled,
  onSeek,
}: {
  clock: PlaybackClock;
  duration: number;
  fps: number;
  disabled: boolean;
  onSeek: (time: number) => void;
}) {
  const time = usePlayhead(clock);
  const max = Math.max(duration, 0.001);
  // Second markers stay readable at any clip length; per-frame ticks would not.
  const showRuler = duration >= 2;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn("h-1.5", !showRuler && "invisible")}
        style={
          showRuler
            ? {
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--border) 0 var(--size-px), transparent var(--size-px) 100%)",
                backgroundSize: `${100 / duration}% 100%`,
                backgroundPosition: "bottom",
                backgroundRepeat: "repeat-x",
              }
            : undefined
        }
        aria-hidden="true"
      />
      <Slider
        min={0}
        max={max}
        step={1 / Math.max(1, fps)}
        value={[Math.min(time, max)]}
        disabled={disabled}
        aria-label="播放头"
        onValueChange={(values) => {
          const value = Array.isArray(values) ? (values[0] ?? 0) : values;
          onSeek(value);
        }}
      />
    </div>
  );
});

const Timecode = memo(function Timecode({
  clock,
  duration,
  fps,
}: {
  clock: PlaybackClock;
  duration: number;
  fps: number;
}) {
  const time = usePlayhead(clock);
  const frame = Math.round(time * fps);
  const total = duration > 0 ? Math.max(1, Math.ceil(duration * fps)) : 0;

  return (
    <output
      className="order-last flex w-full shrink-0 justify-center px-2 font-mono text-2xs tracking-data text-muted-foreground tabular-nums compact:order-none compact:w-auto"
      aria-label={`${formatTime(time)} / ${formatTime(duration)}，第 ${frame} / ${total} 帧`}
    >
      <span className="text-foreground">{formatTime(time)}</span>
      <span> / {formatTime(duration)}</span>
      <span>
        {" "}
        · {frame}/{total}
      </span>
    </output>
  );
});

/** Projects the export frame from world coordinates into the live camera view. */
function ExportFrameOverlay({
  viewStore,
  bounds,
  width,
  height,
  onPointerDown,
  onKeyDown,
}: {
  viewStore: ViewStore;
  bounds: Bounds;
  width: number;
  height: number;
  onPointerDown: PreviewStageProps["onFramePointerDown"];
  onKeyDown: PreviewStageProps["onFrameKeyDown"];
}) {
  const frame = useProjectedBounds(viewStore, bounds);

  return (
    <section
      className="absolute border border-focus bg-primary-wash shadow-sm"
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
      aria-label="自定义导出框"
    >
      <span id="custom-frame-instructions" className="sr-only">
        用方向键移动选框。聚焦角点手柄后用方向键调整大小。按住 Shift 可以加大步长。
      </span>
      <button
        type="button"
        className="absolute inset-0 cursor-move"
        aria-label="移动导出框"
        aria-describedby="custom-frame-instructions"
        onPointerDown={(event) => onPointerDown(event, "move")}
        onKeyDown={(event) => onKeyDown(event, "move")}
      />
      <div className="pointer-events-none absolute -top-control-sm left-0 rounded-md bg-primary px-2 py-1 font-mono text-2xs tracking-data tabular-nums text-primary-foreground shadow-xs">
        {width} × {height}
      </div>
      <FrameHandle
        position="northWest"
        className="-top-2 -left-2 cursor-nwse-resize"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <FrameHandle
        position="northEast"
        className="-top-2 -right-2 cursor-nesw-resize"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <FrameHandle
        position="southWest"
        className="-bottom-2 -left-2 cursor-nesw-resize"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <FrameHandle
        position="southEast"
        className="-right-2 -bottom-2 cursor-nwse-resize"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  );
}

function FrameHandle({
  position,
  className,
  onPointerDown,
  onKeyDown,
}: {
  position: Exclude<FrameDragAction, "draw" | "move">;
  className: string;
  onPointerDown: PreviewStageProps["onFramePointerDown"];
  onKeyDown: PreviewStageProps["onFrameKeyDown"];
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute z-10 size-4 rounded-full border border-focus bg-workspace shadow-xs after:absolute after:-inset-2",
        className,
      )}
      aria-label={`从${FRAME_HANDLE_LABELS[position]}调整导出框`}
      onPointerDown={(event) => onPointerDown(event, position)}
      onKeyDown={(event) => onKeyDown(event, position)}
    />
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
}
