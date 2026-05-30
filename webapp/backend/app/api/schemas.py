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
    # None for an anonymous (no-login) upload that has not been claimed.
    owner_login: str | None
    # None for a standalone trace (no PR/repo association).
    repo_full_name: str | None
    pr_number: int | None
    pr_url: str | None
    pr_title: str | None
    title: str | None = None
    platform: str
    byte_size: int
    message_count: int
    created_at: str
    is_private: bool = False

    agent_count: int = 0
    agents: list[AgentSummary] = Field(default_factory=list)


class IngestResponse(BaseModel):
    trace_id: str
    short_id: str
    trace_url: str
    created: bool = True
    # One-time token to later claim an anonymous (no-login) upload. None for
    # the CLI ingest path and for signed-in web uploads.
    claim_token: str | None = None


class ClaimRequest(BaseModel):
    claim_token: str
