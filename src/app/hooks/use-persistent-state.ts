import { useCallback, useState } from "react";
import type { Type } from "arktype";

import { readStoredJson } from "@/lib/stored-json";

/** Stores schema-checked state in `localStorage`. */
export function usePersistentState<Schema extends Type>(
  key: string,
  initialValue: Schema["infer"],
  schema: Schema,
) {
  type StateValue = Schema["infer"];

  const [value, setValueState] = useState<StateValue>(() => {
    try {
      return readStoredJson(window.localStorage.getItem(key), schema) ?? initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (nextValue: StateValue | ((current: StateValue) => StateValue)) => {
      setValueState((current) => {
        // SAFETY: persisted values in this app are data, not functions.
        const resolved =
          nextValue instanceof Function
            ? (nextValue as (current: StateValue) => StateValue)(current)
            : nextValue;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Private mode and storage quotas can reject writes.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setValue] as const;
}
