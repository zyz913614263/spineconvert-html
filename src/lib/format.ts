const numberFormatter = new Intl.NumberFormat();

/** Formats user-facing counts with the browser's resolved locale. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formats elapsed milliseconds as `12s` or `1:05`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
