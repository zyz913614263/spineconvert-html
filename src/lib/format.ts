const numberFormatter = new Intl.NumberFormat();

/** Formats user-facing counts with the browser's resolved locale. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}
