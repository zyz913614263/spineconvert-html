/* eslint-disable jsx-a11y/prefer-tag-over-role -- Native select/option elements cannot represent or virtualize rich catalog rows; this component follows the ARIA listbox active-descendant pattern instead. */
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  FileBox,
  GalleryVerticalEnd,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  galleryFacetKey,
  galleryItemFacetIndex,
  matchesGalleryFacetSelection,
  type GalleryFacetIndex,
  type GalleryFacetKind,
} from "@/domain/gallery/filters";
import type { GalleryCatalog, GalleryItem } from "@/domain/gallery/manifest";
import type { GallerySource } from "@/domain/gallery/sources";
import { fuzzyTarget, rankFuzzy, sliceMatch, type FuzzyTarget } from "@/domain/search/fuzzy";
import { readDesignTokenPx } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { detached } from "@/lib/detached";
import { formatNumber } from "@/lib/format";

import { GallerySourcePicker } from "./gallery-source-picker";
import { GalleryTagFilter, type GalleryFilterFacet } from "./gallery-tag-filter";
import { IconButton } from "./icon-button";

type GalleryPanelProps = {
  catalog: GalleryCatalog | null;
  sources: readonly GallerySource[];
  selectedSource: GallerySource;
  selectedId: string | null;
  pendingId: string | null;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  preparationError: { title: string; message: string; detail: string } | null;
  /** True when the selected gallery item is loaded and ready to export. */
  canExportSpine: boolean;
  exportingSpine: boolean;
  onExportSpine: () => void;
  onSelect: (item: GalleryItem) => void;
  onSelectSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onAddSource: () => void;
  onOpenReference: () => void;
  onRetry: () => void;
  onDismissError: () => void;
  onClose?: () => void;
};

/** Search text plus offsets for highlights in the visible fields. */
type GallerySearchEntry = {
  readonly target: FuzzyTarget;
  readonly titleEnd: number;
  readonly variantStart: number;
  readonly variantEnd: number;
};

type GallerySearchRecord = {
  readonly item: GalleryItem;
  readonly search: GallerySearchEntry;
  readonly facets: GalleryFacetIndex;
};

const FACET_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Builds searchable text without repeating values found in several fields. */
function searchEntry(item: GalleryItem): GallerySearchEntry {
  const seen = new Set<string>();
  const parts: string[] = [];
  let titleEnd = 0;
  let variantStart = 0;
  let variantEnd = 0;
  let length = 0;

  for (const [role, value] of [
    ["title", item.title],
    ["variant", item.variant ?? ""],
    ["other", item.collection ?? ""],
    ...item.tags.map((tag) => ["other", tag] as const),
  ] as const) {
    const text = value.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const start = length === 0 ? 0 : length + 1;
    if (role === "title") titleEnd = start + text.length;
    if (role === "variant") {
      variantStart = start;
      variantEnd = start + text.length;
    }
    parts.push(text);
    length = start + text.length;
  }

  return { target: fuzzyTarget(parts.join(" ")), titleEnd, variantStart, variantEnd };
}

