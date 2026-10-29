import { memo, useCallback, useState } from "react";
import { AlertCircle, Check, Circle, Clipboard, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { detached } from "@/lib/detached";

export type WorkStatus = "idle" | "loading" | "ready" | "converting" | "exporting" | "error";

type StatusBarProps = {
  status: WorkStatus;
  message: string;
  runtimeReady: boolean;
};

/** Shows workspace status without subscribing to playback time. */
export const StatusBar = memo(function StatusBar({
  status,
  message,
  runtimeReady,
}: StatusBarProps) {
  const active = status === "loading" || status === "converting" || status === "exporting";
  const [copiedMessage, setCopiedMessage] = useState("");
  const copied = copiedMessage === message;
  const copyMessage = useCallback(async () => {
    await navigator.clipboard.writeText(message);
    setCopiedMessage(message);
  }, [message]);

  return (
    <footer className="flex h-status shrink-0 items-center justify-between gap-2 border-t border-border-soft bg-workspace px-3 text-2xs text-muted-foreground max-medium:h-touch-target">
      <output
        className={cn(
          "status-strip flex min-w-0 items-center gap-1.5",
          status === "error" && "text-destructive",
          status === "ready" && "text-success",
        )}
        aria-live="polite"
      >
        {active ? (
          <Spinner className="size-3 shrink-0" aria-hidden="true" />
        ) : status === "error" ? (
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
        ) : status === "ready" ? (
          <Check className="size-3 shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="size-2 shrink-0" aria-hidden="true" />
        )}
        <span className="max-compact:max-w-[calc(100vw-var(--space-8))] truncate">{message}</span>
      </output>
      <div className="flex shrink-0 items-center gap-1">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="查看完整状态"
                title="查看完整状态"
              />
            }
          >
            <Clipboard aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-drawer max-w-[calc(100vw-var(--space-6))] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold">状态详情</p>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => detached(copyMessage(), "status-detail.copy")}
              >
                {copied ? <ClipboardCheck /> : <Clipboard />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <p
              className="mt-2 max-h-picker-list overflow-y-auto whitespace-pre-wrap break-words font-mono text-2xs leading-body text-muted-foreground select-text"
              aria-label="完整状态信息"
            >
              {message}
            </p>
          </PopoverContent>
        </Popover>
        <div className="hidden shrink-0 items-center gap-3 font-mono tracking-data compact:flex">
          <span>{runtimeReady ? "WebGL 就绪" : "正在启动运行时"}</span>
          <span className="hidden medium:inline">Spine 3.3-4.2</span>
        </div>
      </div>
    </footer>
  );
});
