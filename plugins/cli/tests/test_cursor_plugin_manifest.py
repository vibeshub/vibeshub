import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def test_marketplace_lists_the_plugin():
    mk = json.loads((REPO_ROOT / ".cursor-plugin" / "marketplace.json").read_text())
    assert mk["name"] == "vibeshub"
    entry = mk["plugins"][0]
    assert entry["name"] == "vibeshub"
    assert entry["source"] == "./plugins/cli"


def test_plugin_manifest_points_at_cursor_hooks():
    pj = json.loads((PLUGIN_ROOT / ".cursor-plugin" / "plugin.json").read_text())
    assert pj["name"] == "vibeshub"
    hooks_rel = pj["hooks"].lstrip("./")
    assert (PLUGIN_ROOT / hooks_rel).is_file()


def test_cursor_hooks_run_share_with_cursor_platform():
    hk = json.loads((PLUGIN_ROOT / "hooks" / "cursor-hooks.json").read_text())
    events = hk["hooks"]["afterShellExecution"]
    assert len(events) == 1
    cmd = events[0]["command"]
    assert "VIBESHUB_PLATFORM=cursor" in cmd
    assert "on-pr-share.py" in cmd
    assert (PLUGIN_ROOT / "hooks" / "on-pr-share.py").is_file()
