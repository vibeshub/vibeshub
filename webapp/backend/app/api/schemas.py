from __future__ import annotations

from pydantic import BaseModel, Field


# Note: IngestRequest is gone — /api/ingest now takes raw tar bytes via the
# request body, with PR metadata in X-Vibeshub-* headers.


class AgentSummary(BaseModel):
    agent_id: str
    tool_use_id: str | None
    agent_type: str
    description: str
    message_count: int


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

    agent_count: int = 0
    agents: list[AgentSummary] = Field(default_factory=list)


class IngestResponse(BaseModel):
    trace_id: str
    short_id: str
    trace_url: str
