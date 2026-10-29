import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { usePanelRef, type Layout } from "react-resizable-panels";
import { type } from "arktype";

import type { GalleryItem } from "@/domain/gallery/manifest";
import type { GallerySource } from "@/domain/gallery/sources";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { expandBoundsToAspect, type Bounds } from "@/domain/export/layout";
import {
  DEFAULT_MAX_FILE_SIZE_MEGABYTES,
  decimalMegabytesToBytes,
} from "@/domain/export/optimization";
import type { ExportFormat } from "@/domain/export/protocol";
import { createAssetBundle, type SpineAssetBundle } from "@/domain/spine/assets";
import {
  DEFAULT_TARGETS,
  SUPPORTED_VERSION_FAMILIES,
  parseSupportedVersion,
  type SpineVersion,
} from "@/domain/spine/version";
import { detached } from "@/lib/detached";
import { readDesignToken } from "@/lib/tokens";
import { errorMessage } from "@/lib/utils";
import { spineBundleZipFilename, zipSpineAssetBundle } from "@/services/spine-bundle-zip";
import {
  type AnimationInfo,
  type PremultipliedAlphaMode,
  type RenderState,
} from "@/render/spine-renderer";
import type { SpineRenderer } from "@/render/spine-renderer";
import type { AnimationExporter } from "@/services/animation-exporter";
import { ConverterClient, type ConversionResult } from "@/services/converter-client";
import { detectExportCapabilities, type ExportCapabilities } from "@/services/export-capabilities";

import { AppHeader, type WorkspaceMode } from "./components/app-header";
import { ExportTask, type ExportTaskState } from "./components/export-task";
import { GalleryPanel } from "./components/gallery-panel";
import { GallerySourceDialog } from "./components/gallery-source-dialog";
import { InspectorPanel, type ExportPanelSettings } from "./components/inspector-panel";
import { PreviewStage, type FrameDragAction } from "./components/preview-stage";
import {
  ProjectPanel,
  type ConversionDownload,
  type ConversionPanelSettings,
} from "./components/project-panel";
import { StatusBar, type WorkStatus } from "./components/status-bar";
import { usePersistentState } from "./hooks/use-persistent-state";
import { useGalleryBundle, useGalleryCatalog } from "./hooks/use-gallery";
import { useGallerySources } from "./hooks/use-gallery-sources";
import { PlaybackClock } from "./playback-clock";
import { ViewStore } from "./view-store";

import "./styles.css";

// Load overlays after the main editor so they do not delay the first screen.
const importCommandMenu = () => import("./components/command-menu");
const importMobilePanels = () => import("./components/mobile-panels");

const CommandMenu = lazy(() =>
  importCommandMenu().then((module) => ({ default: module.CommandMenu })),
);
const MobilePanels = lazy(() =>
  importMobilePanels().then((module) => ({ default: module.MobilePanels })),
);

/** Runs `warm` when the workspace next goes idle, with a hard deadline. */
function onIdle(warm: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const handle = requestIdleCallback(warm, { timeout: 3_000 });
    return () => cancelIdleCallback(handle);
  }
  // Browsers without the idle API fall back to a plain deadline.
  const timer = setTimeout(warm, 1_000);
  return () => clearTimeout(timer);
}

type LoadedDocument = {
  id: string;
  displayName: string;
  origin:
    | { kind: "local" }
    | { kind: "gallery"; sourceUrl: string; itemId: string; loaderId: string };
  bundle: SpineAssetBundle;
  bytes: Uint8Array;
  previewJson: string;
  version: SpineVersion;
  animation: string;
  /** Clips applied after the base animation. */
  layers: readonly string[];
  skin: string;
  /** The alpha mode for this bundle's atlas. */
  premultipliedAlpha: PremultipliedAlphaMode;
};

type GalleryPreparationError = {
  itemId: string;
  title: string;
  message: string;
  detail: string;
};

type ConvertedDownload = ConversionDownload & {
  documentId: string;
  data: Uint8Array;
  filename: string;
};

type PanDrag = { x: number; y: number };

type FrameDrag = {
  action: FrameDragAction;
  frameKey: string;
  start: { x: number; y: number };
  initial: Bounds;
};

const INITIAL_RENDER_STATE: RenderState = {
  animation: null,
  layers: [],
  duration: 0,
  playing: false,
};

const INITIAL_CAPABILITIES: ExportCapabilities = {
  gif: true,
  webm: false,
  mp4: false,
};

/** How far one arrow key nudges a frame handle, in workspace units. */
const ARROW_DIRECTIONS = new Map([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: 1 }],
  ["ArrowDown", { x: 0, y: -1 }],
]);

const INITIAL_EXPORT_TASK: ExportTaskState = {
  phase: "idle",
  progress: 0,
  title: "",
  detail: "",
};

const INITIAL_CONVERSION_SETTINGS: ConversionPanelSettings = {
  family: "4.2",
  version: DEFAULT_TARGETS["4.2"],
  format: "json",
  removeCurves: false,
};

const INITIAL_EXPORT_SETTINGS: ExportPanelSettings = {
  format: "webm",
  width: 1024,
  height: 1024,
  autoFit: true,
  padding: 2,
  fps: 30,
  quality: 0.8,
  sizeLimitEnabled: false,
  maxFileSizeMegabytes: DEFAULT_MAX_FILE_SIZE_MEGABYTES,
  transparent: true,
  background: "",
  framing: "auto",
};

const DEFAULT_PANEL_LAYOUT: Layout = { project: 18, stage: 64, inspector: 18 };
const DEFAULT_CUSTOM_FRAME_MARGIN = 0.05;
const persistedPanelLayout = type({
  project: "number",
  stage: "number",
  inspector: "number",
}).as<Layout>();
const persistedWorkspaceMode = type("'canvas' | 'gallery'");

const IDLE_STATUS = "尚未加载资源包。";

/** Limits export progress updates to ten per second. */
const TASK_UPDATE_INTERVAL_MS = 100;

/** Reads the breakpoint once because media queries cannot use CSS variables. */
let workspaceQuery = "";
function workspaceMediaQuery(): string {
  if (!workspaceQuery) {
    workspaceQuery = `(min-width: ${readDesignToken("--size-workspace-breakpoint")})`;
  }
  return workspaceQuery;
}

function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function asBlob(data: Uint8Array, contentType: string): Blob {
  return new Blob([data.slice().buffer], { type: contentType });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

function boundsBetween(first: { x: number; y: number }, second: { x: number; y: number }): Bounds {
  const minimumExtent = 0.01;
  const width = Math.max(minimumExtent, Math.abs(second.x - first.x));
  const height = Math.max(minimumExtent, Math.abs(second.y - first.y));
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width,
    height,
  };
}

