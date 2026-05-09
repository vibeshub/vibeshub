from __future__ import annotations

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    transcript_jsonl: str = Field(min_length=1)
    pr_url: str
    platform: str = Field(default="claude-code")
    plugin_version: str | None = None
    session_id: str | None = None
    redaction_count_client: int = 0


class TraceSummary(BaseModel):
    trace_id: str
    short_id: str
    owner_login: str
    repo_full_name: str
    pr_number: int
    pr_url: str
    pr_title: str | None
    platform: str
    byte_size: int
    message_count: int
    created_at: str


class IngestResponse(BaseModel):
    trace_id: str
    short_id: str
    trace_url: str
