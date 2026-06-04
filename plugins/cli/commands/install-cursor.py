#!/usr/bin/env python3
"""Install the vibeshub auto-share hook into the user's ~/.cursor/hooks.json.

Merges (does not clobber) an `afterShellExecution` hook that runs the plugin's
on-pr-share.py after a `git push`, with VIBESHUB_PLATFORM=cursor set so the
adapter routes to the Cursor reader. Idempotent.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_MARKER = "on-pr-share.py"


def _hook_command(plugin_root: Path) -> str:
    script = plugin_root / "hooks" / "on-pr-share.py"
    return f'VIBESHUB_PLATFORM=cursor python3 "{script}"'


def install(home: Path | None = None, plugin_root: Path | None = None) -> Path:
    home = home or Path.home()
    plugin_root = plugin_root or Path(__file__).resolve().parents[1]
    hooks_path = home / ".cursor" / "hooks.json"
    hooks_path.parent.mkdir(parents=True, exist_ok=True)

    if hooks_path.is_file():
        try:
            data = json.loads(hooks_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
    else:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("version", 1)
    hooks = data.setdefault("hooks", {})
    after = hooks.setdefault("afterShellExecution", [])

    after[:] = [
        h for h in after
        if not (isinstance(h, dict) and _MARKER in str(h.get("command", "")))
    ]
    after.append({"command": _hook_command(plugin_root), "matcher": r"git\s+push"})

    hooks_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return hooks_path


if __name__ == "__main__":
    path = install()
    print(f"Installed vibeshub Cursor auto-share hook into {path}")
    print("Restart Cursor (or save hooks.json) to load it.")
    sys.exit(0)
