import io
import json
import zipfile

import pytest

from app.redact.bundle import unpack_loose_files, BundleError, BundleSizeError


def _make_zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_unpack_loose_main_only():
    result = unpack_loose_files(
        b'{"type":"user"}\n', None, max_total_bytes=10_000
    )
    assert result.main_bytes == b'{"type":"user"}\n'
    assert result.agents == []
    assert result.total_redactions == 0


def test_unpack_loose_with_agent_zip():
    aid = "a0123456789abcdef"
    meta = json.dumps({
        "agentType": "Explore",
        "description": "test",
        "toolUseId": "toolu_01abc",
    }).encode()
    zip_bytes = _make_zip({
        f"agents/{aid}.jsonl": b'{"type":"assistant"}\n',
        f"agents/{aid}.meta.json": meta,
    })
    result = unpack_loose_files(
        b'{"type":"user"}\n', zip_bytes, max_total_bytes=10_000
    )
    assert len(result.agents) == 1
    a = result.agents[0]
    assert a.agent_id == aid
    assert a.jsonl_bytes == b'{"type":"assistant"}\n'
    assert a.meta == {
        "agentType": "Explore",
        "description": "test",
        "toolUseId": "toolu_01abc",
    }


def test_unpack_loose_rejects_unknown_zip_member():
    zip_bytes = _make_zip({"random.txt": b"x"})
    with pytest.raises(BundleError, match="member"):
        unpack_loose_files(b"{}\n", zip_bytes, max_total_bytes=10_000)


def test_unpack_loose_rejects_agent_jsonl_without_meta():
    zip_bytes = _make_zip({"agents/a0123456789abcdef.jsonl": b"{}"})
    with pytest.raises(BundleError, match="meta"):
        unpack_loose_files(b"{}\n", zip_bytes, max_total_bytes=10_000)


def test_unpack_loose_rejects_malformed_zip():
    with pytest.raises(BundleError, match="zip"):
        unpack_loose_files(b"{}\n", b"not a zip", max_total_bytes=10_000)


def test_unpack_loose_rejects_oversize():
    with pytest.raises(BundleSizeError):
        unpack_loose_files(b"x" * 5000, None, max_total_bytes=100)
