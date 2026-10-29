/**
 * Scores subsequence matches. Early positions and adjacent characters rank
 * higher, with an extra weight for word starts. Long targets rank lower.
 */

/** Stores lowercase text to avoid repeated case conversion during search. */
export type FuzzyTarget = {
  readonly text: string;
  readonly lower: string;
};

export type FuzzyMatch = {
  readonly score: number;
  /** Matched indices in `target.text`, in ascending order. */
  readonly positions: readonly number[];
};

export type FuzzyRanked<T> = {
  readonly item: T;
  /** Null preserves source order when the query is blank. */
  readonly match: FuzzyMatch | null;
};

const SEPARATOR = /[\s_\-./&]/;
const LOWERCASE = /[a-z]/;
const WORD_START = /[A-Z0-9]/;

const SCORE_CHARACTER = 1;
const SCORE_LEADING = 10;
const SCORE_WORD_START = 7;
const SCORE_CONSECUTIVE = 8;
const PENALTY_OFFSET = 0.4;
const PENALTY_LENGTH = 0.15;

export function fuzzyTarget(text: string): FuzzyTarget {
  return { text, lower: text.toLowerCase() };
}

/** Checks separators and camelCase boundaries. */
function startsWord(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? "";
  if (SEPARATOR.test(previous)) return true;
  return LOWERCASE.test(previous) && WORD_START.test(text[index] ?? "");
}

/** Scores a trimmed lowercase query against one target. */
export function fuzzyMatch(lowerQuery: string, target: FuzzyTarget): FuzzyMatch | null {
  if (!lowerQuery) return { score: 0, positions: [] };

  const positions: number[] = [];
  let cursor = 0;
  for (const character of lowerQuery) {
    const found = target.lower.indexOf(character, cursor);
    if (found === -1) return null;
    positions.push(found);
    cursor = found + character.length;
  }

  let score = 0;
  for (const [order, index] of positions.entries()) {
    score += SCORE_CHARACTER;
    if (index === 0) score += SCORE_LEADING;
    else if (startsWord(target.text, index)) score += SCORE_WORD_START;
    if (order > 0 && index === (positions[order - 1] ?? -2) + 1) score += SCORE_CONSECUTIVE;
  }
  score -= (positions[0] ?? 0) * PENALTY_OFFSET;
  score -= target.text.length * PENALTY_LENGTH;
  return { score, positions };
}

/** Filters and ranks items. A blank query preserves source order. */
export function rankFuzzy<T>(
  items: readonly T[],
  query: string,
  getTarget: (item: T, index: number) => FuzzyTarget,
): readonly FuzzyRanked<T>[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items.map((item) => ({ item, match: null }));

  const ranked: { item: T; match: FuzzyMatch }[] = [];
  for (const [index, item] of items.entries()) {
    const match = fuzzyMatch(normalized, getTarget(item, index));
    if (match) ranked.push({ item, match });
  }
  // Stable sorting preserves source order for equal scores.
  return ranked.sort((left, right) => right.match.score - left.match.score);
}

/** Checks whether a query matches a target. */
export function fuzzyMatches(query: string, target: FuzzyTarget): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || fuzzyMatch(normalized, target) !== null;
}

/** Maps matched positions in `[start, end)` to offsets within that range. */
export function sliceMatch(
  positions: readonly number[],
  start: number,
  end: number,
): readonly number[] {
  const sliced: number[] = [];
  for (const position of positions) {
    if (position >= start && position < end) sliced.push(position - start);
  }
  return sliced;
}