function frameKeyFor(documentId: string, animation: string): string {
  return `${documentId}\u0000${animation}`;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const converterRef = useRef<ConverterClient | null>(null);
  const exporterRef = useRef<AnimationExporter | null>(null);
  const exporterPromiseRef = useRef<Promise<AnimationExporter> | null>(null);
  const exporterDisposedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const pendingFilesRef = useRef<readonly File[] | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const frameDragRef = useRef<FrameDrag | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const galleryPreparationRef = useRef("");
  const stillCaptureRef = useRef(false);
  const activeDocumentRef = useRef<LoadedDocument | null>(null);
  const documentsRef = useRef<LoadedDocument[]>([]);
  const projectPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [clock] = useState(() => new PlaybackClock());
  const [viewStore] = useState(() => new ViewStore());

  const isWorkspace = useMediaQuery(workspaceMediaQuery());
  const [documents, setDocuments] = useState<LoadedDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [customFrames, setCustomFrames] = useState<Readonly<Record<string, Bounds>>>({});
  const [download, setDownload] = useState<ConvertedDownload | null>(null);
  const [spineZipExporting, setSpineZipExporting] = useState(false);
  const [status, setStatus] = useState<WorkStatus>("idle");
  const [statusText, setStatusText] = useState(IDLE_STATUS);
  const [renderState, setRenderState] = useState<RenderState>(INITIAL_RENDER_STATE);
  const [animations, setAnimations] = useState<readonly AnimationInfo[]>([]);
  const [skins, setSkins] = useState<readonly string[]>([]);
  const [selectedSkin, setSelectedSkin] = useState("");
  const [atlasPremultipliedAlpha, setAtlasPremultipliedAlpha] = useState(false);
  const [conversionSettings, setConversionSettings] = useState(INITIAL_CONVERSION_SETTINGS);
  const [exportSettings, setExportSettings] = useState<ExportPanelSettings>(() => ({
    ...INITIAL_EXPORT_SETTINGS,
    background: readDesignToken("--workspace"),
  }));
  const [capabilities, setCapabilities] = useState<ExportCapabilities>(INITIAL_CAPABILITIES);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [debug, setDebug] = useState(false);
  const [looping, setLooping] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cropEditing, setCropEditing] = useState(false);
  const [exportTask, setExportTask] = useState<ExportTaskState>(INITIAL_EXPORT_TASK);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandMounted, setCommandMounted] = useState(false);
  const [mobileProjectOpen, setMobileProjectOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mode, setMode] = usePersistentState(
    "spine-thing.workspace-mode",
    "canvas" satisfies WorkspaceMode,
    persistedWorkspaceMode,
  );
  const [pendingGalleryId, setPendingGalleryId] = useState<string | null>(null);
  const [galleryPreparationError, setGalleryPreparationError] =
    useState<GalleryPreparationError | null>(null);
  const [sourceDialog, setSourceDialog] = useState<{ open: boolean; reference: boolean }>({
    open: false,
    reference: false,
  });
  const [closeAllConfirmationOpen, setCloseAllConfirmationOpen] = useState(false);
  const [panelLayout, setPanelLayout] = usePersistentState(
    "spine-thing.panel-layout",
    DEFAULT_PANEL_LAYOUT,
    persistedPanelLayout,
  );

  const gallerySources = useGallerySources();
  const galleryCatalogQuery = useGalleryCatalog(gallerySources.selected, mode === "gallery");
  const galleryCatalog = galleryCatalogQuery.data ?? null;
  const pendingGalleryItem = useMemo(
    () => galleryCatalog?.items.find((item) => item.id === pendingGalleryId) ?? null,
    [galleryCatalog?.items, pendingGalleryId],
  );
  const pendingGalleryDocument = useMemo(() => {
    const sourceUrl = galleryCatalog?.sourceUrl;
    if (!sourceUrl || !pendingGalleryId) return null;
    return (
      documents.find(
        (workspaceDocument) =>
          workspaceDocument.origin.kind === "gallery" &&
          workspaceDocument.origin.sourceUrl === sourceUrl &&
          workspaceDocument.origin.itemId === pendingGalleryId,
      ) ?? null
    );
  }, [documents, galleryCatalog?.sourceUrl, pendingGalleryId]);
  const galleryBundleQuery = useGalleryBundle(
    pendingGalleryDocument ? null : pendingGalleryItem,
    galleryCatalog?.sourceUrl ?? null,
    mode === "gallery",
  );

  const activeDocument = useMemo(
    () => documents.find((workspaceDocument) => workspaceDocument.id === activeId) ?? null,
    [activeId, documents],
  );
  const selectedGalleryId =
    activeDocument?.origin.kind === "gallery" &&
    activeDocument.origin.sourceUrl === galleryCatalog?.sourceUrl
      ? activeDocument.origin.itemId
      : null;
  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const activeFrameKey =
    activeDocument && renderState.animation
      ? frameKeyFor(activeDocument.id, renderState.animation)
      : null;
  const customBounds = activeFrameKey ? (customFrames[activeFrameKey] ?? null) : null;

  const hasAnimation = renderState.animation !== null && renderState.duration > 0;
  const busy = status === "loading" || status === "converting" || status === "exporting";

  useEffect(() => {
    const converter = new ConverterClient();
    converterRef.current = converter;
    exporterDisposedRef.current = false;

    return () => {
      exporterDisposedRef.current = true;
      exportAbortRef.current?.abort();
      converter.dispose();
      exporterRef.current?.dispose();
      converterRef.current = null;
      exporterRef.current = null;
      exporterPromiseRef.current = null;
    };
  }, []);

  const ensureExporter = useCallback(async () => {
    if (exporterRef.current) return exporterRef.current;
    if (exporterPromiseRef.current) return exporterPromiseRef.current;

    const promise = import("@/services/animation-exporter").then(({ AnimationExporter }) => {
      const exporter = new AnimationExporter();
      if (exporterDisposedRef.current) {
        exporter.dispose();
        throw new DOMException("导出运行时已停止。", "AbortError");
      }
      exporterRef.current = exporter;
      return exporter;
    });
    exporterPromiseRef.current = promise;
    try {
      return await promise;
    } catch (error) {
      if (exporterPromiseRef.current === promise) exporterPromiseRef.current = null;
      throw error;
    }
  }, []);

  // Resolve the command menu during idle time so Ctrl+K can open it without a fetch.
  useEffect(
    () =>
      onIdle(() => {
        setCommandMounted(true);
        detached(importMobilePanels(), "mobile-panels.preload");
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    detached(
      (async () => {
        const nextCapabilities = await detectExportCapabilities();
        if (active) {
          setCapabilities(nextCapabilities);
          setExportSettings((current) => {
            if (nextCapabilities[current.format]) return current;
            const format: ExportFormat = nextCapabilities.webm
              ? "webm"
              : nextCapabilities.mp4
                ? "mp4"
                : "gif";
            return { ...current, format, transparent: format !== "mp4" && current.transparent };
          });
        }
      })(),
      "export-capabilities.detect",
    );
    return () => {
      active = false;
    };
  }, []);

  // Keep one WebGL context alive across layout changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let readyTimer = 0;
    let renderer: SpineRenderer | null = null;

    detached(
      (async () => {
        try {
          const { SpineRenderer } = await import("@/render/spine-renderer");
          if (disposed) return;
          const canvasBackground = readDesignToken("--canvas");
          const initializedRenderer = new SpineRenderer(canvas, setRenderState, {
            background: canvasBackground,
            onTime: clock.set,
            onView: viewStore.set,
          });
          if (disposed) {
            initializedRenderer.dispose();
            return;
          }
          renderer = initializedRenderer;
          rendererRef.current = initializedRenderer;
          readyTimer = window.setTimeout(() => setRuntimeReady(true), 0);

          // Restore the active bundle after Strict Mode or hot reload replaces the renderer.
          const workspaceDocument = activeDocumentRef.current;
          if (workspaceDocument) {
            const operation = loadSequenceRef.current + 1;
            loadSequenceRef.current = operation;
            detached(
              (async () => {
                const hydrated = await hydrateRenderer(initializedRenderer, workspaceDocument);
                if (!disposed && loadSequenceRef.current === operation) {
                  setAnimations(hydrated.animations);
                  setSkins(hydrated.skins);
                  setSelectedSkin(hydrated.skin);
                  setAtlasPremultipliedAlpha(hydrated.atlasPremultipliedAlpha);
                }
              })(),
              "renderer.restore-document",
            );
          }
        } catch (error) {
          if (disposed) return;
          readyTimer = window.setTimeout(() => {
            setRuntimeReady(false);
            setStatus("error");
            setStatusText(errorMessage(error));
          }, 0);
        }
      })(),
      "renderer.initialize",
    );

    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      loadSequenceRef.current += 1;
      renderer?.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
      setRuntimeReady(false);
    };
  }, [clock, viewStore]);

  const updateCustomBounds = useCallback((frameKey: string, bounds: Bounds | null) => {
    setCustomFrames((current) => {
      if (!bounds) {
        if (!(frameKey in current)) return current;
        const next = { ...current };
        delete next[frameKey];
        return next;
      }
      return { ...current, [frameKey]: bounds };
    });
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!drag || !renderer || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const point = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const initial = drag.initial;
      let bounds: Bounds;

      if (drag.action === "draw") {
        bounds = boundsBetween(drag.start, point);
      } else if (drag.action === "move") {
        bounds = {
          ...initial,
          x: initial.x + point.x - drag.start.x,
          y: initial.y + point.y - drag.start.y,
        };
      } else {
        const left = initial.x;
        const right = initial.x + initial.width;
        const bottom = initial.y;
        const top = initial.y + initial.height;
        if (drag.action === "northWest") {
          bounds = boundsBetween({ x: right, y: bottom }, point);
        } else if (drag.action === "northEast") {
          bounds = boundsBetween({ x: left, y: bottom }, point);
        } else if (drag.action === "southWest") {
          bounds = boundsBetween({ x: right, y: top }, point);
        } else {
          bounds = boundsBetween({ x: left, y: top }, point);
        }
      }
      updateCustomBounds(drag.frameKey, bounds);
    };

    const handlePointerUp = () => {
      frameDragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [updateCustomBounds]);

  const loadFiles = useCallback(
    async (files: Iterable<File>) => {
      // Copy the FileList before resetting its input.
      const selectedFiles = Array.from(files);
      if (selectedFiles.length === 0) return;

      setMode("canvas");
      const operation = loadSequenceRef.current + 1;
      loadSequenceRef.current = operation;
      setStatus("loading");
      setDownload(null);

      const converter = converterRef.current;
      const renderer = rendererRef.current;
      if (!converter || !renderer) {
        pendingFilesRef.current = selectedFiles;
        setStatusText("正在启动本机运行时，选中的资源包会自动打开…");
        return;
      }

      pendingFilesRef.current = null;
      setStatusText("正在校验资源包并准备 Spine 4.2 预览…");

      try {
        const bundle = await createAssetBundle(selectedFiles);
        const bytes = new Uint8Array(await bundle.skeleton.arrayBuffer());

        const preview = await converter.convert({
          input: bytes,
          inputFormat: bundle.skeletonFormat,
          outputFormat: "json",
          outputVersion: DEFAULT_TARGETS["4.2"],
        });
        if (loadSequenceRef.current !== operation) return;

        const previewJson = new TextDecoder("utf-8", { fatal: true }).decode(preview.data);
        await renderer.load(previewJson, bundle);
        if (loadSequenceRef.current !== operation) return;

        const workspaceDocument: LoadedDocument = {
          id: crypto.randomUUID(),
          displayName: bundle.skeleton.name,
          origin: { kind: "local" },
          bundle,
          bytes,
          previewJson,
          version: preview.inputVersion,
          animation: renderer.state.animation ?? "",
          layers: [],
          skin: renderer.skins[0] ?? "",
          premultipliedAlpha: "auto",
        };
        setDocuments((current) => [...current, workspaceDocument]);
        setActiveId(workspaceDocument.id);
        setAnimations(renderer.animations);
        setSkins(renderer.skins);
        setSelectedSkin(workspaceDocument.skin);
        setAtlasPremultipliedAlpha(renderer.atlasPremultipliedAlpha);
        setCropEditing(false);
        setStatus("ready");
        setStatusText(
          `已加载 ${bundle.skeleton.name} · Spine ${preview.inputVersion} · ${renderer.animations.length} 个动画。`,
        );
      } catch (error) {
        if (loadSequenceRef.current !== operation) return;
        setStatus("error");
        setStatusText(
          error instanceof Error
            ? `${error.message} 请确认骨骼、图集和每一张贴图页是一起选中的。`
            : String(error),
        );
      }
    },
    [setMode],
  );

  useEffect(() => {
    if (!runtimeReady) return;
    const pendingFiles = pendingFilesRef.current;
    if (!pendingFiles) return;
    pendingFilesRef.current = null;
    detached(loadFiles(pendingFiles), "files.load-pending");
  }, [loadFiles, runtimeReady]);

  const activateLoadedDocument = useCallback(async (workspaceDocument: LoadedDocument) => {
    const renderer = rendererRef.current;
    if (!renderer) return "本机预览运行时尚未就绪。";
    const previousDocument = activeDocumentRef.current;
    const operation = loadSequenceRef.current + 1;
    loadSequenceRef.current = operation;
    setStatus("loading");
    setStatusText(`正在打开 ${workspaceDocument.bundle.skeleton.name}…`);
    setCropEditing(false);
    try {
      const hydrated = await hydrateRenderer(renderer, workspaceDocument);
      if (loadSequenceRef.current !== operation) return;
      setActiveId(workspaceDocument.id);
      setAnimations(hydrated.animations);
      setSkins(hydrated.skins);
      setSelectedSkin(hydrated.skin);
      setAtlasPremultipliedAlpha(hydrated.atlasPremultipliedAlpha);
      setDownload(null);
      setStatus("ready");
      setStatusText(
        `已打开 ${workspaceDocument.bundle.skeleton.name} · ${hydrated.animations.length} 个动画。`,
      );
      return null;
    } catch (error) {
      if (loadSequenceRef.current !== operation) return;
      if (previousDocument && previousDocument.id !== workspaceDocument.id) {
        try {
          const restored = await hydrateRenderer(renderer, previousDocument);
          if (loadSequenceRef.current !== operation) return;
          setActiveId(previousDocument.id);
          setAnimations(restored.animations);
          setSkins(restored.skins);
          setSelectedSkin(restored.skin);
          setAtlasPremultipliedAlpha(restored.atlasPremultipliedAlpha);
        } catch {
          renderer.clear();
          setActiveId(null);
          setAnimations([]);
          setSkins([]);
          setSelectedSkin("");
          setAtlasPremultipliedAlpha(false);
        }
      }
      const detail = errorMessage(error);
      setStatus("error");
      setStatusText(`无法打开 ${workspaceDocument.displayName}。上一份文档已保留。`);
      return detail;
    }
  }, []);

  const selectGalleryItem = useCallback(
    (item: GalleryItem) => {
      const sourceUrl = galleryCatalog?.sourceUrl;
      if (!sourceUrl) return;

      setGalleryPreparationError(null);
      setPendingGalleryId(item.id);
      setDownload(null);
      const existing = documentsRef.current.find(
        (workspaceDocument) =>
          workspaceDocument.origin.kind === "gallery" &&
          workspaceDocument.origin.sourceUrl === sourceUrl &&
          workspaceDocument.origin.itemId === item.id,
      );
      if (existing) {
        galleryPreparationRef.current = `${sourceUrl}\u0000${item.id}`;
        if (existing.id === activeDocumentRef.current?.id) {
          setPendingGalleryId(null);
          return;
        }
        detached(
          (async () => {
            const detail = await activateLoadedDocument(existing);
            setPendingGalleryId((current) => (current === item.id ? null : current));
            if (detail) {
              setGalleryPreparationError({
                itemId: item.id,
                title: item.title,
                message: `无法重新打开「${item.title}」。上一份文档仍在使用。`,
                detail,
              });
            }
          })(),
          "gallery.reopen-document",
        );
        return;
      }

      galleryPreparationRef.current = "";
      loadSequenceRef.current += 1;
      setStatus("loading");
      setStatusText(`正在从画廊下载 ${item.title}…`);
    },
    [activateLoadedDocument, galleryCatalog?.sourceUrl],
  );

  useEffect(() => {
    const item = pendingGalleryItem;
    const sourceUrl = galleryCatalog?.sourceUrl;
    const loaded = galleryBundleQuery.data;
    if (mode !== "gallery" || !runtimeReady || !item || !sourceUrl || !loaded) return;

    const selectionKey = `${sourceUrl}\u0000${item.id}`;
    if (galleryPreparationRef.current === selectionKey) return;

    const existing = documentsRef.current.find(
      (workspaceDocument) =>
        workspaceDocument.origin.kind === "gallery" &&
        workspaceDocument.origin.sourceUrl === sourceUrl &&
        workspaceDocument.origin.itemId === item.id,
    );
    if (existing) {
      galleryPreparationRef.current = selectionKey;
      if (existing.id !== activeDocumentRef.current?.id) {
        detached(activateLoadedDocument(existing), "gallery.activate-existing");
      }
      return;
    }

    galleryPreparationRef.current = selectionKey;
    const operation = loadSequenceRef.current + 1;
    loadSequenceRef.current = operation;
    const previousDocument = activeDocumentRef.current;
    let canceled = false;
    let liveRendererTouched = false;
    setStatus("loading");
    setStatusText(`正在用 ${loaded.loaderId} 准备 ${item.title}…`);

    detached(
      (async () => {
        try {
          const converter = converterRef.current;
          const renderer = rendererRef.current;
          if (!converter || !renderer) {
            throw new Error("本机运行时仍在启动，请重试。");
          }
          const preview = await converter.convert({
            input: loaded.bytes,
            inputFormat: loaded.bundle.skeletonFormat,
            outputFormat: "json",
            outputVersion: DEFAULT_TARGETS["4.2"],
          });
          if (canceled || loadSequenceRef.current !== operation) return;

          const previewJson = new TextDecoder("utf-8", { fatal: true }).decode(preview.data);
          const prepared = await prepareGalleryPreview({
            previewJson,
            bundle: loaded.bundle,
            premultipliedAlpha: loaded.premultipliedAlpha,
            defaultAnimation: loaded.defaultAnimation,
            defaultSkin: loaded.defaultSkin,
          });
          if (canceled || loadSequenceRef.current !== operation) return;

          liveRendererTouched = true;
          await renderer.load(previewJson, loaded.bundle);
          if (canceled || loadSequenceRef.current !== operation) return;

          renderer.setPremultipliedAlpha(loaded.premultipliedAlpha);
          const animation = prepared.animation;
          if (animation && renderer.state.animation !== animation)
            renderer.selectAnimations([animation]);
          const skin = prepared.skin;
          if (skin) renderer.selectSkin(skin);

          const workspaceDocument: LoadedDocument = {
            id: crypto.randomUUID(),
            displayName: item.variant ? `${item.title}: ${item.variant}` : item.title,
            origin: { kind: "gallery", sourceUrl, itemId: item.id, loaderId: loaded.loaderId },
            bundle: loaded.bundle,
            bytes: loaded.bytes,
            previewJson,
            version: preview.inputVersion,
            animation,
            layers: [],
            skin,
            premultipliedAlpha: loaded.premultipliedAlpha,
          };
          setDocuments((current) => [...current, workspaceDocument]);
          setActiveId(workspaceDocument.id);
          setAnimations(prepared.animations);
          setSkins(prepared.skins);
          setSelectedSkin(skin);
          setAtlasPremultipliedAlpha(renderer.atlasPremultipliedAlpha);
          setCropEditing(false);
          setGalleryPreparationError(null);
          setPendingGalleryId((current) => (current === item.id ? null : current));
          setStatus("ready");
          setStatusText(
            `已加载 ${workspaceDocument.displayName} · ${loaded.diagnostics.join(" · ")}。`,
          );
        } catch (error) {
          if (canceled || loadSequenceRef.current !== operation) return;
          const renderer = rendererRef.current;
          if (liveRendererTouched && renderer) {
            try {
              if (previousDocument) {
                const restored = await hydrateRenderer(renderer, previousDocument);
                if (canceled || loadSequenceRef.current !== operation) return;
                setActiveId(previousDocument.id);
                setAnimations(restored.animations);
                setSkins(restored.skins);
                setSelectedSkin(restored.skin);
                setAtlasPremultipliedAlpha(restored.atlasPremultipliedAlpha);
              } else {
                renderer.clear();
                setActiveId(null);
                setAnimations([]);
                setSkins([]);
                setSelectedSkin("");
                setAtlasPremultipliedAlpha(false);
              }
            } catch {
              renderer.clear();
              setActiveId(null);
              setAnimations([]);
              setSkins([]);
              setSelectedSkin("");
              setAtlasPremultipliedAlpha(false);
            }
          }
          const detail = errorMessage(error);
          galleryPreparationRef.current = "";
          setPendingGalleryId((current) => (current === item.id ? null : current));
          setGalleryPreparationError({
            itemId: item.id,
            title: item.title,
            message: `无法打开「${item.title}」。资源包可能不完整，或与 Spine 4.2 预览运行时不兼容。当前文档未改动。`,
            detail,
          });
          setStatus("error");
          setStatusText(`无法打开 ${item.title}。当前文档未改动。`);
        }
      })(),
      "gallery.prepare-document",
    );

    return () => {
      canceled = true;
      if (galleryPreparationRef.current === selectionKey) galleryPreparationRef.current = "";
      if (loadSequenceRef.current === operation) loadSequenceRef.current += 1;
    };
  }, [
    activateLoadedDocument,
    galleryBundleQuery.data,
    galleryCatalog?.sourceUrl,
    mode,
    runtimeReady,
    pendingGalleryItem,
  ]);

  useEffect(() => {
    if (mode !== "gallery") return;
    const error = galleryBundleQuery.error;
    const item = pendingGalleryItem;
    if (!error || !item) return;
    const timer = window.setTimeout(() => {
      const detail = errorMessage(error);
      galleryPreparationRef.current = "";
      setPendingGalleryId((current) => (current === item.id ? null : current));
      setGalleryPreparationError({
        itemId: item.id,
        title: item.title,
        message: `无法下载「${item.title}」。请检查画廊连接后重试。当前文档未改动。`,
        detail,
      });
      setStatus("error");
      setStatusText(`无法下载 ${item.title}。当前文档未改动。`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [galleryBundleQuery.error, mode, pendingGalleryItem]);

  useEffect(() => {
    if (mode !== "gallery") return;
    const error = galleryCatalogQuery.error;
    if (!error) return;
    const timer = window.setTimeout(() => {
      galleryPreparationRef.current = "";
      setStatus("error");
      setStatusText(errorMessage(error));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [galleryCatalogQuery.error, mode]);

  const clearWorkspace = useCallback(() => {
    loadSequenceRef.current += 1;
    galleryPreparationRef.current = "";
    setPendingGalleryId(null);
    setGalleryPreparationError(null);
    rendererRef.current?.clear();
    setActiveId(null);
    setAnimations([]);
    setSkins([]);
    setSelectedSkin("");
    setRenderState(INITIAL_RENDER_STATE);
    setCropEditing(false);
    setDownload(null);
    setStatus("idle");
    setStatusText(IDLE_STATUS);
  }, []);

  const dropFrames = useCallback((documentIds: readonly string[]) => {
    if (documentIds.length === 0) return;
    const prefixes = documentIds.map((id) => `${id}\u0000`);
    setCustomFrames((current) => {
      const entries = Object.entries(current).filter(
        ([key]) => !prefixes.some((prefix) => key.startsWith(prefix)),
      );
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, []);

  const activateDocument = useCallback(
    (id: string) => {
      if (id === activeId || busy) return;
      const workspaceDocument = documents.find((item) => item.id === id);
      if (workspaceDocument) {
        detached(activateLoadedDocument(workspaceDocument), "documents.activate");
      }
    },
    [activateLoadedDocument, activeId, busy, documents],
  );

  const closeDocument = useCallback(
    (id: string) => {
      if (busy) return;
      const remaining = documents.filter((item) => item.id !== id);
      if (remaining.length === documents.length) return;
      setDocuments(remaining);
      dropFrames([id]);
      if (id !== activeId) return;
      const nextDocument = remaining[0];
      if (nextDocument) detached(activateLoadedDocument(nextDocument), "documents.activate-next");
      else clearWorkspace();
    },
    [activateLoadedDocument, activeId, busy, clearWorkspace, documents, dropFrames],
  );

  const closeOtherDocuments = useCallback(
    (id: string) => {
      if (busy) return;
      const removed = documents.filter((item) => item.id !== id);
      const kept = documents.find((item) => item.id === id);
      if (!kept || removed.length === 0) return;
      setDocuments([kept]);
      dropFrames(removed.map((item) => item.id));
      if (id !== activeId) {
        detached(activateLoadedDocument(kept), "documents.activate-kept");
      }
    },
    [activateLoadedDocument, activeId, busy, documents, dropFrames],
  );

  const closeAllDocuments = useCallback(() => {
    if (busy || documents.length === 0) return;
    setCloseAllConfirmationOpen(true);
  }, [busy, documents.length]);

  const confirmCloseAllDocuments = useCallback(() => {
    if (busy || documents.length === 0) {
      setCloseAllConfirmationOpen(false);
      return;
    }
    setDocuments([]);
    dropFrames(documents.map((item) => item.id));
    clearWorkspace();
    setCloseAllConfirmationOpen(false);
  }, [busy, clearWorkspace, documents, dropFrames]);

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files) detached(loadFiles(files), "files.load-selected");
      event.target.value = "";
    },
    [loadFiles],
  );

  const chooseFiles = useCallback(() => {
    if (busy) return;
    setMode("canvas");
    fileInputRef.current?.click();
  }, [busy, setMode]);

  const dropFilesIntoWorkspace = useCallback(
    (files: FileList) => detached(loadFiles(files), "files.load-dropped"),
    [loadFiles],
  );

  const handleConversionSettingsChange = useCallback((next: ConversionPanelSettings) => {
    setConversionSettings((current) => ({
      ...next,
      version: next.family === current.family ? next.version : DEFAULT_TARGETS[next.family],
    }));
    setDownload(null);
  }, []);

  const convert = useCallback(async () => {
    const workspaceDocument = activeDocumentRef.current;
    const converter = converterRef.current;
    if (!workspaceDocument || !converter) return;
    setStatus("converting");
    setStatusText(`正在本机工作线程中转换 ${workspaceDocument.bundle.skeleton.name}…`);
    setDownload(null);
    try {
      const version = parseSupportedVersion(conversionSettings.version);
      const result: ConversionResult = await converter.convert({
        input: workspaceDocument.bytes,
        inputFormat: workspaceDocument.bundle.skeletonFormat,
        outputFormat: conversionSettings.format,
        outputVersion: version,
        removeCurves: conversionSettings.removeCurves,
      });
      const filename = `${basename(workspaceDocument.bundle.skeleton.name)}-spine-${version}.${conversionSettings.format}`;
      setDownload({
        documentId: workspaceDocument.id,
        data: result.data,
        filename,
        format: conversionSettings.format,
        version,
      });
      setStatus("ready");
      setStatusText(
        `已转换 ${result.inputVersion} → ${version}（${conversionSettings.format.toUpperCase()}）。可在工程面板中保存。`,
      );
    } catch (error) {
      setStatus("error");
      setStatusText(errorMessage(error));
    }
  }, [conversionSettings]);

  const runConvert = useCallback(() => detached(convert(), "convert.run"), [convert]);

  const downloadConversion = useCallback(() => {
    if (!download || download.documentId !== activeId) return;
    const mime = download.format === "json" ? "application/json" : "application/octet-stream";
    downloadBlob(asBlob(download.data, mime), download.filename);
  }, [activeId, download]);

  /** Packs the loaded gallery bundle into one zip and downloads it. */
  const exportGalleryAsSpine = useCallback(async () => {
    const workspaceDocument = activeDocumentRef.current;
    if (
      !workspaceDocument ||
      workspaceDocument.origin.kind !== "gallery" ||
      busy ||
      spineZipExporting
    ) {
      return;
    }

    setSpineZipExporting(true);
    setStatusText(`正在打包 ${workspaceDocument.displayName} 的 Spine 资源…`);
    try {
      const zipped = await zipSpineAssetBundle(workspaceDocument.bundle);
      const filename = spineBundleZipFilename(
        workspaceDocument.bundle.skeleton.name,
        workspaceDocument.displayName,
      );
      downloadBlob(asBlob(zipped, "application/zip"), filename);
      setStatus("ready");
      setStatusText(
        `已导出 ${filename} · 骨骼、图集与 ${workspaceDocument.bundle.pageNames.length} 张贴图。`,
      );
    } catch (error) {
      setStatus("error");
      setStatusText(errorMessage(error));
    } finally {
      setSpineZipExporting(false);
    }
  }, [busy, spineZipExporting]);

  const runExportGalleryAsSpine = useCallback(
    () => detached(exportGalleryAsSpine(), "gallery.export-spine-zip"),
    [exportGalleryAsSpine],
  );

  const selectAnimation = useCallback((name: string) => {
    const workspaceDocument = activeDocumentRef.current;
    if (!workspaceDocument || !name) return;
    // Remove the new base clip from the layer list to avoid applying it twice.
    const layers = workspaceDocument.layers.filter((layer) => layer !== name);
    rendererRef.current?.selectAnimations([name, ...layers]);
    setDocuments((current) =>
      current.map((item) =>
        item.id === workspaceDocument.id ? { ...item, animation: name, layers } : item,
      ),
    );
  }, []);

  const selectLayers = useCallback((names: readonly string[]) => {
    const workspaceDocument = activeDocumentRef.current;
    if (!workspaceDocument) return;
    const base = rendererRef.current?.state.animation;
    if (!base) return;
    const layers = names.filter((name) => name !== base);
    rendererRef.current?.selectAnimations([base, ...layers]);
    setDocuments((current) =>
      current.map((item) => (item.id === workspaceDocument.id ? { ...item, layers } : item)),
    );
  }, []);

  const selectSkin = useCallback((name: string) => {
    const workspaceDocument = activeDocumentRef.current;
    if (!workspaceDocument || !name) return;
    rendererRef.current?.selectSkin(name);
    setSelectedSkin(name);
    setDocuments((current) =>
      current.map((item) => (item.id === workspaceDocument.id ? { ...item, skin: name } : item)),
    );
  }, []);

  const fit = useCallback(() => rendererRef.current?.fit(), []);

  const changePremultipliedAlpha = useCallback((alphaMode: PremultipliedAlphaMode) => {
    const workspaceDocument = activeDocumentRef.current;
    if (!workspaceDocument) return;
    rendererRef.current?.setPremultipliedAlpha(alphaMode);
    setDocuments((current) =>
      current.map((item) =>
        item.id === workspaceDocument.id ? { ...item, premultipliedAlpha: alphaMode } : item,
      ),
    );
  }, []);

  const toggleDebug = useCallback(() => {
    setDebug((current) => {
      const next = !current;
      rendererRef.current?.setDebug(next);
      return next;
    });
  }, []);

  const toggleLoop = useCallback(() => {
    setLooping((current) => {
      const next = !current;
      rendererRef.current?.setLooping(next);
      return next;
    });
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    rendererRef.current?.setPlaying(playing);
  }, []);

  const togglePlaying = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setPlaying(!renderer.state.playing);
  }, []);

  // Pause before seeking so playback cannot overwrite the chosen time.
  const seek = useCallback((time: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (renderer.state.playing) renderer.setPlaying(false);
    renderer.seek(time);
  }, []);

  const stepFrames = useCallback(
    (frames: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (renderer.state.playing) renderer.setPlaying(false);
      renderer.stepFrames(frames, exportSettings.fps);
    },
    [exportSettings.fps],
  );

  const changeSpeed = useCallback((nextSpeed: number) => {
    setSpeed(nextSpeed);
    rendererRef.current?.setSpeed(nextSpeed);
  }, []);

  const beginFrameEdit = useCallback(() => {
    const renderer = rendererRef.current;
    const workspaceDocument = activeDocumentRef.current;
    if (!workspaceDocument || !renderer) return;
    const animation = renderer.state.animation;
    if (!animation) return;
    const key = frameKeyFor(workspaceDocument.id, animation);
    setCustomFrames((current) =>
      key in current
        ? current
        : {
            ...current,
            [key]: expandBoundsToAspect(
              renderer.contentBounds,
              exportSettings.width,
              exportSettings.height,
              DEFAULT_CUSTOM_FRAME_MARGIN,
            ),
          },
    );
    setExportSettings((current) => ({ ...current, framing: "custom" }));
    setCropEditing(true);
  }, [exportSettings.height, exportSettings.width]);

  const toggleCrop = useCallback(() => {
    setCropEditing((editing) => {
      if (editing) return false;
      beginFrameEdit();
      return true;
    });
  }, [beginFrameEdit]);

  const resetFrame = useCallback(() => {
    if (activeFrameKey) updateCustomBounds(activeFrameKey, null);
    setExportSettings((current) => ({ ...current, framing: "auto" }));
    setCropEditing(false);
  }, [activeFrameKey, updateCustomBounds]);

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const renderer = rendererRef.current;
      const workspaceDocument = activeDocumentRef.current;
      if (!renderer || !workspaceDocument || !renderer.state.animation) return;
      event.currentTarget.focus();
      const rect = event.currentTarget.getBoundingClientRect();
      if (cropEditing) {
        const start = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
        const initial = boundsBetween(start, start);
        const key = frameKeyFor(workspaceDocument.id, renderer.state.animation);
        frameDragRef.current = { action: "draw", frameKey: key, start, initial };
        updateCustomBounds(key, initial);
        event.preventDefault();
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      panDragRef.current = { x: event.clientX, y: event.clientY };
    },
    [cropEditing, updateCustomBounds],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const previous = panDragRef.current;
      if (!previous || cropEditing) return;
      rendererRef.current?.pan(event.clientX - previous.x, event.clientY - previous.y);
      panDragRef.current = { x: event.clientX, y: event.clientY };
    },
    [cropEditing],
  );

  const handleCanvasPointerEnd = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panDragRef.current = null;
  }, []);

  const handleCanvasWheel = useCallback((event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    rendererRef.current?.zoomAt(
      Math.exp(event.deltaY * 0.001),
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
    );
  }, []);

  const handleFramePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, action: FrameDragAction) => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas || !activeFrameKey || !customBounds) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const start = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      frameDragRef.current = { action, frameKey: activeFrameKey, start, initial: customBounds };
    },
    [activeFrameKey, customBounds],
  );

  const handleFrameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, action: FrameDragAction) => {
      if (!activeFrameKey || !customBounds) return;
      const direction = ARROW_DIRECTIONS.get(event.key);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();

      const baseStep = Math.max(0.1, Math.min(customBounds.width, customBounds.height) * 0.02);
      const step = baseStep * (event.shiftKey ? 10 : 1);
      const deltaX = direction.x * step;
      const deltaY = direction.y * step;
      const left = customBounds.x;
      const right = customBounds.x + customBounds.width;
      const bottom = customBounds.y;
      const top = customBounds.y + customBounds.height;
      let nextBounds: Bounds;

      if (action === "move" || action === "draw") {
        nextBounds = { ...customBounds, x: customBounds.x + deltaX, y: customBounds.y + deltaY };
      } else if (action === "northWest") {
        nextBounds = boundsBetween({ x: right, y: bottom }, { x: left + deltaX, y: top + deltaY });
      } else if (action === "northEast") {
        nextBounds = boundsBetween({ x: left, y: bottom }, { x: right + deltaX, y: top + deltaY });
      } else if (action === "southWest") {
        nextBounds = boundsBetween({ x: right, y: top }, { x: left + deltaX, y: bottom + deltaY });
      } else {
        nextBounds = boundsBetween({ x: left, y: top }, { x: right + deltaX, y: bottom + deltaY });
      }
      updateCustomBounds(activeFrameKey, nextBounds);
    },
    [activeFrameKey, customBounds, updateCustomBounds],
  );

  const toggleProjectPanel = useCallback(() => {
    const panel = projectPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setProjectOpen(true);
    } else {
      panel.collapse();
      setProjectOpen(false);
    }
  }, [projectPanelRef]);

  const toggleInspectorPanel = useCallback(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
    } else {
      panel.collapse();
      setInspectorOpen(false);
    }
  }, [inspectorPanelRef]);

  const toggleProjectControls = useCallback(() => {
    if (isWorkspace) toggleProjectPanel();
    else setMobileProjectOpen((open) => !open);
  }, [isWorkspace, toggleProjectPanel]);

  const showProjectControls = useCallback(() => {
    if (isWorkspace) {
      projectPanelRef.current?.expand();
      setProjectOpen(true);
    } else {
      setMobileProjectOpen(true);
    }
  }, [isWorkspace, projectPanelRef]);

  const changeMode = useCallback(
    (nextMode: WorkspaceMode) => {
      setMode(nextMode);
      if (nextMode === "gallery") showProjectControls();
    },
    [setMode, showProjectControls],
  );

  const toggleInspectorControls = useCallback(() => {
    if (isWorkspace) toggleInspectorPanel();
    else setMobileInspectorOpen((open) => !open);
  }, [isWorkspace, toggleInspectorPanel]);

  const closeMobileProject = useCallback(() => setMobileProjectOpen(false), []);
  const closeMobileInspector = useCallback(() => setMobileInspectorOpen(false), []);
  const selectMobileGalleryItem = useCallback(
    (item: GalleryItem) => {
      selectGalleryItem(item);
      setMobileProjectOpen(false);
    },
    [selectGalleryItem],
  );

  const exportTaskThrottleRef = useRef(0);
  const pushExportTask = useCallback((next: ExportTaskState, immediate = false) => {
    const now = performance.now();
    if (!immediate && now - exportTaskThrottleRef.current < TASK_UPDATE_INTERVAL_MS) return;
    exportTaskThrottleRef.current = now;
    startTransition(() => setExportTask(next));
  }, []);

  const exportAnimation = useCallback(async () => {
    const workspaceDocument = activeDocumentRef.current;
    const renderer = rendererRef.current;
    const animation = renderer?.state.animation;
    const duration = renderer?.state.duration ?? 0;
    if (!workspaceDocument || !renderer || !animation || duration <= 0) return;
    // Match the current preview, including stacked clips.
    const stack = [animation, ...(renderer?.state.layers ?? [])];
    if (exportAbortRef.current) return;
    if (exportSettings.framing === "custom" && !customBounds) {
      beginFrameEdit();
      setStatus("ready");
      setStatusText("请在画布上绘制导出框，然后再次导出。");
      return;
    }

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setStatus("exporting");
    setStatusText("正在启动本机导出运行时…");
    pushExportTask(
      {
        phase: "measuring",
        progress: 0,
        title: "正在启动导出器",
        detail: "仅为本次导出加载本机编码器。",
      },
      true,
    );

    try {
      const exporter = await ensureExporter();
      if (controller.signal.aborted) throw new DOMException("已取消导出。", "AbortError");
      setStatusText(`正在测量 ${animation} 的完整动作范围…`);
      pushExportTask(
        {
          phase: "measuring",
          progress: 0,
          title: `正在准备 ${animation}`,
          detail: "正在本机采样画面与骨骼范围。",
        },
        true,
      );
      // Pause preview drawing while the exporter uses the GPU.
      renderer.suspend();
      const result = await exporter.export(
        {
          json: workspaceDocument.previewJson,
          bundle: workspaceDocument.bundle,
          animations: stack,
          skin: selectedSkin,
        },
        {
          format: exportSettings.format,
          width: clampInteger(exportSettings.width, 2, 4096),
          height: clampInteger(exportSettings.height, 2, 4096),
          fps: clampInteger(exportSettings.fps, 1, 120),
          duration,
          quality: exportSettings.quality,
          maxBytes: exportSettings.sizeLimitEnabled
            ? decimalMegabytesToBytes(exportSettings.maxFileSizeMegabytes)
            : undefined,
          transparent: exportSettings.transparent,
          background: exportSettings.background,
          autoFit: exportSettings.autoFit,
          padding: clampInteger(exportSettings.padding, 0, 2047),
          premultipliedAlpha: workspaceDocument.premultipliedAlpha,
          looping,
          manualBounds:
            exportSettings.framing === "custom" ? (customBounds ?? undefined) : undefined,
          signal: controller.signal,
          onMeasureProgress: (completed, total) => {
            pushExportTask({
              phase: "measuring",
              progress: (completed / total) * 0.12,
              title: `正在准备 ${animation}`,
              detail: `正在采样第 ${completed} / ${total} 帧。`,
            });
          },
          onLayout: (layout, pass) => {
            setStatusText(
              exportSettings.sizeLimitEnabled
                ? `第 ${pass} 次编码，尺寸 ${layout.width} × ${layout.height}。`
                : `正在编码 ${layout.width} × ${layout.height} 的帧。`,
            );
            pushExportTask(
              {
                phase: "rendering",
                progress: 0.12,
                title:
                  pass > 1
                    ? `正在把 ${animation} 压到 ${exportSettings.maxFileSizeMegabytes} MB`
                    : `正在导出 ${animation}`,
                detail: `${layout.width} × ${layout.height} · ${exportSettings.fps} FPS · ${exportSettings.format.toUpperCase()}${pass > 1 ? ` · 第 ${pass} 次` : ""}`,
              },
              true,
            );
          },
          onProgress: (completed, total, pass) => {
            const done = completed === total;
            pushExportTask(
              {
                phase: done ? "finalizing" : "rendering",
                progress: done ? 0.98 : 0.12 + (completed / total) * 0.84,
                title: done
                  ? "正在检查文件大小"
                  : pass > 1
                    ? `正在把 ${animation} 压到 ${exportSettings.maxFileSizeMegabytes} MB`
                    : `正在导出 ${animation}`,
                detail: done
                  ? "正在检查编码后的文件大小。"
                  : `第 ${completed} / ${total} 帧${pass > 1 ? ` · 第 ${pass} 次` : ""}。`,
              },
              done,
            );
          },
        },
      );
      const extension = exportSettings.format;
      const filename = `${basename(workspaceDocument.bundle.skeleton.name)}-${animation}.${extension}`;
      downloadBlob(result.blob, filename);
      setStatus("ready");
      setStatusText(
        `已将 ${animation} 导出为 ${extension.toUpperCase()} · ${result.width}×${result.height}。`,
      );
      pushExportTask(
        {
          phase: "complete",
          progress: 1,
          title: "导出完成",
          detail: `${filename} · ${result.width} × ${result.height} · ${(result.blob.size / 1_000_000).toFixed(2)} MB${result.passes > 1 ? ` · ${result.passes} 次` : ""}`,
        },
        true,
      );
    } catch (error) {
      const canceled = error instanceof DOMException && error.name === "AbortError";
      setStatus(canceled ? "ready" : "error");
      const message = canceled
        ? "已取消导出。预览和设置已保留。"
        : error instanceof Error
          ? error.message
          : String(error);
      setStatusText(message);
      pushExportTask(
        {
          phase: canceled ? "canceled" : "error",
          progress: 0,
          title: canceled ? "已取消导出" : "导出需要处理",
          detail: message,
        },
        true,
      );
    } finally {
      exportAbortRef.current = null;
      rendererRef.current?.resume();
    }
  }, [
    beginFrameEdit,
    customBounds,
    ensureExporter,
    exportSettings,
    looping,
    pushExportTask,
    selectedSkin,
  ]);

  const captureStill = useCallback(async () => {
    const workspaceDocument = activeDocumentRef.current;
    const renderer = rendererRef.current;
    const animation = renderer?.state.animation;
    if (!workspaceDocument || !renderer || !animation) return;
    if (exportAbortRef.current || stillCaptureRef.current) return;

    stillCaptureRef.current = true;
    const time = clock.get();
    const frame = Math.round(time * exportSettings.fps);
    setStatus("exporting");
    setStatusText(`正在把 ${animation} 的第 ${frame} 帧写成透明 PNG…`);
    try {
      const exporter = await ensureExporter();
      const result = await exporter.captureStill(
        {
          json: workspaceDocument.previewJson,
          bundle: workspaceDocument.bundle,
          animations: [animation, ...renderer.state.layers],
          skin: selectedSkin,
        },
        {
          time,
          width: clampInteger(exportSettings.width, 2, 4096),
          height: clampInteger(exportSettings.height, 2, 4096),
          autoFit: exportSettings.autoFit,
          padding: clampInteger(exportSettings.padding, 0, 2047),
          background: exportSettings.background,
          premultipliedAlpha: workspaceDocument.premultipliedAlpha,
          looping,
          manualBounds:
            exportSettings.framing === "custom" ? (customBounds ?? undefined) : undefined,
        },
      );
      const filename = `${basename(workspaceDocument.bundle.skeleton.name)}-${animation}-f${frame}.png`;
      downloadBlob(result.blob, filename);
      setStatus("ready");
      setStatusText(`已保存 ${filename} · ${result.width}×${result.height} · 透明。`);
    } catch (error) {
      setStatus("error");
      setStatusText(errorMessage(error));
    } finally {
      stillCaptureRef.current = false;
    }
  }, [clock, customBounds, ensureExporter, exportSettings, looping, selectedSkin]);

  const runCaptureStill = useCallback(
    () => detached(captureStill(), "export.capture-still"),
    [captureStill],
  );

  const runExport = useCallback(
    () => detached(exportAnimation(), "export.run-animation"),
    [exportAnimation],
  );
  const cancelExport = useCallback(() => exportAbortRef.current?.abort(), []);
  const dismissExportTask = useCallback(() => setExportTask(INITIAL_EXPORT_TASK), []);
  const openCommandMenu = useCallback(() => {
    setCommandMounted(true);
    setCommandOpen(true);
  }, []);

  // Keep one key listener while its commands change with editor state.
  const shortcuts = {
    chooseFiles,
    fit,
    hasAnimation,
    hasSource: activeDocument !== null,
    runCaptureStill,
    runExport,
    stepFrames,
    togglePlaying,
    toggleCrop,
    toggleDebug,
    toggleInspectorControls,
    toggleLoop,
    toggleProjectControls,
  };
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const commands = shortcutsRef.current;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (commandKey && key === "k") {
        event.preventDefault();
        setCommandMounted(true);
        setCommandOpen(true);
        return;
      }
      if (commandKey && key === "o") {
        event.preventDefault();
        commands.chooseFiles();
        return;
      }
      if (commandKey && event.key === "1") {
        event.preventDefault();
        commands.toggleProjectControls();
        return;
      }
      if (commandKey && event.key === "2") {
        event.preventDefault();
        commands.toggleInspectorControls();
        return;
      }
      if (commandKey && key === "e" && commands.hasAnimation) {
        event.preventDefault();
        if (event.shiftKey) commands.runCaptureStill();
        else commands.runExport();
        return;
      }
      if (commandKey || editing) return;

      if (event.key === "Escape") {
        setCropEditing(false);
        return;
      }
      if (!commands.hasSource) return;

      if (event.key === " ") {
        event.preventDefault();
        commands.togglePlaying();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        commands.stepFrames(direction * (event.shiftKey ? 10 : 1));
      } else if (key === "f") {
        event.preventDefault();
        commands.fit();
      } else if (key === "b") {
        event.preventDefault();
        commands.toggleDebug();
      } else if (key === "c") {
        event.preventDefault();
        commands.toggleCrop();
      } else if (key === "l") {
        event.preventDefault();
        commands.toggleLoop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const documentTabs = useMemo(
    () =>
      documents.map((workspaceDocument) => ({
        id: workspaceDocument.id,
        name: workspaceDocument.displayName,
        version: workspaceDocument.version,
      })),
    [documents],
  );

  // Keep the retry callback stable even though React Query replaces its result objects.
  const galleryQueriesRef = useRef({ catalog: galleryCatalogQuery, bundle: galleryBundleQuery });
  useEffect(() => {
    galleryQueriesRef.current = { catalog: galleryCatalogQuery, bundle: galleryBundleQuery };
  });
  const retryGallery = useCallback(() => {
    if (galleryPreparationError) {
      setGalleryPreparationError(null);
      setPendingGalleryId(galleryPreparationError.itemId);
      return;
    }
    const { catalog, bundle } = galleryQueriesRef.current;
    if (bundle.isError) detached(bundle.refetch(), "gallery.retry-bundle");
    else detached(catalog.refetch(), "gallery.retry-catalog");
  }, [galleryPreparationError]);
  const dismissGalleryError = useCallback(() => setGalleryPreparationError(null), []);

  // Clear catalog-scoped selection before changing libraries.
  const { selectSource, addSource, removeSource } = gallerySources;
  const changeGallerySource = useCallback(
    (id: string) => {
      setPendingGalleryId(null);
      setGalleryPreparationError(null);
      galleryPreparationRef.current = "";
      selectSource(id);
    },
    [selectSource],
  );

  const addGallerySource = useCallback(
    (source: GallerySource) => {
      setPendingGalleryId(null);
      setGalleryPreparationError(null);
      galleryPreparationRef.current = "";
      addSource(source);
    },
    [addSource],
  );

  const removeGallerySource = useCallback(
    (id: string) => {
      if (gallerySources.selected.id === id) {
        setPendingGalleryId(null);
        setGalleryPreparationError(null);
      }
      removeSource(id);
    },
    [gallerySources.selected.id, removeSource],
  );

  const openAddGallerySource = useCallback(
    () => setSourceDialog({ open: true, reference: false }),
    [],
  );
  const openManifestReference = useCallback(
    () => setSourceDialog({ open: true, reference: true }),
    [],
  );
  const closeSourceDialog = useCallback(
    (open: boolean) => setSourceDialog((current) => ({ ...current, open })),
    [],
  );

  const galleryPanelProps = {
    catalog: galleryCatalog,
    sources: gallerySources.sources,
    selectedSource: gallerySources.selected,
    selectedId: selectedGalleryId,
    pendingId: pendingGalleryId,
    loading: galleryCatalogQuery.isPending && galleryCatalogQuery.isFetching,
    fetching: galleryCatalogQuery.isFetching || galleryBundleQuery.isFetching,
    error: galleryCatalogQuery.error instanceof Error ? galleryCatalogQuery.error.message : null,
    preparationError: galleryPreparationError,
    canExportSpine:
      selectedGalleryId !== null && pendingGalleryId === null && !busy && !spineZipExporting,
    exportingSpine: spineZipExporting,
    onExportSpine: runExportGalleryAsSpine,
    onSelect: selectGalleryItem,
    onSelectSource: changeGallerySource,
    onRemoveSource: removeGallerySource,
    onAddSource: openAddGallerySource,
    onOpenReference: openManifestReference,
    onRetry: retryGallery,
    onDismissError: dismissGalleryError,
  };

  const projectPanelProps = {
    bundle: activeDocument?.bundle ?? null,
    version: activeDocument?.version ?? null,
    settings: conversionSettings,
    families: SUPPORTED_VERSION_FAMILIES,
    busy,
    loading: status === "loading",
    converting: status === "converting",
    download: download?.documentId === activeId ? download : null,
    premultipliedAlpha: activeDocument?.premultipliedAlpha ?? "auto",
    atlasPremultipliedAlpha,
    onPremultipliedAlphaChange: changePremultipliedAlpha,
    onChooseFiles: chooseFiles,
    onDropFiles: dropFilesIntoWorkspace,
    onSettingsChange: handleConversionSettingsChange,
    onConvert: runConvert,
    onDownload: downloadConversion,
  };

  const inspectorPanelProps = {
    selectedAnimation: renderState.animation ?? "",
    stackedLayers: renderState.layers.length,
    duration: renderState.duration,
    settings: exportSettings,
    capabilities,
    customBounds,
    cropEditing,
    exporting: status === "exporting",
    busy,
    onSettingsChange: setExportSettings,
    onEditFrame: beginFrameEdit,
    onResetFrame: resetFrame,
    onExport: runExport,
    onExportFrame: runCaptureStill,
  };

  const stage = (
    <PreviewStage
      canvasRef={canvasRef}
      clock={clock}
      viewStore={viewStore}
      hasSource={activeDocument !== null}
      animations={animations}
      layers={renderState.layers}
      skins={skins}
      selectedSkin={selectedSkin}
      renderState={renderState}
      debug={debug}
      looping={looping}
      speed={speed}
      fps={exportSettings.fps}
      cropEditing={cropEditing}
      emptyMode={mode}
      customBounds={customBounds}
      exportWidth={exportSettings.width}
      exportHeight={exportSettings.height}
      onChooseFiles={mode === "gallery" ? showProjectControls : chooseFiles}
      onDropFiles={dropFilesIntoWorkspace}
      onAnimationChange={selectAnimation}
      onLayersChange={selectLayers}
      onSkinChange={selectSkin}
      onFit={fit}
      onToggleDebug={toggleDebug}
      onToggleCrop={toggleCrop}
      onResetFrame={resetFrame}
      onExportFrame={runCaptureStill}
      onCanvasPointerDown={handleCanvasPointerDown}
      onCanvasPointerMove={handleCanvasPointerMove}
      onCanvasPointerEnd={handleCanvasPointerEnd}
      onCanvasWheel={handleCanvasWheel}
      onFramePointerDown={handleFramePointerDown}
      onFrameKeyDown={handleFrameKeyDown}
      onPlayingChange={setPlaying}
      onToggleLoop={toggleLoop}
      onStepFrames={stepFrames}
      onSeek={seek}
      onSpeedChange={changeSpeed}
    />
  );

  return (
    <main className="flex h-dvh min-h-mobile w-full flex-col overflow-hidden bg-workspace text-foreground">
      <input
        ref={fileInputRef}
        className="sr-only"
        tabIndex={-1}
        type="file"
        multiple
        aria-label="选择 Spine 资源包文件"
        onChange={handleFileInput}
      />

      <AppHeader
        mode={mode}
        documents={documentTabs}
        activeId={activeId}
        busy={busy}
        runtimeReady={runtimeReady}
        capabilities={capabilities}
        projectOpen={isWorkspace ? projectOpen : mobileProjectOpen}
        inspectorOpen={isWorkspace ? inspectorOpen : mobileInspectorOpen}
        onActivateDocument={activateDocument}
        onCloseDocument={closeDocument}
        onCloseOtherDocuments={closeOtherDocuments}
        onCloseAllDocuments={closeAllDocuments}
        onNewDocument={chooseFiles}
        onOpenCommand={openCommandMenu}
        onToggleProject={toggleProjectControls}
        onToggleInspector={toggleInspectorControls}
        onModeChange={changeMode}
      />

      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={isWorkspace ? panelLayout : undefined}
          onLayoutChanged={isWorkspace ? setPanelLayout : undefined}
        >
          {isWorkspace ? (
            <ResizablePanel
              key="project"
              id="project"
              panelRef={projectPanelRef}
              defaultSize="18%"
              minSize="14rem"
              maxSize="24rem"
              collapsedSize="0%"
              collapsible
              onResize={(size) => setProjectOpen(size.asPercentage > 0)}
            >
              {mode === "gallery" ? (
                <GalleryPanel {...galleryPanelProps} />
              ) : (
                <ProjectPanel {...projectPanelProps} />
              )}
            </ResizablePanel>
          ) : null}
          {isWorkspace ? (
            <ResizableHandle
              key="project-handle"
              className="bg-border-soft transition-colors hover:bg-primary focus-visible:bg-primary"
            />
          ) : null}

          <ResizablePanel key="stage" id="stage" defaultSize="64%" minSize="18rem">
            <div className="relative h-full min-h-0">
              {stage}
              <div className="pointer-events-none absolute inset-x-0 bottom-timeline z-40 flex justify-end p-3">
                <ExportTask
                  task={exportTask}
                  onCancel={cancelExport}
                  onDismiss={dismissExportTask}
                  onRetry={runExport}
                />
              </div>
            </div>
          </ResizablePanel>

          {isWorkspace ? (
            <ResizableHandle
              key="inspector-handle"
              className="bg-border-soft transition-colors hover:bg-primary focus-visible:bg-primary"
            />
          ) : null}
          {isWorkspace ? (
            <ResizablePanel
              key="inspector"
              id="inspector"
              panelRef={inspectorPanelRef}
              defaultSize="18%"
              minSize="16rem"
              maxSize="25rem"
              collapsedSize="0%"
              collapsible
              onResize={(size) => setInspectorOpen(size.asPercentage > 0)}
            >
              <InspectorPanel {...inspectorPanelProps} />
            </ResizablePanel>
          ) : null}
        </ResizablePanelGroup>
      </div>

      <StatusBar status={status} message={statusText} runtimeReady={runtimeReady} />

      <AlertDialog open={closeAllConfirmationOpen} onOpenChange={setCloseAllConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭全部文档？</AlertDialogTitle>
            <AlertDialogDescription>
              这将关闭 {documents.length}{" "}
              个已打开的文档，并移除对应的自定义导出框。源文件仍留在本机，但需要重新打开才能继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCloseAllDocuments}>
              全部关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GallerySourceDialog
        open={sourceDialog.open}
        referenceFirst={sourceDialog.reference}
        onOpenChange={closeSourceDialog}
        onAdd={addGallerySource}
      />

      <Suspense fallback={null}>
        {isWorkspace ? null : (
          <MobilePanels
            mode={mode}
            projectOpen={mobileProjectOpen}
            inspectorOpen={mobileInspectorOpen}
            projectPanel={projectPanelProps}
            galleryPanel={galleryPanelProps}
            inspectorPanel={inspectorPanelProps}
            onProjectOpenChange={setMobileProjectOpen}
            onInspectorOpenChange={setMobileInspectorOpen}
            onSelectGalleryItem={selectMobileGalleryItem}
            onCloseProject={closeMobileProject}
            onCloseInspector={closeMobileInspector}
          />
        )}

        {commandMounted ? (
          <CommandMenu
            open={commandOpen}
            hasSource={activeDocument !== null}
            hasAnimation={hasAnimation}
            playing={renderState.playing}
            looping={looping}
            onOpenChange={setCommandOpen}
            onChooseFiles={chooseFiles}
            onFit={fit}
            onToggleBones={toggleDebug}
            onToggleCrop={toggleCrop}
            onTogglePlay={togglePlaying}
            onToggleLoop={toggleLoop}
            onToggleProject={toggleProjectControls}
            onToggleInspector={toggleInspectorControls}
            onExport={runExport}
            onExportFrame={runCaptureStill}
          />
        ) : null}
      </Suspense>
    </main>
  );
}

