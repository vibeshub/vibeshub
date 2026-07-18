from sqlalchemy import select

from app.search.index import (
    delete_trace_documents,
    explode_digest,
    index_trace_documents,
)
from app.storage.models import AgentRun, SearchDocument, Trace

from tests.search.test_model import _trace

DIGEST = {
    "ask": "Add a /healthcheck route",
    "decisions": "Inline in app/main.py; no separate router",
    "files": "webapp/backend/app/main.py",
    "tests": "test_health.py adds /healthcheck assertion",
    "dead_ends": "Briefly considered a new router; rejected as YAGNI",
    "chapters": [
        {"anchor_uuid": "u1", "title": "Frame the change",
         "caption": "User asks for /healthcheck."},
        {"anchor_uuid": "u2", "title": "Implement",
         "caption": "Route added inline."},
    ],
    "file_notes": [
        {"path": "webapp/backend/app/main.py", "caption": "route added"},
    ],
}


def test_explode_digest_yields_summary_chapters_files():
    trace = _trace(digest_json=DIGEST)
    docs = explode_digest(trace)
    types = [d.source_type for d in docs]
    assert types == ["summary", "chapter", "chapter", "files"]
    summary = docs[0]
    assert "Add a /healthcheck route" in summary.body
    assert "rejected as YAGNI" in summary.body
    assert summary.repo_full_name == "alice/x"
    assert summary.pr_number == 1
    chapter = docs[1]
    assert chapter.anchor_uuid == "u1"
    assert chapter.title == "Frame the change"
    files_doc = docs[3]
    assert "webapp/backend/app/main.py" in files_doc.body


def test_explode_digest_no_chapters_still_yields_summary():
    digest = {**DIGEST, "chapters": [], "file_notes": []}
    docs = explode_digest(_trace(digest_json=digest))
    assert [d.source_type for d in docs] == ["summary"]


async def test_index_is_delete_then_insert(db_session):
    trace = _trace(digest_json=DIGEST)
    db_session.add(trace)
    await index_trace_documents(db_session, trace)
    first = (await db_session.execute(select(SearchDocument))).scalars().all()
    assert len(first) == 4

    trace.is_private = True
    await index_trace_documents(db_session, trace)
    rows = (await db_session.execute(select(SearchDocument))).scalars().all()
    assert len(rows) == 4
    assert all(r.is_private for r in rows)


async def test_index_skips_without_digest_or_repo(db_session):
    t1 = _trace(short_id="nodig123", session_id="s2", digest_json=None)
    t2 = _trace(short_id="norepo12", session_id="s3",
                repo_full_name=None, pr_number=None, digest_json=DIGEST)
    db_session.add_all([t1, t2])
    await index_trace_documents(db_session, t1)
    await index_trace_documents(db_session, t2)
    rows = (await db_session.execute(select(SearchDocument))).scalars().all()
    assert rows == []


async def test_index_failure_recorded_never_raises(db_session, monkeypatch):
    trace = _trace(digest_json=DIGEST)
    db_session.add(trace)

    def boom(_trace):
        raise RuntimeError("explode failed")

    monkeypatch.setattr("app.search.index.explode_digest", boom)
    await index_trace_documents(db_session, trace)  # must not raise
    runs = (await db_session.execute(
        select(AgentRun).where(AgentRun.agent_name == "search_index")
    )).scalars().all()
    assert len(runs) == 1
    assert runs[0].outcome == "fail_call"


async def test_delete_trace_documents(db_session):
    trace = _trace(digest_json=DIGEST)
    db_session.add(trace)
    await index_trace_documents(db_session, trace)
    await delete_trace_documents(db_session, trace.id)
    rows = (await db_session.execute(select(SearchDocument))).scalars().all()
    assert rows == []
