import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Layers, Search } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fuzzyTarget, rankFuzzy } from "@/domain/search/fuzzy";
import { readDesignTokenPx } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import type { AnimationInfo } from "@/render/spine-renderer";

type Virtualizer = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;

function animationLabel(animation: AnimationInfo | null): string {
  return animation?.name ?? "";
}

function sameAnimation(left: AnimationInfo, right: AnimationInfo): boolean {
  return left.name === right.name;
}

/** Fuzzy ranks clip names so abbreviated queries such as `wlkcyc` match `Walk_Cycle`. */
function useRankedAnimations(animations: readonly AnimationInfo[], query: string) {
  const targets = useMemo(
    () => animations.map((animation) => fuzzyTarget(animation.name)),
    [animations],
  );
  return useMemo(
    () =>
      rankFuzzy(animations, query, (_, index) => targets[index] ?? fuzzyTarget("")).map(
        (entry) => entry.item,
      ),
    [animations, query, targets],
  );
}

/** Scrolls virtual rows selected by keyboard navigation. */
function useHighlightScroll(virtualizerRef: RefObject<Virtualizer | null>) {
  return useCallback(
    (
      animation: AnimationInfo | undefined,
      details: ComboboxPrimitive.Root.HighlightEventDetails,
    ) => {
      const virtualizer = virtualizerRef.current;
      if (!animation || !virtualizer) return;
      const { index, reason } = details;
      const atEnd = index === virtualizer.options.count - 1;
      const shouldScroll = reason === "none" || (reason === "keyboard" && (index === 0 || atEnd));
      if (!shouldScroll) return;
      queueMicrotask(() => {
        virtualizer.scrollToIndex(index, { align: atEnd ? "start" : "end" });
      });
    },
    [virtualizerRef],
  );
}