async function prepareGalleryPreview({
  previewJson,
  bundle,
  premultipliedAlpha,
  defaultAnimation,
  defaultSkin,
}: {
  previewJson: string;
  bundle: SpineAssetBundle;
  premultipliedAlpha: PremultipliedAlphaMode;
  defaultAnimation?: string;
  defaultSkin?: string;
}) {
  const { SpineRenderer: PreviewRenderer } = await import("@/render/spine-renderer");
  const validationCanvas = document.createElement("canvas");
  const validator = new PreviewRenderer(validationCanvas, () => undefined, {
    background: readDesignToken("--canvas"),
    interactive: false,
    premultipliedAlpha,
  });

  try {
    await validator.load(previewJson, bundle);
    validator.setPremultipliedAlpha(premultipliedAlpha);
    const animations = [...validator.animations];
    const skins = [...validator.skins];
    const animation =
      defaultAnimation && animations.some(({ name }) => name === defaultAnimation)
        ? defaultAnimation
        : (validator.state.animation ?? "");
    if (animation && validator.state.animation !== animation) {
      validator.selectAnimations([animation]);
    }
    const skin = defaultSkin && skins.includes(defaultSkin) ? defaultSkin : (skins[0] ?? "");
    if (skin) validator.selectSkin(skin);
    return { animations, skins, animation, skin };
  } finally {
    validator.dispose();
  }
}

async function hydrateRenderer(renderer: SpineRenderer, workspaceDocument: LoadedDocument) {
  await renderer.load(workspaceDocument.previewJson, workspaceDocument.bundle);
  renderer.setPremultipliedAlpha(workspaceDocument.premultipliedAlpha);
  // Converted bundles may remove clips, so restore names that still exist.
  const available = new Set(renderer.animations.map((animation) => animation.name));
  const stack = [workspaceDocument.animation, ...workspaceDocument.layers].filter((name) =>
    available.has(name),
  );
  if (stack.length > 0) renderer.selectAnimations(stack);
  if (workspaceDocument.skin && renderer.skins.includes(workspaceDocument.skin)) {
    renderer.selectSkin(workspaceDocument.skin);
  }
  return {
    animations: renderer.animations,
    skins: renderer.skins,
    atlasPremultipliedAlpha: renderer.atlasPremultipliedAlpha,
    skin: renderer.skins.includes(workspaceDocument.skin)
      ? workspaceDocument.skin
      : (renderer.skins[0] ?? ""),
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
