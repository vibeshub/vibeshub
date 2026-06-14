// useTheme.ts — dark/light theme controller for the vibeshub frontend.
//
// Writes <html data-theme="…">, which tokens.css keys off (the
// :root[data-theme="light"] block overrides the base dark tokens). Persists the
// choice to localStorage and honors the OS preference on first visit.
//
// The same initial-theme logic is mirrored by the inline <script> in index.html
// so the attribute is set before first paint (no theme flash).

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const THEME_KEY = "vibeshub.theme";

// Browser-chrome tint per theme (mobile address bar etc.) — mirrors --bg in
// tokens.css. Kept in sync with the inline fallback in index.html.
const THEME_COLOR: Record<Theme, string> = {
  dark: "#0f1411",
  light: "#f4f8f6",
};

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // First visit: honor the OS preference. Default product theme is dark.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLOR[theme]);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return { theme, setTheme, toggleTheme };
}
