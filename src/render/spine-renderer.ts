import {
  AtlasAttachmentLoader,
  GLTexture,
  MixBlend,
  MixDirection,
  Physics,
  SceneRenderer,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  Vector2,
  type Animation,
} from "@esotericsoftware/spine-webgl";

import {
  boundsFromPoints,
  normalizeBounds,
  unionBounds,
  type Bounds,
} from "../domain/export/layout";
import { findAtlasImage, type SpineAssetBundle } from "../domain/spine/assets";
import { projectBoundsToViewport, type ProjectedBounds, type ViewState } from "./view-projection";

export type AnimationInfo = {
  name: string;
  duration: number;
};

/** Playback state that changes less often than the playhead time. */
export type RenderState = {
  /** Base clip name. */
  animation: string | null;
  /** Overlay clip names in playback order. */
  layers: readonly string[];
  /** Longest clip duration in the stack. */
  duration: number;
  playing: boolean;
};

export type CaptureOptions = {
  width: number;
  height: number;
  bounds: Bounds;
  padding: number;
  time: number;
  delta: number;
  transparent: boolean;
  background: string;
  firstFrame: boolean;
};

/** Selects the atlas flag or an explicit texture alpha mode. */
export type PremultipliedAlphaMode = "auto" | "premultiplied" | "straight";

export type SpineRendererOptions = {
  background: string;
  interactive?: boolean;
  premultipliedAlpha?: PremultipliedAlphaMode;
  onView?: (state: ViewState) => void;
  /** Receives the playhead time after a frame or seek. */
  onTime?: (time: number) => void;
};

const FIT_OVERSCAN = 1.12;

/** Main-thread time allowed for bounds sampling before a yield. */
const MEASURE_SLICE_MS = 8;

function colorChannels(hex: string): readonly [number, number, number] {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    throw new Error("Renderer backgrounds must use a six-digit hexadecimal color token.");
  }
  const normalized = hex.slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function flipRowsInPlace(source: Uint8Array, width: number, height: number): void {
  const rowSize = width * 4;
  const temporaryRow = new Uint8Array(rowSize);
  for (let row = 0; row < Math.floor(height / 2); row += 1) {
    const topOffset = row * rowSize;
    const bottomOffset = (height - row - 1) * rowSize;
    temporaryRow.set(source.subarray(topOffset, topOffset + rowSize));
    source.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
    source.set(temporaryRow, bottomOffset);
  }
}

