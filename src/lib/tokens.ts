/** Reads a token from `src/styles/tokens.css`. */
export function readDesignToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Required design token ${name} is unavailable.`);
  return value;
}

const lengthCache = new Map<string, number>();

/** Measures a CSS length token in pixels and caches the result. */
export function readDesignTokenPx(name: string): number {
  const cached = lengthCache.get(name);
  if (cached !== undefined) return cached;

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0";
  probe.style.height = readDesignToken(name);
  document.body.append(probe);
  const pixels = probe.getBoundingClientRect().height;
  probe.remove();
  if (pixels <= 0) throw new Error(`Design token ${name} did not resolve to a usable length.`);
  lengthCache.set(name, pixels);
  return pixels;
}
