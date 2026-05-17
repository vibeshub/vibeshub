import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const STORAGE_KEY = "vibeshub.theme";

function readChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage may throw in sandboxed contexts; fall through.
  }
  return "system";
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t;
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: Theme;
  setChoice: (c: ThemeChoice) => void;
  toggle: () => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [resolved, setResolved] = useState<Theme>(() =>
    choice === "system" ? systemTheme() : choice,
  );

  useEffect(() => {
    const next: Theme = choice === "system" ? systemTheme() : choice;
    setResolved(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore — best-effort persistence.
    }
  }, [choice]);

  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const t: Theme = mq.matches ? "dark" : "light";
      setResolved(t);
      applyTheme(t);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [choice]);

  return {
    choice,
    resolved,
    setChoice: setChoiceState,
    toggle: () => setChoiceState(resolved === "dark" ? "light" : "dark"),
  };
}
