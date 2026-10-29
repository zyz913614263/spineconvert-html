import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BookOpen, ChevronDown, CircleCheck, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { createCustomSource, type GallerySource } from "@/domain/gallery/sources";
import { errorMessage } from "@/lib/utils";
import { detached } from "@/lib/detached";
import { fetchGalleryCatalog } from "@/services/gallery-client";

type ProbeState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "ready"; source: GallerySource; title: string; items: number }
  | { phase: "failed"; message: string };

type GallerySourceDialogProps = {
  open: boolean;
  /** Opens the manifest reference on entry. */
  referenceFirst?: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (source: GallerySource) => void;
};

/** Checks and adds a gallery manifest URL. */
export function GallerySourceDialog({
  open,
  referenceFirst = false,
  onOpenChange,
  onAdd,
}: GallerySourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-var(--space-8))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加画廊库</DialogTitle>
          <DialogDescription>
            把 Spine Thing 指向一个清单地址。目录以只读方式加载，这个库会保存在本机。
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 gap-4 overflow-y-auto px-4">
          <AddSourceForm
            referenceFirst={referenceFirst}
            onAdd={onAdd}
            onDone={() => onOpenChange(false)}
          />
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function AddSourceForm({
  referenceFirst,
  onAdd,
  onDone,
}: {
  referenceFirst: boolean;
  onAdd: (source: GallerySource) => void;
  onDone: () => void;
}) {
  const urlId = useId();
  const labelId = useId();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [probe, setProbe] = useState<ProbeState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const check = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setProbe({ phase: "checking" });
    try {
      const source = createCustomSource(url, label);
      const catalog = await fetchGalleryCatalog(source.manifestUrl, controller.signal);
      if (controller.signal.aborted) return;
      setProbe({
        phase: "ready",
        source: { ...source, label: label.trim() || catalog.title || source.label },
        title: catalog.title,
        items: catalog.items.length,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setProbe({
        phase: "failed",
        message: errorMessage(error),
      });
    }
  }, [label, url]);

  const runCheck = useCallback(() => detached(check(), "gallery-source.check"), [check]);

  const add = useCallback(() => {
    if (probe.phase !== "ready") return;
    onAdd(probe.source);
    onDone();
  }, [onAdd, onDone, probe]);

  const checking = probe.phase === "checking";

  return (
    <>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (probe.phase === "ready") add();
          else runCheck();
        }}
      >
        <FieldGroup className="gap-3">
          <Field data-invalid={probe.phase === "failed"}>
            <FieldLabel htmlFor={urlId}>清单地址</FieldLabel>
            <Input
              id={urlId}
              value={url}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com/spine/catalog.json"
              className="font-mono text-2xs"
              aria-invalid={probe.phase === "failed"}
              onChange={(event) => {
                setUrl(event.target.value);
                setProbe({ phase: "idle" });
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={labelId}>名称（可选）</FieldLabel>
            <Input
              id={labelId}
              value={label}
              autoComplete="off"
              placeholder="留空则使用清单里的名称"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </FieldGroup>

        <ProbeResult probe={probe} />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!url.trim() || checking}
            onClick={runCheck}
          >
            {checking ? <Spinner data-icon="inline-start" /> : null}
            {checking ? "检查中…" : "检查地址"}
          </Button>
          <Button type="submit" disabled={probe.phase !== "ready"}>
            添加库
          </Button>
        </div>
      </form>

      <ManifestReference defaultOpen={referenceFirst} />
    </>
  );
}

function ProbeResult({ probe }: { probe: ProbeState }) {
  if (probe.phase === "ready") {
    return (
      <Alert className="bg-success/10 text-success">
        <CircleCheck aria-hidden="true" />
        <AlertDescription className="text-success">
          已连接到「{probe.title}」· {probe.items} 个动画 · 可以添加。
        </AlertDescription>
      </Alert>
    );
  }
  if (probe.phase === "failed") {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" />
        <AlertDescription>{probe.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

const EXAMPLE_MANIFEST = `{
  "schemaVersion": 1,
  "catalog": { "id": "studio-rigs", "title": "Studio Rigs" },
  "defaults": { "premultipliedAlpha": "auto" },
  "items": [
    {
      "id": "hero-idle",
      "title": "Hero",
      "variant": "Default skin",
      "collection": "Characters",
      "tags": ["hero", "idle"],
      "version": "4.2.11",
      "format": "skel",
      "thumbnail": { "url": "thumbs/hero.png" },
      "bundle": {
        "skeleton": { "url": "hero/hero.skel", "format": "auto" },
        "atlas":    { "url": "hero/hero.atlas" },
        "textures": [{ "url": "hero/hero.png" }],
        "defaultAnimation": "idle"
      }
    }
  ]
}`;

/** Documents the accepted manifest fields beside the URL form. */
function ManifestReference({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group/ref flex w-full items-center justify-between gap-2 rounded-md border border-border-soft bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover">
        <span className="flex items-center gap-2">
          <BookOpen className="size-icon-sm text-cyan" aria-hidden="true" />
          <span className="text-sm font-semibold">清单长什么样</span>
        </span>
        <ChevronDown className="size-icon shrink-0 text-muted-foreground transition-transform group-data-panel-open/ref:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 pt-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            清单是一份列出资源包的 JSON
            文件。其中的地址都相对清单自身解析，所以目录和资源放在一起时可以用相对路径。主机必须返回允许的
            CORS 头，因为浏览器会在本机拉取这些资源。
          </p>

          <dl className="grid gap-2">
            <ReferenceRow term="schemaVersion" detail="必须是 1。" />
            <ReferenceRow term="catalog.title" detail="库选择器里显示的名称。" />
            <ReferenceRow
              term="defaults.premultipliedAlpha"
              detail="可选，作用于目录中的每个资源包：auto、premultiplied 或 straight。单个条目可以覆盖。"
            />
            <ReferenceRow term="items[].id" detail="在目录内唯一且稳定；重复的会被拒绝。" />
            <ReferenceRow
              term="items[].bundle"
              detail="可以是 skeleton + atlas + textures，也可以用 assets[] 从内容推断角色。"
            />
            <ReferenceRow term="items[].tags" detail="会和标题、变体、合集一起参与搜索。" />
          </dl>

          <div className="overflow-x-auto rounded-md border border-border-soft bg-canvas">
            <pre className="p-3 font-mono text-2xs leading-relaxed text-foreground">
              <code>{EXAMPLE_MANIFEST}</code>
            </pre>
          </div>

          <p>
            没有声明角色的资源包可以改用 <code className="font-mono">assets</code>
            ，Spine Thing 会根据内容判断哪个是骨骼、图集和贴图，也包括 Unity 风格的{" "}
            <code className="font-mono">.skel.bytes</code> 和{" "}
            <code className="font-mono">.atlas.txt</code>。任意资源上可选的{" "}
            <code className="font-mono">bytes</code> 和 <code className="font-mono">sha256</code>{" "}
            会在下载后校验。
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReferenceRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-x-3 compact:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="font-mono text-2xs tracking-data text-cyan">{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}
