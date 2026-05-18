import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE_NAME
from app.storage.models import UserSession
from tests._auth_helpers import authed_cookies


def test_logout_get_returns_405(tmp_path, monkeypatch, _settings_env):
    # The default SPA catch-all serves any GET when frontend_dist/index.html
    # is present locally. Disable it for this test so we exercise pure
    # method routing on /api/auth/logout.
    import app.main as main
    monkeypatch.setattr(
        main, "_frontend_dist_override", tmp_path / "no-such-dir",
        raising=False,
    )
    from app.main import create_app

    with TestClient(create_app()) as c:
        r = c.get("/api/auth/logout")
        assert r.status_code == 405


def test_logout_anonymous_returns_204(client):
    r = client.post("/api/auth/logout")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_logout_deletes_session_and_clears_cookie(client):
    cookies, user = await authed_cookies(client, login="alice", github_id=11)
    sid = cookies[SESSION_COOKIE_NAME]

    r = client.post("/api/auth/logout", cookies=cookies)
    assert r.status_code == 204

    set_cookie = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie.lower()

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(UserSession).where(UserSession.id == sid)
        )).scalars().all()
        assert rows == []
