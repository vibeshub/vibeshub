"""Unpack a gzipped tar bundle from /api/ingest, validate membership, run
the existing redact pass on each file, return structured pieces ready for
blob writes.

Allowed members (exactly):
    main.jsonl                          (required, exactly 1)
    agents/<agent_id>.jsonl             (0..N)
    agents/<agent_id>.meta.json         (0..N, must pair with jsonl above)

<agent_id> must match /^a[0-9a-f]{16}$/. Everything else is rejected.
"""
from __future__ import annotations

import io
import json
import os.path
import re
import tarfile
import zipfile
from dataclasses import dataclass

from app.redact.patterns import RedactionReport, redact_jsonl


# Claude Code subagent id (a<16hex>) OR Codex/Cursor thread UUID (8-4-4-4-12 hex).
_AGENT_ID = r"(?:a[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
AGENT_ID_RE = re.compile(rf"^{_AGENT_ID}$")
AGENT_JSONL_RE = re.compile(rf"^agents/({_AGENT_ID})\.jsonl$")
AGENT_META_RE = re.compile(rf"^agents/({_AGENT_ID})\.meta\.json$")

# Local Claude Code subagent naming (e.g. ~/.claude/projects/.../subagents/),
# matched against the member's basename so a leading directory prefix
# (`subagents/agent-a....jsonl`) is tolerated. Used by unpack_loose_files only.
LOCAL_AGENT_JSONL_RE = re.compile(r"^agent-(a[0-9a-f]{16})\.jsonl$")
LOCAL_AGENT_META_RE = re.compile(r"^agent-(a[0-9a-f]{16})\.meta\.json$")


class BundleError(Exception):
    """Raised when the bundle is malformed, oversized, or contains
    disallowed members. Caller maps to HTTP 400 or 413."""


class BundleSizeError(BundleError):
    """Raised when decompressed bundle exceeds the configured cap. Caller
    maps this specifically to HTTP 413 (vs 400 for other BundleErrors)."""


@dataclass
class AgentPiece:
    agent_id: str
    jsonl_bytes: bytes           # redacted
    meta: dict                   # parsed and validated


@dataclass
class UnpackedBundle:
    main_bytes: bytes            # redacted
    agents: list[AgentPiece]
    total_redactions: int


