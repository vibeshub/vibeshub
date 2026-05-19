"""Pack a session's main jsonl + each linked subagent's files into a gzipped
tar buffer suitable for POST /api/ingest. Redacts each file's bytes through
the provided callable; aggregates per-file RedactionReport into a total.

Member names (exactly):
    main.jsonl
    agents/<agent_id>.jsonl
    agents/<agent_id>.meta.json

The meta.json written into the tar has its `toolUseId` set from the linker's
resolution; the on-disk meta.json is not modified.
"""
from __future__ import annotations

import io
import json
import tarfile
import time
from pathlib import Path
from typing import Callable

from vibeshub_client.redact import RedactionReport
from vibeshub_client.subagent_link import AgentEntry


def _add(tar: tarfile.TarFile, name: str, data: bytes, mtime: float) -> None:
    info = tarfile.TarInfo(name=name)
    info.size = len(data)
    info.mtime = int(mtime)
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(data))


def build_bundle(
    main_jsonl: Path,
    agents: list[AgentEntry],
    *,
    redact: Callable[[bytes], tuple[bytes, RedactionReport]],
) -> tuple[bytes, RedactionReport]:
    """Returns (tar_gz_bytes, aggregated_report)."""
    total = RedactionReport()

    def _accumulate(report: RedactionReport) -> None:
        for k, v in report.counts.items():
            total.counts[k] = total.counts.get(k, 0) + v

    main_bytes_in = main_jsonl.read_bytes()
    main_bytes_out, main_report = redact(main_bytes_in)
    _accumulate(main_report)

    buf = io.BytesIO()
    mtime = time.time()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        _add(tar, "main.jsonl", main_bytes_out, mtime)
        for a in agents:
            jsonl_in = a.jsonl_path.read_bytes()
            jsonl_out, r = redact(jsonl_in)
            _accumulate(r)

            meta_in = json.loads(a.meta_path.read_text(encoding="utf-8"))
            # Resolve toolUseId from linker output (may be None for orphans).
            meta_in["toolUseId"] = a.tool_use_id
            meta_bytes_in = json.dumps(meta_in, ensure_ascii=False).encode("utf-8")
            meta_bytes_out, r = redact(meta_bytes_in)
            _accumulate(r)

            _add(tar, f"agents/{a.agent_id}.jsonl", jsonl_out, mtime)
            _add(tar, f"agents/{a.agent_id}.meta.json", meta_bytes_out, mtime)

    return buf.getvalue(), total
