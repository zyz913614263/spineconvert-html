import type { Type } from "arktype";

/** Parses durable browser state and returns null when it no longer matches its schema. */
export function readStoredJson<Schema extends Type>(
  stored: string | null,
  schema: Schema,
): Schema["infer"] | null {
  if (stored === null) return null;
  try {
    return schema.assert(JSON.parse(stored));
  } catch {
    return null;
  }
}
