"""Tests for scripts/sync-cursor-plugin.py — the Cursor marketplace plugin generator.

The generator lives at the repo root (scripts/) and packages this plugin
(plugins/cli) into a self-contained Cursor plugin tree. Loaded via importlib
because the filename is hyphenated (matches test_install_cursor.py's pattern).
"""
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_PLUGIN_SRC = _REPO_ROOT / "plugins" / "cli"
_SCRIPT = _REPO_ROOT / "scripts" / "sync-cursor-plugin.py"

_SPEC = importlib.util.spec_from_file_location("sync_cursor_plugin", _SCRIPT)
sync = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(sync)


def test_generates_expected_tree(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)

    expected = [
        ".cursor-plugin/marketplace.json",
        ".cursor-plugin/plugin.json",
        "hooks/hooks.json",
        "hooks/on-pr-share.sh",
        "hooks/on-pr-share.py",
        "vibeshub_client/__init__.py",
        "vibeshub_client/pipeline.py",
        "vibeshub_client/_vendor/truststore/__init__.py",
        "platform_adapter.py",
        "reader.py",
        "codex_reader.py",
        "cursor_reader.py",
        "README.md",
        "LICENSE",
    ]
    for rel in expected:
        assert (out / rel).is_file(), f"missing generated file: {rel}"


def test_no_claude_or_codex_artifacts(tmp_path):
    """The separate-repo invariant: nothing that makes Cursor mis-resolve the
    plugin or pick up a Claude-format hook may appear in the tree."""
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)

    forbidden_dirs = {".claude-plugin", ".codex-plugin", "__pycache__"}
    for path in out.rglob("*"):
        assert path.name not in forbidden_dirs, f"forbidden artifact present: {path}"

    # The hook MANIFEST must be Cursor format — no Claude-only tokens. (The copied
    # runtime on-pr-share.py legitimately references CLAUDE_PLUGIN_ROOT as a
    # fallback, so this check is scoped to the manifest.)
    hooks_text = (out / "hooks" / "hooks.json").read_text()
    assert "PostToolUse" not in hooks_text
    assert "CLAUDE_PLUGIN_ROOT" not in hooks_text


def test_hooks_json_is_cursor_format(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)
    data = json.loads((out / "hooks" / "hooks.json").read_text())

    assert set(data["hooks"]) == {"afterShellExecution"}
    entries = data["hooks"]["afterShellExecution"]
    assert len(entries) == 1
    assert entries[0]["command"] == "./hooks/on-pr-share.sh"
    assert entries[0]["matcher"] == r"gh pr (create|edit)|git\s+push"


def test_plugin_json_version_matches_source(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)

    version_text = (_PLUGIN_SRC / "vibeshub_client" / "version.py").read_text()
    source_version = version_text.split('"')[1]

    plugin = json.loads((out / ".cursor-plugin" / "plugin.json").read_text())
    assert plugin["version"] == source_version
    assert plugin["hooks"] == "./hooks/hooks.json"
    assert "vibeshub-cursor" in plugin["repository"]


def test_wrapper_is_executable_and_routes_cursor(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)
    wrapper = out / "hooks" / "on-pr-share.sh"

    assert wrapper.stat().st_mode & stat.S_IXUSR, "wrapper is not user-executable"
    text = wrapper.read_text()
    assert "export VIBESHUB_PLATFORM=cursor" in text
    assert "exec python3" in text
    assert "on-pr-share.py" in text


def test_generated_tree_is_import_complete(tmp_path):
    """The copied runtime subset must import and select the Cursor reader from
    the generated root — proves no transitive module was left behind."""
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)

    probe = (
        "import sys; sys.path.insert(0, sys.argv[1]);"
        "import vibeshub_client.pipeline, vibeshub_client.gh_token,"
        " vibeshub_client.share_trigger, vibeshub_client.pr_resolve,"
        " vibeshub_client.parse_pr_url;"
        "import platform_adapter;"
        "r = platform_adapter.select_adapter({}, {'VIBESHUB_PLATFORM': 'cursor'});"
        "print(type(r).__name__)"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe, str(out)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert result.returncode == 0, f"import failed:\n{result.stderr}"
    assert result.stdout.strip() == "CursorTranscriptReader"


def test_regenerate_preserves_unmanaged_and_is_idempotent(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)

    # Simulate --out being a real clone with its own VCS + extra files.
    (out / ".git").mkdir()
    (out / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    (out / ".gitignore").write_text("dist/\n")

    sync.generate(out=out, source=_PLUGIN_SRC)

    assert (out / ".git" / "HEAD").read_text() == "ref: refs/heads/main\n"
    assert (out / ".gitignore").read_text() == "dist/\n"
    assert sync.check(out, source=_PLUGIN_SRC), "regenerate is not idempotent"


def test_check_detects_drift(tmp_path):
    out = tmp_path / "vibeshub-cursor"
    sync.generate(out=out, source=_PLUGIN_SRC)
    assert sync.check(out, source=_PLUGIN_SRC) is True

    with (out / "README.md").open("a") as f:
        f.write("drift\n")
    assert sync.check(out, source=_PLUGIN_SRC) is False
