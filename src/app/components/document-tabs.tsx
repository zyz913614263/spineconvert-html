import { memo } from "react";
import { FileJson2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { IconButton } from "./icon-button";

export type DocumentTab = {
  id: string;
  name: string;
  version: string;
};

type DocumentTabsProps = {
  documents: readonly DocumentTab[];
  activeId: string | null;
  disabled: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onNew: () => void;
};

export const DocumentTabs = memo(function DocumentTabs({
  documents,
  activeId,
  disabled,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onNew,
}: DocumentTabsProps) {
  return (
    <div
      className={cn(
        "col-span-2 row-start-2 flex h-touch-target min-w-32 flex-1 items-end gap-1 px-1 medium:col-auto medium:row-auto medium:h-auto",
        documents.length === 0 && "max-medium:hidden",
      )}
    >
      {documents.length > 0 ? (
        <Tabs
          value={activeId ?? undefined}
          onValueChange={(value) => onActivate(String(value))}
          className="min-w-32 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            activateOnFocus
            className="no-scrollbar h-auto! w-full justify-start overflow-x-auto p-0 max-medium:h-touch-target!"
            aria-label="已打开的动画文档"
          >
            {documents.map((document) => {
              const active = document.id === activeId;
              return (
                <ContextMenu key={document.id}>
                  <ContextMenuTrigger
                    render={
                      <div
                        className={cn(
                          "group/tab flex h-touch-target max-w-sidebar-left shrink-0 items-center rounded-t-lg border border-b-0 border-transparent pr-1 text-muted-foreground transition-colors medium:h-control-sm",
                          active
                            ? "border-border-soft bg-surface text-foreground"
                            : "hover:bg-surface/60 hover:text-foreground",
                        )}
                      />
                    }
                  >
                    <TabsTrigger
                      value={document.id}
                      aria-disabled={disabled}
                      title={`${document.name} · Spine ${document.version}`}
                      className="h-full min-w-0 justify-start rounded-t-lg px-2 text-xs"
                    >
                      <FileJson2
                        data-icon="inline-start"
                        className={cn(active ? "text-cyan" : "opacity-70")}
                        aria-hidden="true"
                      />
                      <span className="truncate">{document.name}</span>
                      <span className="hidden shrink-0 font-mono text-2xs tracking-data text-muted-foreground medium:inline">
                        {document.version}
                      </span>
                    </TabsTrigger>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`关闭 ${document.name}`}
                      disabled={disabled}
                      tabIndex={active ? 0 : -1}
                      className={cn(
                        "shrink-0 text-muted-foreground hover:text-foreground",
                        !active &&
                          "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
                      )}
                      onClick={() => onClose(document.id)}
                    >
                      <X />
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuItem disabled={disabled} onClick={() => onClose(document.id)}>
                        <X />
                        关闭
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={disabled || documents.length < 2}
                        onClick={() => onCloseOthers(document.id)}
                      >
                        关闭其他
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={disabled}
                        variant="destructive"
                        onClick={onCloseAll}
                      >
                        全部关闭
                      </ContextMenuItem>
                    </ContextMenuGroup>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </TabsList>
        </Tabs>
      ) : null}

      <IconButton
        label="打开 Spine 资源包"
        shortcut="Ctrl O"
        className="shrink-0 self-center"
        disabled={disabled}
        onClick={onNew}
      >
        <Plus />
      </IconButton>
    </div>
  );
});
