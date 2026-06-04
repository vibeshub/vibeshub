import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "install_cursor", Path(__file__).parents[1] / "commands" / "install-cursor.py"
)
install_cursor = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(install_cursor)


def test_creates_hooks_json(tmp_path):
    hooks = tmp_path / ".cursor" / "hooks.json"
    install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads(hooks.read_text())
    assert data["version"] == 1
    cmds = [h["command"] for h in data["hooks"]["afterShellExecution"]]
    assert any("VIBESHUB_PLATFORM=cursor" in c and "on-pr-share.py" in c for c in cmds)


def test_preserves_existing_hooks(tmp_path):
    hooks = tmp_path / ".cursor"
    hooks.mkdir(parents=True)
    (hooks / "hooks.json").write_text(json.dumps({
        "version": 1,
        "hooks": {"afterFileEdit": [{"command": "format.sh"}]},
    }))
    install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads((hooks / "hooks.json").read_text())
    assert data["hooks"]["afterFileEdit"] == [{"command": "format.sh"}]
    assert "afterShellExecution" in data["hooks"]


def test_idempotent(tmp_path):
    for _ in range(2):
        install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads((tmp_path / ".cursor" / "hooks.json").read_text())
    assert len(data["hooks"]["afterShellExecution"]) == 1
