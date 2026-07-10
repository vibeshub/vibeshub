"""Single product version: PLUGIN_VERSION is the source of truth."""

from __future__ import annotations

import json
import re
from pathlib import Path

from vibeshub_client.version import PLUGIN_VERSION

_REPO_ROOT = Path(__file__).resolve().parents[3]
_PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def _pyproject_version(path: Path) -> str:
    match = re.search(
        r'(?m)^version\s*=\s*"([^"]+)"',
        path.read_text(encoding="utf-8"),
    )
    assert match is not None, f"could not find version in {path}"
    return match.group(1)


def _plugin_json_version(path: Path) -> str:
    return json.loads(path.read_text(encoding="utf-8"))["version"]


def test_product_versions_match_plugin_version():
    """Plugin manifests, webapp packages, and FastAPI metadata stay in lockstep."""
    expected = PLUGIN_VERSION

    assert _plugin_json_version(_PLUGIN_ROOT / ".claude-plugin" / "plugin.json") == expected
    assert _plugin_json_version(_PLUGIN_ROOT / ".codex-plugin" / "plugin.json") == expected
    assert _pyproject_version(_PLUGIN_ROOT / "pyproject.toml") == expected
    assert _pyproject_version(_REPO_ROOT / "webapp" / "backend" / "pyproject.toml") == expected

    package = json.loads(
        (_REPO_ROOT / "webapp" / "frontend" / "package.json").read_text(encoding="utf-8")
    )
    assert package["version"] == expected

    main_py = (_REPO_ROOT / "webapp" / "backend" / "app" / "main.py").read_text(
        encoding="utf-8"
    )
    match = re.search(r'FastAPI\(title="vibeshub", version="([^"]+)"', main_py)
    assert match is not None, "could not find FastAPI version= in app/main.py"
    assert match.group(1) == expected
