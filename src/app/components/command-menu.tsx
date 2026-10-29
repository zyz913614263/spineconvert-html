import { memo } from "react";
import {
  Bone,
  Crop,
  Download,
  FolderOpen,
  ImageDown,
  Maximize,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  Repeat,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

type CommandMenuProps = {
  open: boolean;
  hasSource: boolean;
  hasAnimation: boolean;
  playing: boolean;
  looping: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseFiles: () => void;
  onFit: () => void;
  onToggleBones: () => void;
  onToggleCrop: () => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onToggleProject: () => void;
  onToggleInspector: () => void;
  onExport: () => void;
  onExportFrame: () => void;
};

export const CommandMenu = memo(function CommandMenu({
  open,
  hasSource,
  hasAnimation,
  playing,
  looping,
  onOpenChange,
  onChooseFiles,
  onFit,
  onToggleBones,
  onToggleCrop,
  onTogglePlay,
  onToggleLoop,
  onToggleProject,
  onToggleInspector,
  onExport,
  onExportFrame,
}: CommandMenuProps) {
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Spine Thing 命令"
      description="搜索播放、画布、工作区和导出操作"
      className="max-w-command"
    >
      <Command>
        <CommandInput placeholder="搜索命令…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令。</CommandEmpty>
          <CommandGroup heading="工程">
            <CommandItem onSelect={() => run(onChooseFiles)}>
              <FolderOpen />
              打开 Spine 资源包
              <CommandShortcut>Ctrl O</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!hasAnimation} onSelect={() => run(onExport)}>
              <Download />
              导出选中的动画
              <CommandShortcut>Ctrl E</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!hasAnimation} onSelect={() => run(onExportFrame)}>
              <ImageDown />
              将此帧存为透明 PNG
              <CommandShortcut>Ctrl Shift E</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="播放">
            <CommandItem disabled={!hasAnimation} onSelect={() => run(onTogglePlay)}>
              {playing ? <Pause /> : <Play />}
              {playing ? "暂停" : "播放"}
              <CommandShortcut>Space</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!hasSource} onSelect={() => run(onToggleLoop)}>
              <Repeat />
              {looping ? "播放一次" : "循环播放"}
              <CommandShortcut>L</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="画布">
            <CommandItem disabled={!hasSource} onSelect={() => run(onFit)}>
              <Maximize />
              适配完整骨骼
              <CommandShortcut>F</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!hasSource} onSelect={() => run(onToggleBones)}>
              <Bone />
              切换骨骼调试
              <CommandShortcut>B</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!hasSource} onSelect={() => run(onToggleCrop)}>
              <Crop />
              绘制导出框
              <CommandShortcut>C</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="工作区">
            <CommandItem onSelect={() => run(onToggleProject)}>
              <PanelLeft />
              切换工程面板
              <CommandShortcut>Ctrl 1</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(onToggleInspector)}>
              <PanelRight />
              切换导出面板
              <CommandShortcut>Ctrl 2</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
});
