import gzip
import io
import json
import tarfile

import pytest

from app.redact.bundle import unpack_and_redact, BundleError


def _make_tar(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_unpack_main_only():
    tar = _make_tar({"main.jsonl": b'{"type":"user"}\n'})
    result = unpack_and_redact(tar, max_total_bytes=10_000)
    assert result.main_bytes == b'{"type":"user"}\n'
    assert result.agents == []
    assert result.total_redactions == 0


def test_unpack_with_one_agent():
    agent_id = "a0123456789abcdef"
    meta = json.dumps({
        "agentType": "Explore",
        "description": "test",
        "toolUseId": "toolu_01abc",
    }).encode()
    tar = _make_tar({
        "main.jsonl": b'{"type":"user"}\n',
        f"agents/{agent_id}.jsonl": b'{"type":"assistant"}\n',
        f"agents/{agent_id}.meta.json": meta,
    })
    result = unpack_and_redact(tar, max_total_bytes=10_000)
    assert len(result.agents) == 1
    a = result.agents[0]
    assert a.agent_id == agent_id
    assert a.jsonl_bytes == b'{"type":"assistant"}\n'
    assert a.meta == {"agentType": "Explore", "description": "test", "toolUseId": "toolu_01abc"}


def test_rejects_path_traversal():
    tar = _make_tar({"../../etc/passwd": b"hi"})
    with pytest.raises(BundleError, match="member"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_rejects_unknown_member():
    tar = _make_tar({"main.jsonl": b'{}', "random.txt": b"x"})
    with pytest.raises(BundleError, match="member"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_rejects_agent_jsonl_without_meta():
    tar = _make_tar({
        "main.jsonl": b'{}',
        "agents/a0123456789abcdef.jsonl": b'{}',
    })
    with pytest.raises(BundleError, match="meta"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_rejects_agent_meta_without_jsonl():
    tar = _make_tar({
        "main.jsonl": b'{}',
        "agents/a0123456789abcdef.meta.json": b'{"agentType":"x","description":"y","toolUseId":null}',
    })
    with pytest.raises(BundleError, match="jsonl"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_rejects_invalid_agent_id():
    tar = _make_tar({
        "main.jsonl": b'{}',
        "agents/bad_id.jsonl": b'{}',
        "agents/bad_id.meta.json": b'{"agentType":"x","description":"y","toolUseId":null}',
    })
    with pytest.raises(BundleError, match="agent_id|member"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_rejects_missing_main():
    tar = _make_tar({
        "agents/a0123456789abcdef.jsonl": b'{}',
        "agents/a0123456789abcdef.meta.json": b'{"agentType":"x","description":"y","toolUseId":null}',
    })
    with pytest.raises(BundleError, match="main"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_oversize_decompressed_rejected():
    big = b"x" * 20_000
    tar = _make_tar({"main.jsonl": big})
    with pytest.raises(BundleError, match="size|exceeds"):
        unpack_and_redact(tar, max_total_bytes=10_000)


def test_redaction_runs_on_each_file():
    # Anthropic key pattern from app/redact/patterns.py
    secret = b"sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaa"
    tar = _make_tar({"main.jsonl": b'{"k":"' + secret + b'"}\n'})
    result = unpack_and_redact(tar, max_total_bytes=10_000)
    assert secret not in result.main_bytes
    assert b"REDACTED" in result.main_bytes
    assert result.total_redactions >= 1


def test_malformed_tar_rejected():
    with pytest.raises(BundleError):
        unpack_and_redact(b"not a tar file", max_total_bytes=10_000)


def test_unpack_accepts_codex_uuid_agent():
    uuid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    tar = _make_tar({
        "main.jsonl": b'{"type":"session_meta","payload":{"id":"019e7ed1"}}\n',
        f"agents/{uuid}.jsonl": b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n',
        f"agents/{uuid}.meta.json": (
            b'{"agentType":"default","description":"Godel","toolUseId":"call_x"}'
        ),
    })
    bundle = unpack_and_redact(tar, max_total_bytes=10_000)
    assert len(bundle.agents) == 1
    assert bundle.agents[0].agent_id == uuid
    assert bundle.agents[0].meta["toolUseId"] == "call_x"


def test_unpack_still_rejects_traversal_agent_name():
    tar = _make_tar({
        "main.jsonl": b"{}\n",
        "agents/../../etc/passwd.jsonl": b"{}\n",
    })
    with pytest.raises(BundleError):
        unpack_and_redact(tar, max_total_bytes=10_000)
