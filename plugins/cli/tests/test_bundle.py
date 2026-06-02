import io
import json
import tarfile
from pathlib import Path

from vibeshub_client.bundle import build_bundle
from vibeshub_client.redact import RedactionReport, redact_jsonl
from vibeshub_client.subagent_link import AgentEntry, link_subagents

FIXTURES = Path(__file__).parent / "fixtures" / "sessions"


def _members(tar_bytes: bytes) -> dict[str, bytes]:
    out = {}
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        for m in tar:
            f = tar.extractfile(m)
            out[m.name] = f.read() if f else b""
    return out


def test_bundle_single_agent_has_expected_members():
    base = FIXTURES / "single-agent"
    agents = link_subagents(base / "session.jsonl", base / "subagents")
    tar_bytes, report = build_bundle(base / "session.jsonl", agents, redact=redact_jsonl)
    members = _members(tar_bytes)
    assert set(members.keys()) == {
        "main.jsonl",
        "agents/a1111111111111111.jsonl",
        "agents/a1111111111111111.meta.json",
    }


def test_bundle_main_is_redacted():
    base = FIXTURES / "single-agent"
    agents = link_subagents(base / "session.jsonl", base / "subagents")
    tar_bytes, _ = build_bundle(base / "session.jsonl", agents, redact=redact_jsonl)
    members = _members(tar_bytes)
    # Redaction is idempotent on already-clean content: byte-identical to
    # redact(main_bytes)
    expected, _ = redact_jsonl((base / "session.jsonl").read_bytes())
    assert members["main.jsonl"] == expected


def test_bundle_meta_has_resolved_tool_use_id():
    base = FIXTURES / "single-agent"
    agents = link_subagents(base / "session.jsonl", base / "subagents")
    tar_bytes, _ = build_bundle(base / "session.jsonl", agents, redact=redact_jsonl)
    members = _members(tar_bytes)
    meta = json.loads(members["agents/a1111111111111111.meta.json"])
    assert meta["toolUseId"] == "toolu_01alpha"
    assert meta["agentType"] == "Explore"
    assert meta["description"] == "Probe X"


def test_bundle_multi_agent_includes_all():
    base = FIXTURES / "multi-agent"
    agents = link_subagents(base / "session.jsonl", base / "subagents")
    tar_bytes, _ = build_bundle(base / "session.jsonl", agents, redact=redact_jsonl)
    members = _members(tar_bytes)
    jsonl_members = [k for k in members if k.startswith("agents/") and k.endswith(".jsonl")]
    assert len(jsonl_members) == 3


def test_bundle_aggregates_redaction_report():
    """Run a payload with one matching redactable token, verify total != 0."""
    base = FIXTURES / "single-agent"
    agents = link_subagents(base / "session.jsonl", base / "subagents")
    # Build a tar over an in-memory file containing a fake Anthropic key
    # would require a different fixture; instead, use a custom redact stub
    # to verify aggregation works.
    from vibeshub_client.redact import RedactionReport

    def stub_redact(data: bytes) -> tuple[bytes, RedactionReport]:
        r = RedactionReport()
        r.counts["fake"] = 1  # one redaction per file
        return data, r

    _, report = build_bundle(base / "session.jsonl", agents, redact=stub_redact)
    # main + agent jsonl + agent meta = 3 files redacted = 3 "fake" counts
    assert report.counts.get("fake") == 3
    assert report.total() == 3


def test_build_bundle_uses_in_memory_meta(tmp_path):
    main = tmp_path / "main.jsonl"
    main.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7ed1"}}\n')
    child = tmp_path / "child.jsonl"
    child.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n')
    entry = AgentEntry(
        agent_id="019e7f09-bca2-7150-ac2b-54f7b075a2ea",
        tool_use_id="call_spawn", agent_type="default", description="Godel",
        jsonl_path=child, meta_path=child,  # meta_path unused when meta is set
        meta={"agentType": "default", "description": "Godel", "toolUseId": "call_spawn"},
    )
    tar_bytes, _ = build_bundle(main, [entry], redact=lambda b: (b, RedactionReport()))
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        names = {m.name for m in tar.getmembers()}
        meta = json.loads(tar.extractfile(
            "agents/019e7f09-bca2-7150-ac2b-54f7b075a2ea.meta.json").read())
    assert "agents/019e7f09-bca2-7150-ac2b-54f7b075a2ea.jsonl" in names
    assert meta["agentType"] == "default"
    assert meta["toolUseId"] == "call_spawn"