export const AnimationPicker = memo(function AnimationPicker({
  animations,
  selected,
  onChange,
}: {
  animations: readonly AnimationInfo[];
  selected: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const virtualizerRef = useRef<Virtualizer | null>(null);
  const handleItemHighlighted = useHighlightScroll(virtualizerRef);
  const filtered = useRankedAnimations(animations, query);

  const value = useMemo(
    () => animations.find((animation) => animation.name === selected) ?? null,
    [animations, selected],
  );
  const singleAnimation = animations.length === 1 ? (value ?? animations[0]) : null;

  const handleValueChange = useCallback(
    (animation: AnimationInfo | null) => {
      if (animation) onChange(animation.name);
    },
    [onChange],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  if (singleAnimation) {
    return (
      <div
        className="flex h-control-sm min-w-0 max-w-56 shrink items-center gap-1.5 rounded-md bg-surface px-2.5"
        aria-label={`基础动画：${singleAnimation.name}`}
        title={singleAnimation.name}
      >
        <span className="shrink-0 text-2xs font-medium text-muted-foreground">动画</span>
        <span className="truncate text-xs font-medium">{singleAnimation.name}</span>
      </div>
    );
  }

  return (
    <Combobox
      virtualized
      items={animations}
      filteredItems={filtered}
      value={value}
      open={open}
      inputValue={query}
      itemToStringLabel={animationLabel}
      itemToStringValue={animationLabel}
      isItemEqualToValue={sameAnimation}
      onValueChange={handleValueChange}
      onInputValueChange={setQuery}
      onOpenChange={handleOpenChange}
      onItemHighlighted={handleItemHighlighted}
    >
      <ComboboxTrigger
        size="sm"
        aria-label="选择基础动画"
        className="w-24 shrink-0 border-transparent bg-surface font-medium compact:w-56"
      >
        <ComboboxValue className="truncate" placeholder="没有动画" />
      </ComboboxTrigger>

      <PickerPopup
        label="选择基础动画"
        footer={<PickerFooter label="基础动画" total={animations.length} />}
      >
        <VirtualRows open={open} virtualizerRef={virtualizerRef} />
      </PickerPopup>
    </Combobox>
  );
});

/** Selects ordered clips to apply after the base animation. */
export const AnimationLayerPicker = memo(function AnimationLayerPicker({
  animations,
  base,
  layers,
  onChange,
}: {
  animations: readonly AnimationInfo[];
  base: string;
  layers: readonly string[];
  onChange: (names: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const virtualizerRef = useRef<Virtualizer | null>(null);
  const handleItemHighlighted = useHighlightScroll(virtualizerRef);

  // Do not apply the base clip twice.
  const items = useMemo(
    () => animations.filter((animation) => animation.name !== base),
    [animations, base],
  );
  const filtered = useRankedAnimations(items, query);
  const byName = useMemo(() => new Map(items.map((item) => [item.name, item])), [items]);
  const value = useMemo(
    () =>
      layers
        .map((name) => byName.get(name))
        .filter((animation): animation is AnimationInfo => animation !== undefined),
    [byName, layers],
  );

  const handleValueChange = useCallback(
    (next: AnimationInfo[]) => onChange(next.map((animation) => animation.name)),
    [onChange],
  );
  const clear = useCallback(() => onChange([]), [onChange]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const stacked = value.length;
  const label = stacked === 0 ? "在基础动画上叠加" : `${stacked} 个叠加动画`;

  return (
    <Combobox
      multiple
      virtualized
      items={items}
      filteredItems={filtered}
      value={value}
      open={open}
      inputValue={query}
      itemToStringLabel={animationLabel}
      itemToStringValue={animationLabel}
      isItemEqualToValue={sameAnimation}
      onValueChange={handleValueChange}
      onInputValueChange={setQuery}
      onOpenChange={handleOpenChange}
      onItemHighlighted={handleItemHighlighted}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              size="sm"
              aria-label={label}
              className={cn(
                "w-auto shrink-0 gap-1 border-transparent bg-surface px-2 text-muted-foreground",
                stacked > 0 && "bg-primary-soft text-focus",
              )}
            />
          }
        >
          <Layers className="size-icon" aria-hidden="true" />
          {stacked > 0 ? (
            <span className="font-mono text-2xs tracking-data tabular-nums">{stacked}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <PickerPopup
        label="叠加动画"
        footer={
          <PickerFooter label="叠加" total={items.length}>
            {stacked > 0 ? (
              <Button size="xs" variant="ghost" className="shrink-0 text-focus" onClick={clear}>
                清除
              </Button>
            ) : null}
          </PickerFooter>
        }
      >
        <VirtualRows open={open} virtualizerRef={virtualizerRef} />
      </PickerPopup>
    </Combobox>
  );
});

/** Shares the filter, list, and count footer between both clip pickers. */
function PickerPopup({
  label,
  children,
  footer,
}: {
  label: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <ComboboxContent align="start" aria-label={label} className="min-w-72">
      <div className="relative shrink-0 p-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-icon -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <ComboboxInput className="pl-8" placeholder="筛选动画…" aria-label="筛选动画" />
      </div>
      <ComboboxEmpty>没有名称匹配的动画。</ComboboxEmpty>
      <ComboboxList>{children}</ComboboxList>
      {footer}
    </ComboboxContent>
  );
}

/** Renders only the visible clip rows. */
function VirtualRows({
  open,
  virtualizerRef,
}: {
  open: boolean;
  virtualizerRef: RefObject<Virtualizer | null>;
}) {
  const items = ComboboxPrimitive.useFilteredItems<AnimationInfo>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const size = readDesignTokenPx("--size-picker-row");

  // TanStack Virtual returns functions that React Compiler cannot memoize.
  // eslint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: open,
    count: items.length,
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
  if (items.length === 0) return null;

  return (
    <div
      ref={handleScrollRef}
      role="presentation"
      data-slot="virtual-picker-scroll"
      className="h-[min(var(--size-picker-list),var(--padded-total-size))] max-h-[var(--available-height)] min-h-0 overflow-y-auto overscroll-contain p-1"
      // SAFETY: React supports CSS custom properties, but CSSProperties omits them.
      style={{ "--padded-total-size": `${paddedTotalSize}px` } as CSSProperties}
    >
      <div role="presentation" className="relative w-full" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((row) => {
          const animation = items[row.index];
          if (!animation) return null;
          return (
            <ComboboxItem
              key={row.key}
              index={row.index}
              value={animation}
              aria-setsize={items.length}
              aria-posinset={row.index + 1}
              className="absolute top-0 left-0 w-full"
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              <span className="truncate">{animation.name}</span>
              <span className="ml-auto shrink-0 font-mono text-2xs tracking-data tabular-nums text-muted-foreground">
                {animation.duration.toFixed(2)}s
              </span>
            </ComboboxItem>
          );
        })}
      </div>
    </div>
  );
}

function PickerFooter({
  label,
  total,
  children,
}: {
  label: string;
  total: number;
  children?: ReactNode;
}) {
  const items = ComboboxPrimitive.useFilteredItems<AnimationInfo>();
  const countLabel =
    items.length === total ? `${total} 个动画` : `${items.length} / ${total} 个动画`;

  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-soft px-2.5 py-1.5 text-2xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        <span className="truncate font-mono tracking-data tabular-nums">{countLabel}</span>
      </span>
      {children}
    </footer>
  );
}
