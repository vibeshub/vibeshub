import json
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def test_codex_manifest_exposes_skills_directory():
    manifest = json.loads(
        (PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text()
    )

    assert manifest["skills"] == "./skills/"


def test_share_trace_skill_is_packaged_for_codex():
    skill = PLUGIN_ROOT / "skills" / "share-trace" / "SKILL.md"

    text = skill.read_text()
    assert "name: share-trace" in text
    assert "commands/share-trace.py" in text
    assert "vibeshub:share-trace" in text
