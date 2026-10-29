import { memo, useCallback, useMemo, useState } from "react";
import { BookOpen, Library, Plus, Search, Trash2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { sourceHost, type GallerySource } from "@/domain/gallery/sources";
import { fuzzyTarget, rankFuzzy } from "@/domain/search/fuzzy";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

type GallerySourcePickerProps = {
  sources: readonly GallerySource[];
  selected: GallerySource;
  /** Item count for the selected library, once its catalog has loaded. */
  count: number | null;
  failed: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onOpenReference: () => void;
};

function sourceLabel(source: GallerySource | null): string {
  return source?.label ?? "";
}

function sameSource(left: GallerySource, right: GallerySource): boolean {
  return left.id === right.id;
}

/** Chooses a gallery library by name or host. */
export const GallerySourcePicker = memo(function GallerySourcePicker({
  sources,
  selected,
  count,
  failed,
  onSelect,
  onRemove,
  onAdd,
  onOpenReference,
}: GallerySourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const targets = useMemo(
    () =>
      new Map(
        sources.map((source) => [source.id, fuzzyTarget(`${source.label} ${sourceHost(source)}`)]),
      ),
    [sources],
  );

  // Rank matches before giving the list to Base UI.
  const filtered = useMemo(
    () =>
      rankFuzzy(
        sources,
        query,
        (source) => targets.get(source.id) ?? fuzzyTarget(source.label),
      ).map((entry) => entry.item),
    [query, sources, targets],
  );

  const handleValueChange = useCallback(
    (source: GallerySource | null) => {
      if (source) onSelect(source.id);
    },
    [onSelect],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  return (
    <Combobox
      items={sources}
      filteredItems={filtered}
      value={selected}
      open={open}
      inputValue={query}
      itemToStringLabel={sourceLabel}
      itemToStringValue={sourceLabel}
      isItemEqualToValue={sameSource}
      onValueChange={handleValueChange}
      onInputValueChange={setQuery}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger
        size="sm"
        aria-label={`画廊库：${selected.label}。切换库。`}
        className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 hover:bg-surface-raised"
      >
        <ComboboxValue className="items-center gap-1.5 truncate">
          {failed ? (
            <TriangleAlert className="size-icon shrink-0 text-warning" aria-hidden="true" />
          ) : (
            <Library className="size-icon shrink-0 text-cyan" aria-hidden="true" />
          )}
          <span className="truncate text-sm font-semibold">{selected.label}</span>
          <span className="shrink-0 font-mono text-2xs tracking-data tabular-nums text-muted-foreground">
            {failed ? "不可用" : count === null ? "…" : formatNumber(count)}
          </span>
        </ComboboxValue>
      </ComboboxTrigger>

      <ComboboxContent align="start" aria-label="画廊库列表" className="min-w-72">
        {sources.length > 4 ? (
          <div className="relative shrink-0 p-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-icon -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <ComboboxInput className="pl-8" placeholder="筛选库…" aria-label="筛选库" />
          </div>
        ) : null}

        <ComboboxEmpty>没有名称匹配的库。</ComboboxEmpty>

        <ComboboxList className="max-h-64 overflow-y-auto p-1">
          {(source: GallerySource) => (
            <ComboboxItem
              key={source.id}
              value={source}
              className="items-start gap-2 py-1.5 pr-8 pl-2"
            >
              <span className="grid min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{source.label}</span>
                  {!source.builtIn ? (
                    <Badge
                      variant="outline"
                      className="h-auto px-1.5 py-0 text-2xs text-muted-foreground"
                    >
                      已添加
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate text-2xs text-muted-foreground">
                  {sourceHost(source)}
                </span>
              </span>
              {!source.builtIn ? <RemoveSource source={source} onRemove={onRemove} /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>

        <div className="grid shrink-0 border-t border-border-soft p-1">
          <Button
            variant="ghost"
            className="w-full justify-start text-focus"
            onClick={() => {
              handleOpenChange(false);
              onAdd();
            }}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            添加清单地址
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start text-2xs text-muted-foreground"
            onClick={() => {
              handleOpenChange(false);
              onOpenReference();
            }}
          >
            <BookOpen data-icon="inline-start" aria-hidden="true" />
            清单长什么样
          </Button>
        </div>
      </ComboboxContent>
    </Combobox>
  );
});

function RemoveSource({
  source,
  onRemove,
}: {
  source: GallerySource;
  onRemove: (id: string) => void;
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`移除 ${source.label}`}
      className={cn(
        "mt-0.5 shrink-0 text-muted-foreground",
        "hover:bg-destructive/15 hover:text-destructive",
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onRemove(source.id);
      }}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

export type { GallerySourcePickerProps };