def _validate_meta(meta_bytes: bytes, agent_id: str) -> dict:
    try:
        meta = json.loads(meta_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise BundleError(f"agent {agent_id} meta is not valid utf-8 JSON: {e}")
    if not isinstance(meta, dict):
        raise BundleError(f"agent {agent_id} meta must be a JSON object")
    for required in ("agentType", "description"):
        if required not in meta:
            raise BundleError(f"agent {agent_id} meta missing key: {required}")
    if "toolUseId" not in meta:
        meta["toolUseId"] = None
    return meta


def unpack_and_redact(tar_bytes: bytes, *, max_total_bytes: int) -> UnpackedBundle:
    try:
        tar = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")
    except tarfile.ReadError as e:
        raise BundleError(f"malformed tar: {e}")
    except tarfile.TarError as e:
        raise BundleError(f"malformed tar: {e}")

    main_bytes: bytes | None = None
    agent_jsonls: dict[str, bytes] = {}
    agent_metas: dict[str, bytes] = {}
    total_bytes = 0

    try:
        for member in tar:
            if not member.isfile():
                raise BundleError(f"non-file tar member: {member.name}")

            name = member.name
            if name == "main.jsonl":
                pass
            elif (m := AGENT_JSONL_RE.match(name)):
                agent_id = m.group(1)
                if not AGENT_ID_RE.match(agent_id):
                    raise BundleError(f"invalid agent_id in member: {name}")
            elif (m := AGENT_META_RE.match(name)):
                agent_id = m.group(1)
                if not AGENT_ID_RE.match(agent_id):
                    raise BundleError(f"invalid agent_id in member: {name}")
            else:
                raise BundleError(f"disallowed tar member: {name}")

            total_bytes += member.size
            if total_bytes > max_total_bytes:
                raise BundleSizeError(f"bundle size {total_bytes} exceeds limit {max_total_bytes}")

            extracted = tar.extractfile(member)
            if extracted is None:
                raise BundleError(f"could not extract member: {name}")
            data = extracted.read()

            if name == "main.jsonl":
                main_bytes = data
            elif (jm := AGENT_JSONL_RE.match(name)):
                agent_jsonls[jm.group(1)] = data
            elif (mm := AGENT_META_RE.match(name)):
                agent_metas[mm.group(1)] = data
    finally:
        tar.close()

    if main_bytes is None:
        raise BundleError("bundle missing required member: main.jsonl")

    jsonl_ids = set(agent_jsonls.keys())
    meta_ids = set(agent_metas.keys())
    if jsonl_ids - meta_ids:
        missing = next(iter(jsonl_ids - meta_ids))
        raise BundleError(f"agent {missing}: jsonl present but meta.json missing")
    if meta_ids - jsonl_ids:
        missing = next(iter(meta_ids - jsonl_ids))
        raise BundleError(f"agent {missing}: meta.json present but jsonl missing")

    total_report = RedactionReport()
    redacted_main, main_report = redact_jsonl(main_bytes)
    for k, v in main_report.counts.items():
        total_report.counts[k] = total_report.counts.get(k, 0) + v

    agents: list[AgentPiece] = []
    for agent_id in sorted(jsonl_ids):
        redacted_jsonl, jr = redact_jsonl(agent_jsonls[agent_id])
        for k, v in jr.counts.items():
            total_report.counts[k] = total_report.counts.get(k, 0) + v
        redacted_meta_bytes, mr = redact_jsonl(agent_metas[agent_id])
        for k, v in mr.counts.items():
            total_report.counts[k] = total_report.counts.get(k, 0) + v
        meta = _validate_meta(redacted_meta_bytes, agent_id)

        agents.append(AgentPiece(
            agent_id=agent_id,
            jsonl_bytes=redacted_jsonl,
            meta=meta,
        ))

    return UnpackedBundle(
        main_bytes=redacted_main,
        agents=agents,
        total_redactions=total_report.total(),
    )


def unpack_loose_files(
    main_bytes: bytes,
    subagents_zip_bytes: bytes | None,
    *,
    max_total_bytes: int,
) -> UnpackedBundle:
    """Build an UnpackedBundle from a loose transcript + optional subagent zip.

    Mirrors unpack_and_redact's validation and redaction, but the inputs are
    a raw main .jsonl and an optional .zip of agents/<id>.jsonl +
    agents/<id>.meta.json members (same layout as the tar bundle).
    """
    total_bytes = len(main_bytes)
    agent_jsonls: dict[str, bytes] = {}
    agent_metas: dict[str, bytes] = {}

    if subagents_zip_bytes is not None:
        try:
            zf = zipfile.ZipFile(io.BytesIO(subagents_zip_bytes))
        except zipfile.BadZipFile as e:
            raise BundleError(f"malformed zip: {e}")
        try:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                # Accept either the canonical bundle layout
                # (agents/<id>.jsonl) matched on the full path, or the local
                # Claude Code layout (agent-<id>.jsonl) matched on the
                # basename so a leading dir (subagents/agent-...) is tolerated.
                base = os.path.basename(name)
                is_meta = False
                if (m := AGENT_JSONL_RE.match(name)):
                    agent_id = m.group(1)
                elif (m := AGENT_META_RE.match(name)):
                    agent_id = m.group(1)
                    is_meta = True
                elif (m := LOCAL_AGENT_JSONL_RE.match(base)):
                    agent_id = m.group(1)
                elif (m := LOCAL_AGENT_META_RE.match(base)):
                    agent_id = m.group(1)
                    is_meta = True
                else:
                    raise BundleError(f"disallowed zip member: {name}")
                total_bytes += info.file_size
                if total_bytes > max_total_bytes:
                    raise BundleSizeError(
                        f"bundle size {total_bytes} exceeds limit "
                        f"{max_total_bytes}"
                    )
                data = zf.read(info)
                if is_meta:
                    agent_metas[agent_id] = data
                else:
                    agent_jsonls[agent_id] = data
        finally:
            zf.close()

    if total_bytes > max_total_bytes:
        raise BundleSizeError(
            f"bundle size {total_bytes} exceeds limit {max_total_bytes}"
        )

    jsonl_ids = set(agent_jsonls.keys())
    meta_ids = set(agent_metas.keys())
    if jsonl_ids - meta_ids:
        missing = next(iter(jsonl_ids - meta_ids))
        raise BundleError(
            f"agent {missing}: jsonl present but meta.json missing"
        )
    if meta_ids - jsonl_ids:
        missing = next(iter(meta_ids - jsonl_ids))
        raise BundleError(
            f"agent {missing}: meta.json present but jsonl missing"
        )

    total_report = RedactionReport()
    redacted_main, main_report = redact_jsonl(main_bytes)
    for k, v in main_report.counts.items():
        total_report.counts[k] = total_report.counts.get(k, 0) + v

    agents: list[AgentPiece] = []
    for agent_id in sorted(jsonl_ids):
        redacted_jsonl, jr = redact_jsonl(agent_jsonls[agent_id])
        for k, v in jr.counts.items():
            total_report.counts[k] = total_report.counts.get(k, 0) + v
        redacted_meta_bytes, mr = redact_jsonl(agent_metas[agent_id])
        for k, v in mr.counts.items():
            total_report.counts[k] = total_report.counts.get(k, 0) + v
        meta = _validate_meta(redacted_meta_bytes, agent_id)
        agents.append(AgentPiece(
            agent_id=agent_id,
            jsonl_bytes=redacted_jsonl,
            meta=meta,
        ))

    return UnpackedBundle(
        main_bytes=redacted_main,
        agents=agents,
        total_redactions=total_report.total(),
    )
