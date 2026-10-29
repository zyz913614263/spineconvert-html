import { memo, useEffect } from "react";
import { Check, CircleAlert, Film, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type ExportTaskState = {
  phase: "idle" | "measuring" | "rendering" | "finalizing" | "complete" | "error" | "canceled";
  progress: number;
  title: string;
  detail: string;
};

type ExportTaskProps = {
  task: ExportTaskState;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry: () => void;
};

const COMPLETE_DISMISS_MS = 6000;

/** Shows export progress without blocking the editor. */
export const ExportTask = memo(function ExportTask({
  task,
  onCancel,
  onDismiss,
  onRetry,
}: ExportTaskProps) {
  const complete = task.phase === "complete";
  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(onDismiss, COMPLETE_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [complete, onDismiss, task.detail]);

  if (task.phase === "idle") return null;
  const running = ["measuring", "rendering", "finalizing"].includes(task.phase);
  const failed = task.phase === "error";

  return (
    <aside
      className="pointer-events-auto w-export-task max-w-full rounded-2xl bg-surface-raised p-3 shadow-popover ring-1 ring-border data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 duration-medium ease-expo"
      data-open=""
      aria-live="polite"
      aria-label="导出任务"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid size-control shrink-0 place-items-center rounded-xl bg-primary-soft text-focus",
            complete && "bg-success/15 text-success",
            failed && "bg-destructive/15 text-destructive",
          )}
        >
          {complete ? (
            <Check />
          ) : failed ? (
            <CircleAlert />
          ) : running ? (
            <Film className="export-film-icon" />
          ) : (
            <Spinner />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold">{task.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.detail}</p>
            </div>
            {!running ? (
              <Button size="icon-xs" variant="ghost" aria-label="关闭导出任务" onClick={onDismiss}>
                <X />
              </Button>
            ) : null}
          </div>

          {running ? (
            <Progress value={Math.round(task.progress * 100)} className="mt-3 gap-2">
              <ProgressLabel className="text-2xs text-muted-foreground">本地渲染</ProgressLabel>
              <ProgressValue className="font-mono text-2xs" />
            </Progress>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            {running ? (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                取消
              </Button>
            ) : failed ? (
              <Button size="sm" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
});
