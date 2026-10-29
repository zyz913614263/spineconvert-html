import { memo } from "react";
import {
  GalleryVerticalEnd,
  LockKeyhole,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat } from "@/domain/export/protocol";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DocumentTabs, type DocumentTab } from "./document-tabs";
import { IconButton } from "./icon-button";

export const WORKSPACE_MODES = ["canvas", "gallery"] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

type AppHeaderProps = {
  mode: WorkspaceMode;
  documents: readonly DocumentTab[];
  activeId: string | null;
  busy: boolean;
  runtimeReady: boolean;
  capabilities: Record<ExportFormat, boolean>;
  projectOpen: boolean;
  inspectorOpen: boolean;
  onActivateDocument: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onCloseOtherDocuments: (id: string) => void;
  onCloseAllDocuments: () => void;
  onNewDocument: () => void;
  onOpenCommand: () => void;
  onToggleProject: () => void;
  onToggleInspector: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
};

export const AppHeader = memo(function AppHeader({
  mode,
  documents,
  activeId,
  busy,
  runtimeReady,
  capabilities,
  projectOpen,
  inspectorOpen,
  onActivateDocument,
  onCloseDocument,
  onCloseOtherDocuments,
  onCloseAllDocuments,
  onNewDocument,
  onOpenCommand,
  onToggleProject,
  onToggleInspector,
  onModeChange,
}: AppHeaderProps) {
  return (
    <header className="grid min-h-app-header shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 border-b border-border-soft bg-workspace px-2 medium:flex medium:h-app-header medium:items-stretch">
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden shrink-0 compact:block">
          <SpineMark />
        </span>
        <h1 className="hidden text-sm font-semibold tracking-tight compact:block">Spine Thing</h1>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            const next = WORKSPACE_MODES.find((candidate) => candidate === value);
            if (next) onModeChange(next);
          }}
          className="gap-0"
        >
          <TabsList
            variant="line"
            className="h-touch-target border border-border bg-canvas p-0.5 medium:h-control-sm"
          >
            <TabsTrigger value="canvas" aria-label="画布模式" className="px-2 text-xs">
              <PanelsTopLeft />
              <span className="hidden wide:inline">画布</span>
            </TabsTrigger>
            <TabsTrigger value="gallery" aria-label="画廊模式" className="px-2 text-xs">
              <GalleryVerticalEnd />
              <span className="hidden wide:inline">画廊</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <IconButton
          label={
            projectOpen
              ? `隐藏${mode === "gallery" ? "画廊" : "工程"}面板`
              : `显示${mode === "gallery" ? "画廊" : "工程"}面板`
          }
          shortcut="Ctrl 1"
          active={projectOpen}
          aria-expanded={projectOpen}
          onClick={onToggleProject}
        >
          <PanelLeft />
        </IconButton>
      </div>

      <DocumentTabs
        documents={documents}
        activeId={activeId}
        disabled={busy}
        onActivate={onActivateDocument}
        onClose={onCloseDocument}
        onCloseOthers={onCloseOtherDocuments}
        onCloseAll={onCloseAllDocuments}
        onNew={onNewDocument}
      />

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="hidden gap-2 text-muted-foreground medium:flex"
          onClick={onOpenCommand}
        >
          <Search data-icon="inline-start" />
          <span className="hidden wide:inline">搜索命令</span>
          <kbd className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-2xs tracking-data">
            Ctrl K
          </kbd>
        </Button>
        <IconButton
          label="搜索命令"
          shortcut="Ctrl K"
          className="medium:hidden"
          onClick={onOpenCommand}
        >
          <Search />
        </IconButton>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                aria-label={
                  runtimeReady
                    ? "本机运行时已就绪。查看编码器支持。"
                    : "本机运行时启动中。查看编码器支持。"
                }
              />
            }
          >
            <span className="relative">
              <LockKeyhole className="size-icon" />
              <span
                className={`absolute -top-1 -right-1 size-1.5 rounded-full ${runtimeReady ? "bg-success" : "bg-warning"}`}
              />
            </span>
            <span className="hidden wide:inline">本地</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-sidebar-right p-2">
            {/* Base UI requires GroupLabel to sit inside a Group; without one it throws. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>本机运行时</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <CapabilityRow label="WebGL 预览" ready={runtimeReady} />
              <CapabilityRow label="WebM 编码器" ready={capabilities.webm} />
              <CapabilityRow label="MP4 编码器" ready={capabilities.mp4} />
              <CapabilityRow label="GIF 编码器" ready />
            </DropdownMenuGroup>
            <p className="mt-2 px-1.5 text-xs text-muted-foreground">
              本地文件不会离开这台设备。画廊资源以只读方式下载。
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconButton
          label={inspectorOpen ? "隐藏导出面板" : "显示导出面板"}
          shortcut="Ctrl 2"
          active={inspectorOpen}
          aria-expanded={inspectorOpen}
          onClick={onToggleInspector}
        >
          <PanelRight />
        </IconButton>
      </div>
    </header>
  );
});

function CapabilityRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-1.5 py-1.5 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1.5 font-mono text-2xs tracking-data text-muted-foreground">
        <span className={`size-1.5 rounded-full ${ready ? "bg-success" : "bg-warning"}`} />
        {ready ? "就绪" : "不可用"}
      </span>
    </div>
  );
}

function SpineMark() {
  return (
    <svg
      className="size-7 shrink-0 text-primary"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 5h12l5 5-5 5H10l-3 3 5 5h13"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="5" r="2.5" className="fill-focus" />
      <circle cx="25" cy="23" r="2.5" className="fill-cyan" />
    </svg>
  );
}
