import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";

// File extension → Prism language id. `prismjs` core already ships markup,
// css, clike and javascript; the imports above add the rest.
const EXT_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  css: "css",
  scss: "css",
  html: "markup",
  xml: "markup",
  svg: "markup",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  go: "go",
  rs: "rust",
  sql: "sql",
};

export function langFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Highlight a single line of code. Prism escapes the input itself, so the
// returned HTML is safe for dangerouslySetInnerHTML. Falls back to plain
// escaped text for unknown languages or grammar errors.
export function highlightLine(code: string, lang: string | null): string {
  if (lang) {
    const grammar = Prism.languages[lang];
    if (grammar) {
      try {
        return Prism.highlight(code, grammar, lang);
      } catch {
        // fall through
      }
    }
  }
  return escapeHtml(code);
}
