import {
  type CSSProperties,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderClosed, ListFilter, Search, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import type { GalleryFacetKind } from "@/domain/gallery/filters";
import { rankFuzzy, type FuzzyTarget } from "@/domain/search/fuzzy";
import { formatNumber } from "@/lib/format";
import { readDesignTokenPx } from "@/lib/tokens";
import { cn } from "@/lib/utils";

export type GalleryFilterFacet = {
  readonly key: string;
  readonly kind: GalleryFacetKind;
  readonly label: string;
  readonly count: number;
  readonly target: FuzzyTarget;
};

type GalleryTagVirtualizer = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;

function sameFacet(left: GalleryFilterFacet, right: GalleryFilterFacet): boolean {
  return left.key === right.key;
}

function facetCountLabel(count: number, noun: string): string {
  return `${formatNumber(count)} 个${noun}`;
}

export function GalleryTagFilter({
  facets,
  selectedKeys,
  onChange,
}: {
  facets: readonly GalleryFilterFacet[];
  selectedKeys: readonly string[];
  onChange: (keys: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const virtualizerRef = useRef<GalleryTagVirtualizer | null>(null);
  const byKey = useMemo(() => new Map(facets.map((facet) => [facet.key, facet])), [facets]);
  const selected = useMemo(
    () =>
      selectedKeys
        .map((key) => byKey.get(key))
        .filter((facet): facet is GalleryFilterFacet => facet !== undefined),
    [byKey, selectedKeys],
  );
  const filtered = useMemo(
    () => rankFuzzy(facets, query, (facet) => facet.target).map(({ item }) => item),
    [facets, query],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);
  const handleValueChange = useCallback(
    (next: GalleryFilterFacet[]) => onChange(next.map((facet) => facet.key)),
    [onChange],
  );
  const handleItemHighlighted = useCallback(
    (
      facet: GalleryFilterFacet | undefined,
      details: ComboboxPrimitive.Root.HighlightEventDetails,
    ) => {
      const virtualizer = virtualizerRef.current;
      if (!facet || !virtualizer || details.reason !== "keyboard") return;
      queueMicrotask(() => virtualizer.scrollToIndex(details.index, { align: "auto" }));
    },
    [],
  );
  const count = selected.length;
  const filteredCollectionCount = filtered.filter((facet) => facet.kind === "collection").length;
  const filteredTagCount = filtered.length - filteredCollectionCount;

  return (
    <Combobox
      multiple
      virtualized
      items={facets}
      filteredItems={filtered}
      value={selected}
      open={open}
      inputValue={query}
      itemToStringLabel={(facet) => facet.label}
      itemToStringValue={(facet) => facet.key}
      isItemEqualToValue={sameFacet}
      onValueChange={handleValueChange}
      onInputValueChange={setQuery}
      onOpenChange={handleOpenChange}
      onItemHighlighted={handleItemHighlighted}
    >
      <ComboboxTrigger
        size="sm"
        className={cn(
          "shrink-0 border-border-soft bg-canvas px-2 text-muted-foreground",
          count > 0 && "border-primary bg-primary-soft text-focus",
        )}
        aria-label={count === 0 ? "按标签和合集筛选" : `按标签和合集筛选，已选 ${count} 项`}
      >
        <ListFilter aria-hidden="true" />
        <span className="sr-only">标签和合集</span>
        {count > 0 ? (
          <span className="font-mono text-2xs tracking-data tabular-nums">{count}</span>
        ) : null}
      </ComboboxTrigger>

      <ComboboxContent align="end" aria-label="按标签和合集筛选" className="w-72">
        <div className="relative shrink-0 p-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-icon -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <ComboboxInput
            className="pl-8"
            placeholder="查找标签或合集…"
            aria-label="查找标签或合集"
          />
        </div>
        <ComboboxEmpty>没有名称匹配的标签或合集。</ComboboxEmpty>
        <ComboboxList>
          <GalleryTagRows open={open} virtualizerRef={virtualizerRef} />
        </ComboboxList>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-soft px-2.5 py-1.5 text-2xs text-muted-foreground">
          <span className="font-mono tracking-data tabular-nums">
            {facetCountLabel(filteredCollectionCount, "合集")} ·{" "}
            {facetCountLabel(filteredTagCount, "标签")}
          </span>
          {count > 0 ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-focus"
              onClick={() => onChange([])}
            >
              清除
            </Button>
          ) : null}
        </footer>
      </ComboboxContent>
    </Combobox>
  );
}

function GalleryTagRows({
  open,
  virtualizerRef,
}: {
  open: boolean;
  virtualizerRef: RefObject<GalleryTagVirtualizer | null>;
}) {
  const facets = ComboboxPrimitive.useFilteredItems<GalleryFilterFacet>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const size = readDesignTokenPx("--size-picker-row");

  // TanStack Virtual returns functions that React Compiler cannot memoize.
  // eslint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: open,
    count: facets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => size,
    overscan: 8,
  });
  useImperativeHandle(virtualizerRef, () => virtualizer);

  const handleScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      if (element) virtualizer.measure();
    },
    [virtualizer],
  );
  const totalSize = virtualizer.getTotalSize();
  const paddedTotalSize = totalSize + readDesignTokenPx("--space-2");
  if (facets.length === 0) return null;

  return (
    <div
      ref={handleScrollRef}
      role="presentation"
      className="h-[min(var(--size-picker-list),var(--padded-total-size))] max-h-[var(--available-height)] min-h-0 overflow-y-auto overscroll-contain p-1"
      // SAFETY: React supports CSS custom properties, but CSSProperties omits them.
      style={{ "--padded-total-size": `${paddedTotalSize}px` } as CSSProperties}
    >
      <div role="presentation" className="relative w-full" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((row) => {
          const facet = facets[row.index];
          if (!facet) return null;
          return (
            <ComboboxItem
              key={facet.key}
              index={row.index}
              value={facet}
              aria-setsize={facets.length}
              aria-posinset={row.index + 1}
              aria-label={`${facet.kind === "collection" ? "合集" : "标签"}：${facet.label}，${facetCountLabel(facet.count, "动画")}`}
              className="absolute top-0 left-0 w-full"
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              {facet.kind === "collection" ? (
                <FolderClosed aria-hidden="true" />
              ) : (
                <Tag aria-hidden="true" />
              )}
              <span className="truncate">{facet.label}</span>
              <span className="ml-auto font-mono text-2xs tracking-data tabular-nums text-muted-foreground">
                {formatNumber(facet.count)}
              </span>
            </ComboboxItem>
          );
        })}
      </div>
    </div>
  );
}
