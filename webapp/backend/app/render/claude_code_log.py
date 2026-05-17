from __future__ import annotations

import re
import tempfile
from pathlib import Path


class RenderError(Exception):
    pass


# Runs before any other script. Browsers throw SecurityError when sandboxed
# iframes (sandbox="allow-scripts" without allow-same-origin) touch
# window.localStorage; claude-code-log's search code accesses it unguarded.
# Detect the throw and swap in an in-memory replacement so scripts continue.
_STORAGE_SHIM = """<script id="vibeshub-storage-shim">
(function () {
  function makeMemoryStorage() {
    var store = Object.create(null);
    return {
      getItem: function (k) { return k in store ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      clear: function () { store = Object.create(null); },
      key: function (i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }
  function install(name) {
    try { window[name].getItem("__probe__"); return; } catch (e) {}
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: (function (s) { return function () { return s; }; })(makeMemoryStorage())
      });
    } catch (e) { /* nothing we can do */ }
  }
  install("localStorage");
  install("sessionStorage");
})();
</script>
"""


_HEAD_OPEN_RE = re.compile(r"<head\b[^>]*>", re.IGNORECASE)


def _inject_storage_shim(html: str) -> str:
    match = _HEAD_OPEN_RE.search(html)
    if not match:
        # No <head>: prepend so the shim still runs before everything.
        return _STORAGE_SHIM + html
    insert_at = match.end()
    return html[:insert_at] + "\n" + _STORAGE_SHIM + html[insert_at:]


def render_jsonl_to_html(data: bytes) -> str:
    """
    Render a Claude Code JSONL transcript to standalone HTML.

    Implementation note: this uses claude-code-log's Python API
    (``claude_code_log.converter.convert_jsonl_to_html``) rather than the
    CLI, since a stable in-process entry point exists. The function
    signature ``bytes -> str`` is the contract we hold; the body can be
    swapped (CLI shell-out, alternate renderer) without touching callers.
    """
    # Imported lazily so import errors surface as RenderError at call time
    # rather than at module import.
    try:
        from claude_code_log.converter import convert_jsonl_to_html
    except ImportError as e:  # pragma: no cover - defensive
        raise RenderError(f"claude-code-log is not installed: {e}") from e

    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        in_path = tmpdir / "session.jsonl"
        out_path = tmpdir / "session.html"
        in_path.write_bytes(data)
        try:
            produced = convert_jsonl_to_html(
                in_path,
                output_path=out_path,
                generate_individual_sessions=False,
                use_cache=False,
                silent=True,
            )
        except Exception as e:  # noqa: BLE001 - wrap any converter failure
            raise RenderError(f"claude-code-log failed: {e}") from e
        produced_path = Path(produced) if produced else out_path
        if not produced_path.exists():
            raise RenderError("claude-code-log produced no output file")
        return _inject_storage_shim(produced_path.read_text("utf-8"))
