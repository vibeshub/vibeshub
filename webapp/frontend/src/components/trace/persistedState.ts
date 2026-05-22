import { useEffect, useState } from "react";

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    // localStorage may throw in sandboxed contexts; fall through.
  }
  return fallback;
}

/**
 * A boolean useState whose value persists in localStorage under `key`,
 * so the preference survives reloads and carries across sessions.
 */
export function usePersistedBoolean(
  key: string,
  fallback: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readBoolean(key, fallback));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // ignore — best-effort persistence.
    }
  }, [key, value]);

  return [value, setValue];
}