export class SpineRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGLRenderingContext;
  readonly #renderer: SceneRenderer;
  readonly #onState: (state: RenderState) => void;
  readonly #onView: ((state: ViewState) => void) | undefined;
  readonly #onTime: ((time: number) => void) | undefined;
  readonly #interactive: boolean;
  readonly #backgroundChannels: readonly [number, number, number];
  readonly #bitmaps: ImageBitmap[] = [];
  readonly #boundsOffset = new Vector2();
  readonly #boundsSize = new Vector2();
  readonly #boundsVertices: number[] = [];
  readonly #resizeObserver: ResizeObserver | null = null;
  #atlas: TextureAtlas | null = null;
  #skeleton: Skeleton | null = null;
  /** Base clip followed by overlays in playback order. */
  #layers: Animation[] = [];
  #atlasPremultiplied = false;
  #bounds: Bounds = { x: -50, y: -50, width: 100, height: 100 };
  #time = 0;
  #playing = false;
  #looping = true;
  #debug = false;
  #premultipliedAlpha: PremultipliedAlphaMode = "auto";
  #speed = 1;
  #frameRequest = 0;
  #lastFrameTime = 0;
  #disposed = false;
  #suspended = false;
  #loadSequence = 0;
  #fitZoom = 1;
  #hasFramed = false;

  constructor(
    canvas: HTMLCanvasElement,
    onState: (state: RenderState) => void,
    options: SpineRendererOptions,
  ) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL is required to preview Spine animations.");

    this.#canvas = canvas;
    this.#gl = gl;
    this.#renderer = new SceneRenderer(canvas, gl, true);
    this.#onState = onState;
    this.#onView = options.onView;
    this.#onTime = options.onTime;
    this.#interactive = options.interactive ?? true;
    this.#backgroundChannels = colorChannels(options.background);
    this.#premultipliedAlpha = options.premultipliedAlpha ?? "auto";

    // ResizeObserver keeps layout reads out of the animation loop.
    if (this.#interactive) {
      this.#resizeObserver = new ResizeObserver(() => this.resizeToDisplaySize());
      this.#resizeObserver.observe(canvas);
      // Browser zoom can change devicePixelRatio without changing CSS size.
      window.addEventListener("resize", this.#handleWindowResize);
    }
  }

  get animations(): readonly AnimationInfo[] {
    return this.#skeleton?.data.animations.map(({ name, duration }) => ({ name, duration })) ?? [];
  }

  get skins(): readonly string[] {
    return this.#skeleton?.data.skins.map(({ name }) => name) ?? [];
  }

  get state(): RenderState {
    const [base, ...stacked] = this.#layers;
    return {
      animation: base?.name ?? null,
      layers: stacked.map((layer) => layer.name),
      duration: this.#duration,
      playing: this.#playing,
    };
  }

  get #duration(): number {
    let duration = 0;
    for (const layer of this.#layers) duration = Math.max(duration, layer.duration);
    return duration;
  }

  get time(): number {
    return this.#time;
  }

  get looping(): boolean {
    return this.#looping;
  }

  /** Texture alpha mode declared by the loaded atlas. */
  get atlasPremultipliedAlpha(): boolean {
    return this.#atlasPremultiplied;
  }

  get contentBounds(): Bounds {
    return this.#readHybridBounds();
  }

  /** Bounds of the current pose. */
  measurePoseBounds(): Bounds {
    return this.#readHybridBounds();
  }

  get viewState(): ViewState {
    const camera = this.#renderer.camera;
    const zoom = camera.zoom;
    return {
      zoomPercent: Math.round((this.#fitZoom / Math.max(zoom, Number.EPSILON)) * 100),
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      zoom,
      canvasWidth: this.#canvas.width,
      canvasHeight: this.#canvas.height,
      viewportWidth: this.#canvas.clientWidth,
      viewportHeight: this.#canvas.clientHeight,
    };
  }

  async load(json: string, bundle: SpineAssetBundle): Promise<void> {
    const operation = this.#loadSequence + 1;
    this.#loadSequence = operation;
    const atlas = new TextureAtlas(bundle.atlasText);
    const bitmaps: ImageBitmap[] = [];

    try {
      for (const page of atlas.pages) {
        const file = findAtlasImage(bundle.images, page.name);
        if (!file) throw new Error(`Texture page is missing: ${page.name}`);
        const bitmap = await createImageBitmap(file, { premultiplyAlpha: "none" });
        if (operation !== this.#loadSequence) {
          bitmap.close();
          throw new DOMException("A newer asset bundle replaced this load.", "AbortError");
        }
        bitmaps.push(bitmap);
        page.setTexture(new GLTexture(this.#renderer.context, bitmap, false));
      }

      const attachmentLoader = new AtlasAttachmentLoader(atlas);
      const parser = new SkeletonJson(attachmentLoader);
      const skeletonData = parser.readSkeletonData(json);
      const skeleton = new Skeleton(skeletonData);
      skeleton.setToSetupPose();
      skeleton.updateWorldTransform(Physics.reset);
      if (operation !== this.#loadSequence) {
        throw new DOMException("A newer asset bundle replaced this load.", "AbortError");
      }

      this.#disposeAssets();
      // Frame a new bundle once. Clip changes keep the current camera position.
      this.#hasFramed = false;
      this.#atlas = atlas;
      this.#atlasPremultiplied = atlas.pages.some((page) => page.pma);
      this.#bitmaps.push(...bitmaps);
      this.#skeleton = skeleton;
      const first = skeletonData.animations[0];
      this.#layers = first ? [first] : [];
      this.#time = 0;
      this.#playing = this.#layers.length > 0;
      this.#measureBounds();
      if (this.#interactive) this.resizeToDisplaySize(true);
      this.#render();
      this.#emitState();
      this.#emitTime();
      this.#requestFrame();
    } catch (error) {
      atlas.dispose();
      for (const bitmap of bitmaps) bitmap.close();
      throw error;
    }
  }

  /** Applies the first clip as the base and later clips as full-weight overlays. */
  selectAnimations(names: readonly string[]): void {
    const data = this.#skeleton?.data;
    if (!data) throw new Error("Load a Spine bundle before selecting animations.");
    const layers = names.map((name) => {
      const animation = data.findAnimation(name);
      if (!animation) throw new Error(`Animation not found: ${name}`);
      return animation;
    });
    const rebased = layers[0]?.name !== this.#layers[0]?.name;
    this.#layers = layers;
    if (rebased) this.#time = 0;
    this.#applyPose(this.#time, 0, true);
    this.#measureBounds();
    if (!this.#hasFramed) this.fit();
    else this.#render();
    this.#emitState();
    this.#emitTime();
  }

  selectSkin(name: string): void {
    if (!this.#skeleton) return;
    this.#skeleton.setSkinByName(name);
    this.#skeleton.setSlotsToSetupPose();
    this.#applyPose(this.#time, 0, true);
    this.#measureBounds();
    this.#render();
  }

  setPlaying(playing: boolean): void {
    const next = playing && this.#layers.length > 0;
    // Restarting a finished one-shot from its end frame would otherwise stall.
    if (next && !this.#looping && this.#time >= this.#duration) this.#time = 0;
    this.#playing = next;
    this.#lastFrameTime = performance.now();
    this.#emitState();
    this.#emitTime();
    this.#requestFrame();
  }

  /** Updates short overlays to loop or hold their last frame. */
  setLooping(looping: boolean): void {
    if (this.#looping === looping) return;
    this.#looping = looping;
    this.#applyPose(this.#time, 0, true);
    this.#render();
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) throw new Error("Playback speed must be finite.");
    this.#speed = Math.min(4, Math.max(0.1, speed));
  }

  seek(time: number): void {
    if (!Number.isFinite(time)) throw new Error("Playhead time must be finite.");
    const duration = this.#duration;
    this.#time = Math.min(duration, Math.max(0, time));
    this.#applyPose(this.#time, 0, true);
    this.#render();
    this.#emitTime();
  }

  /** Moves the playhead by whole frames at the given rate, wrapping around the clip. */
  stepFrames(frames: number, fps: number): void {
    const duration = this.#duration;
    if (duration <= 0 || !Number.isFinite(frames) || !Number.isFinite(fps) || fps <= 0) return;
    const total = Math.max(1, Math.round(duration * fps));
    const current = Math.round(this.#time * fps);
    const next = (((current + Math.trunc(frames)) % total) + total) % total;
    this.seek(Math.min(duration, next / fps));
  }

  /** Stops preview frames while export uses the GPU. */
  suspend(): void {
    if (this.#suspended) return;
    this.#suspended = true;
    if (this.#frameRequest) cancelAnimationFrame(this.#frameRequest);
    this.#frameRequest = 0;
  }

  resume(): void {
    if (!this.#suspended || this.#disposed) return;
    this.#suspended = false;
    this.#requestFrame();
  }

  setDebug(enabled: boolean): void {
    this.#debug = enabled;
    this.#render();
  }

  setPremultipliedAlpha(mode: PremultipliedAlphaMode): void {
    if (this.#premultipliedAlpha === mode) return;
    this.#premultipliedAlpha = mode;
    this.#render();
  }

  fit(bounds?: Bounds): void {
    if (!bounds) {
      this.#measureBounds();
      bounds = this.#bounds;
    }
    this.#fitCamera(this.#canvas.width, this.#canvas.height, bounds);
    this.#fitZoom = this.#renderer.camera.zoom;
    this.#hasFramed = true;
    this.#render();
    this.#emitView();
  }

  zoomAt(factor: number, viewportX?: number, viewportY?: number): void {
    const anchor =
      viewportX === undefined || viewportY === undefined
        ? null
        : this.screenToWorld(viewportX, viewportY);
    this.#renderer.camera.zoom = Math.min(
      20,
      Math.max(0.0001, this.#renderer.camera.zoom * factor),
    );
    if (anchor && viewportX !== undefined && viewportY !== undefined) {
      const shifted = this.screenToWorld(viewportX, viewportY);
      this.#renderer.camera.position.x += anchor.x - shifted.x;
      this.#renderer.camera.position.y += anchor.y - shifted.y;
    }
    this.#render();
    this.#emitView();
  }

  pan(deltaX: number, deltaY: number): void {
    const camera = this.#renderer.camera;
    const scaleX = this.#canvas.width / Math.max(1, this.#canvas.clientWidth);
    const scaleY = this.#canvas.height / Math.max(1, this.#canvas.clientHeight);
    camera.position.x -= deltaX * scaleX * camera.zoom;
    camera.position.y += deltaY * scaleY * camera.zoom;
    this.#render();
    this.#emitView();
  }

  screenToWorld(viewportX: number, viewportY: number) {
    const camera = this.#renderer.camera;
    const pixelX = viewportX * (this.#canvas.width / Math.max(1, this.#canvas.clientWidth));
    const pixelY = viewportY * (this.#canvas.height / Math.max(1, this.#canvas.clientHeight));
    return {
      x: camera.position.x + (pixelX - this.#canvas.width / 2) * camera.zoom,
      y: camera.position.y - (pixelY - this.#canvas.height / 2) * camera.zoom,
    };
  }

  projectBounds(bounds: Bounds): ProjectedBounds {
    return projectBoundsToViewport(bounds, this.viewState);
  }

  resizeToDisplaySize(refit = false): void {
    if (this.#disposed) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(this.#canvas.clientWidth * ratio));
    const height = Math.max(2, Math.round(this.#canvas.clientHeight * ratio));
    if (width === this.#canvas.width && height === this.#canvas.height) {
      if (refit) {
        this.fit();
      }
      return;
    }
    this.#resize(width, height);
    if (refit) this.fit();
    else this.#render();
  }

  capture(options: CaptureOptions): Uint8Array {
    if (!this.#skeleton) throw new Error("Load a Spine bundle before exporting.");
    this.#resize(options.width, options.height);
    this.#fitCamera(options.width, options.height, options.bounds, options.padding, 1);
    this.#applyPose(options.time, options.delta, options.firstFrame);
    this.#render(options.transparent, options.background);

    const raw = new Uint8Array(options.width * options.height * 4);
    this.#gl.readPixels(
      0,
      0,
      options.width,
      options.height,
      this.#gl.RGBA,
      this.#gl.UNSIGNED_BYTE,
      raw,
    );
    flipRowsInPlace(raw, options.width, options.height);
    return raw;
  }

  async measureAnimationBounds(
    frameCount: number,
    fps: number,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<Bounds> {
    if (!this.#skeleton) throw new Error("Load a Spine bundle before exporting.");
    if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
      throw new Error("Animation bounds need at least one frame.");
    }
    if (!Number.isFinite(fps) || fps <= 0)
      throw new Error("Animation bounds need a positive frame rate.");

    const previewTime = this.#time;
    let minimumX = Number.POSITIVE_INFINITY;
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumX = Number.NEGATIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;

    try {
      let sliceStart = performance.now();
      for (let index = 0; index < frameCount; index += 1) {
        if (signal?.aborted) throw new DOMException("Export canceled.", "AbortError");
        this.#applyPose(index / fps, index === 0 ? 0 : 1 / fps, index === 0);
        const frameBounds = this.#readHybridBounds();
        minimumX = Math.min(minimumX, frameBounds.x);
        minimumY = Math.min(minimumY, frameBounds.y);
        maximumX = Math.max(maximumX, frameBounds.x + frameBounds.width);
        maximumY = Math.max(maximumY, frameBounds.y + frameBounds.height);
        onProgress?.(index + 1, frameCount);
        // Cap each sampling pass at MEASURE_SLICE_MS of main-thread work.
        if (performance.now() - sliceStart >= MEASURE_SLICE_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          sliceStart = performance.now();
        }
      }
    } finally {
      this.#applyPose(previewTime, 0, true);
      this.#render();
    }

    if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
      return normalizeBounds(this.#bounds);
    }
    return normalizeBounds({
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX,
      height: maximumY - minimumY,
    });
  }

  restorePreview(): void {
    if (!this.#interactive) return;
    this.resizeToDisplaySize(true);
    this.#applyPose(this.#time, 0, true);
    this.#render();
  }

  clear(): void {
    this.#loadSequence += 1;
    this.#disposeAssets();
    this.#atlasPremultiplied = false;
    this.#time = 0;
    this.#hasFramed = false;
    this.#bounds = { x: -50, y: -50, width: 100, height: 100 };
    this.#gl.clearColor(0, 0, 0, 0);
    this.#gl.clear(this.#gl.COLOR_BUFFER_BIT);
    this.#emitState();
    this.#emitTime();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#loadSequence += 1;
    if (this.#frameRequest) cancelAnimationFrame(this.#frameRequest);
    this.#frameRequest = 0;
    this.#resizeObserver?.disconnect();
    if (this.#interactive) window.removeEventListener("resize", this.#handleWindowResize);
    this.#disposeAssets();
    this.#renderer.dispose();
  }

  readonly #handleWindowResize = (): void => this.resizeToDisplaySize();

  /** Schedules one frame while playback is active. */
  #requestFrame(): void {
    if (!this.#interactive || this.#disposed || this.#suspended) return;
    if (this.#frameRequest || !this.#playing) return;
    this.#lastFrameTime = performance.now();
    this.#frameRequest = requestAnimationFrame(this.#tick);
  }

  readonly #tick = (timestamp: number): void => {
    this.#frameRequest = 0;
    if (this.#disposed || this.#suspended || !this.#playing) return;

    const elapsed =
      this.#lastFrameTime === 0 ? 0 : Math.min((timestamp - this.#lastFrameTime) / 1000, 0.1);
    this.#lastFrameTime = timestamp;

    const duration = this.#duration;
    const advanced = this.#time + elapsed * this.#speed;
    let ended = false;
    if (duration <= 0) {
      this.#time = 0;
    } else if (this.#looping) {
      this.#time = advanced % duration;
    } else if (advanced >= duration) {
      this.#time = duration;
      this.#playing = false;
      ended = true;
    } else {
      this.#time = advanced;
    }
    this.#applyPose(this.#time, elapsed, false);
    this.#render();
    this.#emitTime();
    if (ended) {
      this.#emitState();
      return;
    }
    this.#frameRequest = requestAnimationFrame(this.#tick);
  };

  #applyPose(time: number, delta: number, resetPhysics: boolean): void {
    const skeleton = this.#skeleton;
    if (!skeleton) return;
    skeleton.setToSetupPose();
    for (const layer of this.#layers) {
      // Each short overlay loops on its own clock or holds its last frame.
      const layerTime =
        this.#looping && layer.duration > 0
          ? time % layer.duration
          : Math.min(time, layer.duration);
      layer.apply(skeleton, 0, layerTime, false, [], 1, MixBlend.replace, MixDirection.mixIn);
    }
    skeleton.update(delta);
    skeleton.updateWorldTransform(resetPhysics ? Physics.reset : Physics.update);
  }

  #measureBounds(): void {
    this.#bounds = this.#readHybridBounds();
  }

  #readVisualBounds(): Bounds | null {
    const skeleton = this.#skeleton;
    if (!skeleton) return null;
    const offset = this.#boundsOffset;
    const size = this.#boundsSize;
    skeleton.getBounds(
      offset,
      size,
      this.#boundsVertices,
      this.#renderer.skeletonRenderer.getSkeletonClipping(),
    );
    if (
      !Number.isFinite(offset.x) ||
      !Number.isFinite(offset.y) ||
      !Number.isFinite(size.x) ||
      !Number.isFinite(size.y) ||
      size.x <= 0 ||
      size.y <= 0
    ) {
      return null;
    }
    return { x: offset.x, y: offset.y, width: size.x, height: size.y };
  }

  #readBoneBounds(): Bounds | null {
    const skeleton = this.#skeleton;
    if (!skeleton) return null;
    const points: Array<{ x: number; y: number }> = [];
    for (const bone of skeleton.bones) {
      if (!bone.isActive()) continue;
      points.push({ x: bone.worldX, y: bone.worldY });
      const length = Math.max(0, bone.data.length);
      if (length > 0) {
        points.push({
          x: bone.worldX + length * bone.a,
          y: bone.worldY + length * bone.c,
        });
      }
    }
    const minimumExtent = Math.max(1, skeleton.data.referenceScale * 0.02);
    return boundsFromPoints(points, minimumExtent);
  }

  #readSetupBounds(): Bounds | null {
    const data = this.#skeleton?.data;
    if (!data || data.width <= 0 || data.height <= 0) return null;
    return { x: data.x, y: data.y, width: data.width, height: data.height };
  }

  #readHybridBounds(): Bounds {
    return unionBounds(this.#readVisualBounds(), this.#readBoneBounds(), this.#readSetupBounds());
  }

  #fitCamera(
    width: number,
    height: number,
    bounds: Bounds = this.#bounds,
    padding = 0,
    overscan = FIT_OVERSCAN,
  ): void {
    const normalized = normalizeBounds(bounds);
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const camera = this.#renderer.camera;
    camera.position.set(
      normalized.x + normalized.width / 2,
      normalized.y + normalized.height / 2,
      0,
    );
    camera.setViewport(width, height);
    camera.zoom =
      Math.max(normalized.width / availableWidth, normalized.height / availableHeight) * overscan;
  }

  #resize(width: number, height: number): void {
    this.#canvas.width = width;
    this.#canvas.height = height;
    this.#gl.viewport(0, 0, width, height);
    this.#renderer.camera.setViewport(width, height);
    this.#emitView();
  }

  /** Draws the current pose with the preview or capture background. */
  #render(transparent = false, background?: string): void {
    const [red, green, blue] =
      background === undefined ? this.#backgroundChannels : colorChannels(background);
    this.#gl.clearColor(red, green, blue, transparent ? 0 : 1);
    this.#gl.clear(this.#gl.COLOR_BUFFER_BIT);
    if (!this.#skeleton) return;
    const premultiplied =
      this.#premultipliedAlpha === "auto"
        ? this.atlasPremultipliedAlpha
        : this.#premultipliedAlpha === "premultiplied";
    this.#renderer.begin();
    this.#renderer.drawSkeleton(this.#skeleton, premultiplied);
    if (this.#debug) this.#renderer.drawSkeletonDebug(this.#skeleton);
    this.#renderer.end();
  }

  #emitState(): void {
    this.#onState(this.state);
  }

  #emitTime(): void {
    this.#onTime?.(this.#time);
  }

  #emitView(): void {
    this.#onView?.(this.viewState);
  }

  #disposeAssets(): void {
    this.#atlas?.dispose();
    this.#atlas = null;
    this.#skeleton = null;
    this.#layers = [];
    this.#playing = false;
    for (const bitmap of this.#bitmaps.splice(0)) bitmap.close();
  }
}