export const GalleryPanel = memo(function GalleryPanel({
  catalog,
  sources,
  selectedSource,
  selectedId,
  pendingId,
  loading,
  fetching,
  error,
  preparationError,
  canExportSpine,
  exportingSpine,
  onExportSpine,
  onSelect,
  onSelectSource,
  onRemoveSource,
  onAddSource,
  onOpenReference,
  onRetry,
  onDismissError,
  onClose,
}: GalleryPanelProps) {
  const [searchState, setSearchState] = useState({ sourceId: selectedSource.id, query: "" });
  const [filterSelection, setFilterSelection] = useState<{
    sourceId: string;
    keys: readonly string[];
  }>({ sourceId: selectedSource.id, keys: [] });
  const searchRef = useRef<HTMLInputElement | null>(null);
  const query = searchState.sourceId === selectedSource.id ? searchState.query : "";
  const setQuery = useCallback(
    (nextQuery: string) => setSearchState({ sourceId: selectedSource.id, query: nextQuery }),
    [selectedSource.id],
  );
  const selectedFacetKeys = useMemo(
    () => (filterSelection.sourceId === selectedSource.id ? filterSelection.keys : []),
    [filterSelection, selectedSource.id],
  );
  const setSelectedFacetKeys = useCallback(
    (keys: readonly string[]) => setFilterSelection({ sourceId: selectedSource.id, keys }),
    [selectedSource.id],
  );
  // Defer catalog ranking so typing stays responsive.
  const deferredQuery = useDeferredValue(query);

  // Rebuild search data only when the catalog changes.
  const records = useMemo<readonly GallerySearchRecord[]>(
    () =>
      catalog?.items.map((item) => ({
        item,
        search: searchEntry(item),
        facets: galleryItemFacetIndex(item),
      })) ?? [],
    [catalog?.items],
  );

  const galleryFacets = useMemo<readonly GalleryFilterFacet[]>(() => {
    const collections = new Map<string, { label: string; count: number }>();
    const tags = new Map<string, { label: string; count: number }>();

    const countFacet = (kind: GalleryFacetKind, value: string) => {
      const key = galleryFacetKey(kind, value);
      if (!key) return;
      const facets = kind === "collection" ? collections : tags;
      const current = facets.get(key);
      facets.set(key, {
        label: current?.label ?? value.trim(),
        count: (current?.count ?? 0) + 1,
      });
    };

    for (const { item } of records) {
      countFacet("collection", item.collection ?? "");
      const counted = new Set<string>();
      for (const tag of item.tags) {
        const key = galleryFacetKey("tag", tag);
        if (!key || counted.has(key)) continue;
        counted.add(key);
        countFacet("tag", tag);
      }
    }

    const toFacet = (
      kind: GalleryFacetKind,
      [key, { label, count }]: [string, { label: string; count: number }],
    ): GalleryFilterFacet => ({
      key,
      kind,
      label,
      count,
      target: fuzzyTarget(`${label} ${kind}`),
    });

    const collectionFacets = [...collections.entries()]
      .map((entry) => toFacet("collection", entry))
      .sort((left, right) => FACET_COLLATOR.compare(left.label, right.label));
    const tagFacets = [...tags.entries()]
      .map((entry) => toFacet("tag", entry))
      .sort(
        (left, right) =>
          right.count - left.count || FACET_COLLATOR.compare(left.label, right.label),
      );

    return [...collectionFacets, ...tagFacets];
  }, [records]);

  const activeFacetKeys = useMemo(() => {
    const available = new Set(galleryFacets.map((facet) => facet.key));
    return selectedFacetKeys.filter((key) => available.has(key));
  }, [galleryFacets, selectedFacetKeys]);

  const filteredRecords = useMemo(
    () =>
      activeFacetKeys.length === 0
        ? records
        : records.filter(({ facets }) => matchesGalleryFacetSelection(facets, activeFacetKeys)),
    [activeFacetKeys, records],
  );

  const ranked = useMemo(
    () =>
      rankFuzzy(filteredRecords, deferredQuery, (record) => record.search.target).map(
        ({ item: record, match }) => ({ item: record.item, search: record.search, match }),
      ),
    [deferredQuery, filteredRecords],
  );

  const total = catalog?.items.length ?? null;
  const filtering = deferredQuery.trim().length > 0 || activeFacetKeys.length > 0;
  const clearFilters = useCallback(() => {
    setQuery("");
    setSelectedFacetKeys([]);
    searchRef.current?.focus();
  }, [setQuery, setSelectedFacetKeys]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="服务器画廊">
      <header className="flex h-touch-target shrink-0 items-center gap-1 border-b border-border-soft pr-2 pl-1 workspace:h-control">
        <GallerySourcePicker
          sources={sources}
          selected={selectedSource}
          count={total}
          failed={error !== null && !loading}
          onSelect={onSelectSource}
          onRemove={onRemoveSource}
          onAdd={onAddSource}
          onOpenReference={onOpenReference}
        />
        <div className="flex shrink-0 items-center gap-1">
          {fetching && !loading ? (
            <Spinner className="size-icon text-cyan" aria-label="正在刷新画廊" />
          ) : null}
          <IconButton label="刷新画廊" onClick={onRetry}>
            <RefreshCw />
          </IconButton>
          {onClose ? (
            <IconButton label="关闭画廊面板" onClick={onClose}>
              <X />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border-soft p-3">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            value={query}
            aria-label="搜索画廊动画"
            placeholder="搜索动画…"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="清除画廊搜索"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <GalleryTagFilter
          facets={galleryFacets}
          selectedKeys={activeFacetKeys}
          onChange={setSelectedFacetKeys}
        />
      </div>

      {preparationError ? (
        <div className="shrink-0 border-b border-border-soft p-3">
          <GalleryItemError
            title={preparationError.title}
            message={preparationError.message}
            detail={preparationError.detail}
            onRetry={onRetry}
            onDismiss={onDismissError}
          />
        </div>
      ) : null}

      {loading || error || ranked.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-3">
            {loading ? <GalleryLoading /> : null}
            {!loading && error ? <GalleryError message={error} onRetry={onRetry} /> : null}
            {!loading && !error && catalog?.items.length === 0 ? <GalleryEmpty /> : null}
            {!loading && !error && catalog && catalog.items.length > 0 && ranked.length === 0 ? (
              <Empty className="border border-border-soft bg-canvas p-4">
                <EmptyHeader>
                  <EmptyTitle>没有匹配的动画</EmptyTitle>
                  <EmptyDescription>请调整搜索、标签或合集筛选。</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    清除筛选
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}
          </div>
        </div>
      ) : (
        <GalleryItemList
          ranked={ranked}
          selectedId={selectedId}
          pendingId={pendingId}
          onSelect={onSelect}
        />
      )}

      {total !== null && filtering && !loading && !error ? (
        <p className="shrink-0 border-t border-border-soft px-3 py-1.5 font-mono text-2xs tracking-data tabular-nums text-muted-foreground">
          {formatNumber(ranked.length)} / {formatNumber(total)} 个动画
        </p>
      ) : null}

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border-soft px-3 py-2">
        <Button
          className="w-full"
          disabled={!canExportSpine || exportingSpine}
          onClick={onExportSpine}
        >
          {exportingSpine ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowDownToLine data-icon="inline-start" />
          )}
          {exportingSpine ? "导出中…" : "导出为 Spine"}
        </Button>
        <p className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
          <Cloud className="mt-0.5 size-icon-sm shrink-0 text-cyan" aria-hidden="true" />
          {canExportSpine
            ? "将当前条目的骨骼、图集和贴图打成 ZIP 下载到本机。"
            : "选中并加载条目后即可导出。资源包以只读方式下载。"}
        </p>
      </footer>
    </section>
  );
});

type RankedGalleryItem = {
  readonly item: GalleryItem;
  readonly search: GallerySearchEntry;
  readonly match: { readonly positions: readonly number[] } | null;
};

/** Renders only catalog rows near the viewport. */
function GalleryItemList({
  ranked,
  selectedId,
  pendingId,
  onSelect,
}: {
  ranked: readonly RankedGalleryItem[];
  selectedId: string | null;
  pendingId: string | null;
  onSelect: (item: GalleryItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const pitch = readDesignTokenPx("--size-gallery-row");

  // TanStack Virtual returns functions that React Compiler cannot memoize.
  // eslint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: ranked.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pitch,
    overscan: 6,
  });

  const totalSize = virtualizer.getTotalSize();
  const rows = virtualizer.getVirtualItems();
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, ranked.length - 1));

  useEffect(() => {
    const selectedIndex = ranked.findIndex(({ item }) => item.id === selectedId);
    setActiveIndex((current) =>
      selectedIndex >= 0 ? selectedIndex : Math.min(current, Math.max(0, ranked.length - 1)),
    );
  }, [ranked, selectedId]);

  const moveActive = useCallback(
    (next: number) => {
      const index = Math.max(0, Math.min(next, ranked.length - 1));
      setActiveIndex(index);
      virtualizer.scrollToIndex(index);
    },
    [ranked.length, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (ranked.length === 0) return;
      const page = Math.max(1, Math.floor(event.currentTarget.clientHeight / pitch) - 1);
      if (event.key === "ArrowDown") moveActive(boundedActiveIndex + 1);
      else if (event.key === "ArrowUp") moveActive(boundedActiveIndex - 1);
      else if (event.key === "Home") moveActive(0);
      else if (event.key === "End") moveActive(ranked.length - 1);
      else if (event.key === "PageDown") moveActive(boundedActiveIndex + page);
      else if (event.key === "PageUp") moveActive(boundedActiveIndex - page);
      else if (event.key === "Enter" || event.key === " ") {
        const active = ranked[boundedActiveIndex];
        if (active) onSelect(active.item);
      } else {
        return;
      }
      event.preventDefault();
    },
    [boundedActiveIndex, moveActive, onSelect, pitch, ranked],
  );

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
      role="listbox"
      tabIndex={0}
      aria-label="托管的 Spine 动画"
      aria-busy={pendingId !== null}
      aria-activedescendant={
        ranked.length > 0 ? `hosted-animation-option-${boundedActiveIndex}` : undefined
      }
      onKeyDown={handleKeyDown}
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {/* Move one row container per scroll update. */}
        <div
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${rows[0]?.start ?? 0}px)` }}
        >
          {rows.map((row) => {
            const entry = ranked[row.index];
            if (!entry) return null;
            const { item, match } = entry;
            return (
              <div key={item.id} className="w-full pb-gallery-gap" style={{ height: row.size }}>
                <GalleryItemRow
                  id={`hosted-animation-option-${row.index}`}
                  item={item}
                  positions={match?.positions ?? null}
                  offsets={entry.search}
                  selected={item.id === selectedId}
                  active={row.index === boundedActiveIndex}
                  pending={item.id === pendingId}
                  onActivate={() => setActiveIndex(row.index)}
                  onSelect={(selectedItem) => {
                    setActiveIndex(row.index);
                    scrollRef.current?.focus({ preventScroll: true });
                    onSelect(selectedItem);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Highlights characters matched by the current query. */
function Marked({ text, positions }: { text: string; positions: readonly number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const marked = new Set(positions);
  const parts: React.ReactNode[] = [];
  let run = "";
  let runMarked = marked.has(0);

  const flush = (key: number) => {
    if (!run) return;
    parts.push(
      runMarked ? (
        <mark key={key} className="bg-transparent font-bold text-focus">
          {run}
        </mark>
      ) : (
        <span key={key}>{run}</span>
      ),
    );
    run = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const isMarked = marked.has(index);
    if (isMarked !== runMarked) {
      flush(index);
      runMarked = isMarked;
    }
    run += text[index];
  }
  flush(text.length);
  return <>{parts}</>;
}

/** Keeps unchanged rows mounted during virtual-list scrolling. */
const GalleryItemRow = memo(function GalleryItemRow({
  id,
  item,
  positions,
  offsets,
  selected,
  active,
  pending,
  onActivate,
  onSelect,
}: {
  id: string;
  item: GalleryItem;
  positions: readonly number[] | null;
  offsets: GallerySearchEntry | null;
  selected: boolean;
  active: boolean;
  pending: boolean;
  onActivate: () => void;
  onSelect: (item: GalleryItem) => void;
}) {
  const loader = item.bundle.loader ?? (item.bundle.assets?.length ? "自动识别" : "清单");
  const isCustomLoader = !["spine-bundle-v1", "spine-auto-v1", "清单", "自动识别"].includes(loader);
  const titleMarks = positions && offsets ? sliceMatch(positions, 0, offsets.titleEnd) : [];
  const variantMarks =
    positions && offsets ? sliceMatch(positions, offsets.variantStart, offsets.variantEnd) : [];
  const subtitle = [item.variant, item.collection].filter(Boolean).join(" · ") || "托管资源包";

  return (
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className={cn(
        "group flex h-full min-h-touch-target w-full cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors select-none",
        selected
          ? "border-primary bg-primary-soft text-foreground"
          : active
            ? "border-border bg-surface-raised text-foreground"
            : "border-transparent text-muted-foreground hover:border-border hover:bg-surface-raised hover:text-foreground",
      )}
      onPointerMove={onActivate}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(item);
      }}
    >
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border-soft bg-canvas">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-contain" />
        ) : (
          <GalleryVerticalEnd className="size-icon-lg text-cyan" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <strong className="truncate text-xs font-semibold text-foreground">
            <Marked text={item.title} positions={titleMarks} />
          </strong>
          {pending ? (
            <Spinner className="size-icon-sm shrink-0 text-primary" aria-label="加载中" />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-2xs">
          {item.variant ? (
            <>
              <Marked text={item.variant} positions={variantMarks} />
              {item.collection ? ` · ${item.collection}` : null}
            </>
          ) : (
            subtitle
          )}
        </span>
        {/* Keep the fixed row height used by the virtualizer. */}
        <span className="mt-1 flex items-center gap-1 overflow-hidden font-mono text-2xs tracking-data whitespace-nowrap">
          {item.version ? <span>{item.version}</span> : null}
          {item.format ? <span>{item.format.toUpperCase()}</span> : null}
          <span className={cn(isCustomLoader && "text-warning")}>{loader}</span>
        </span>
      </span>
    </div>
  );
});

function GalleryLoading() {
  return (
    <div className="flex flex-col gap-2" aria-live="polite" aria-label="正在加载画廊">
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Spinner className="text-primary" aria-hidden="true" />
        正在获取目录。选中后才会加载资源包。
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex min-h-gallery-row items-center gap-2 rounded-md border border-border-soft bg-canvas p-2"
        >
          <Skeleton className="size-10 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GalleryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="p-4">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>画廊不可用</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" /> 重试
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function GalleryItemError({
  title,
  message,
  detail,
  onRetry,
  onDismiss,
}: {
  title: string;
  message: string;
  detail: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyDetail = useCallback(async () => {
    await navigator.clipboard.writeText(detail);
    setCopied(true);
  }, [detail]);

  return (
    <Alert variant="destructive" className="p-3">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle className="truncate text-xs">无法打开 {title}</AlertTitle>
      <AlertDescription className="min-w-0 text-2xs">
        <p className="leading-relaxed">{message}</p>
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="group/details flex min-h-control-sm items-center gap-1 rounded-md text-2xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            技术详情
            <ChevronDown
              className="size-3 transition-transform group-data-panel-open/details:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 rounded-md bg-canvas p-2">
              <p
                className="max-h-picker-list overflow-y-auto whitespace-pre-wrap break-words font-mono text-2xs leading-body text-muted-foreground select-text"
                aria-label="技术错误详情"
              >
                {detail}
              </p>
              <Button
                className="mt-2"
                size="xs"
                variant="ghost"
                onClick={() => detached(copyDetail(), "gallery.copy-error-detail")}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "已复制" : "复制详情"}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" /> 重试
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            关闭
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function GalleryEmpty() {
  return (
    <Empty className="min-h-32 border border-border bg-canvas p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileBox className="text-cyan" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>还没有发布的动画</EmptyTitle>
        <EmptyDescription>在配置的画廊清单里添加条目，然后刷新这个面板。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
