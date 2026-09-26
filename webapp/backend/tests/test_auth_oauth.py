from urllib.parse import parse_qs, urlparse

import pytest
import respx
from sqlalchemy import select

from app.auth.crypto import TokenCipher
from app.auth.sessions import SESSION_COOKIE_NAME
from app.settings import get_settings
from app.storage.models import User, UserSession


def test_login_redirects_to_github_with_correct_scope(client):
    r = client.get("/api/auth/github/login", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    parsed = urlparse(loc)
    assert parsed.netloc == "github.com"
    qs = parse_qs(parsed.query)
    assert qs["client_id"] == ["Iv1.test"]
    assert qs["scope"] == ["read:user user:email"]
    assert "state" in qs


def test_login_rejects_open_redirect_next(client):
    """An off-host `next` must be ignored — only same-origin paths are honored."""
    for bad in (
        "https://evil.com/x",
        "//evil.com/x",
        "javascript:alert(1)",
        "/\\evil.com",
    ):
        r = client.get(
            f"/api/auth/github/login?next={bad}", follow_redirects=False
        )
        assert r.status_code == 302
        assert urlparse(r.headers["location"]).netloc == "github.com"


def test_callback_user_denied_redirects_with_error(client):
    r = client.get(
        "/api/auth/github/callback?error=access_denied",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=denied"


def test_callback_state_mismatch_redirects_with_error(client):
    r = client.get(
        "/api/auth/github/callback?code=somecode&state=forged_state",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=state_mismatch"


@pytest.mark.asyncio
async def test_callback_success_creates_user_and_session(
    client, respx_mock: respx.MockRouter
):
    # 1) Seed state
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]

    # 2) Mock GitHub
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200,
        json={
            "access_token": "gho_real",
            "scope": "read:user,user:email",
            "token_type": "bearer",
        },
    )
    respx_mock.get("https://api.github.test/user").respond(
        200,
        json={
            "id": 4242,
            "login": "octocat",
            "name": "The Octocat",
            "avatar_url": "https://avatars.githubusercontent.com/u/4242?v=4",
        },
    )
    respx_mock.get("https://api.github.test/user/emails").respond(
        200,
        json=[
            {"email": "octocat@example.com", "primary": True, "verified": True}
        ],
    )

    # 3) Callback
    r = client.get(
        f"/api/auth/github/callback?code=goodcode&state={state}",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/"
    set_cookie = r.headers["set-cookie"]
    assert SESSION_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie or "SameSite=Lax" in set_cookie

    # 4) DB rows
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        user = (await session.execute(
            select(User).where(User.github_id == 4242)
        )).scalar_one()
        assert user.github_login == "octocat"
        assert user.email == "octocat@example.com"
        assert "read:user" in user.token_scopes
        cipher = TokenCipher(get_settings().token_encryption_key)
        assert cipher.decrypt(user.encrypted_access_token) == "gho_real"

        sessions = (await session.execute(
            select(UserSession).where(UserSession.user_id == user.id)
        )).scalars().all()
        assert len(sessions) == 1


@pytest.mark.asyncio
async def test_callback_github_token_exchange_failure(
    client, respx_mock: respx.MockRouter
):
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]

    respx_mock.post("https://github.com/login/oauth/access_token").respond(500)

    r = client.get(
        f"/api/auth/github/callback?code=bad&state={state}",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=github_error"

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert users == []


@pytest.mark.asyncio
async def test_repeat_login_upserts_same_github_id(
    client, respx_mock: respx.MockRouter
):
    # First login: github_id=42, login=alice
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200, json={"access_token": "t1", "scope": "read:user,user:email"}
    )
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"id": 42, "login": "alice", "name": "Alice", "avatar_url": ""}
    )
    respx_mock.get("https://api.github.test/user/emails").respond(200, json=[])
    client.get(
        f"/api/auth/github/callback?code=c1&state={state}", follow_redirects=False
    )

    # Second login: same github_id=42 but renamed to "alice_new"
    respx_mock.reset()
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200, json={"access_token": "t2", "scope": "read:user,user:email"}
    )
    respx_mock.get("https://api.github.test/user").respond(
        200,
        json={
            "id": 42, "login": "alice_new", "name": "Alice New", "avatar_url": ""
        },
    )
    respx_mock.get("https://api.github.test/user/emails").respond(200, json=[])
    client.get(
        f"/api/auth/github/callback?code=c2&state={state}", follow_redirects=False
    )

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert len(users) == 1
        assert users[0].github_login == "alice_new"
        cipher = TokenCipher(get_settings().token_encryption_key)
        assert cipher.decrypt(users[0].encrypted_access_token) == "t2"


def test_login_with_scope_private_requests_repo_scope(client):
    resp = client.get(
        "/api/auth/github/login?scope=private", follow_redirects=False
    )
    assert resp.status_code in (302, 307)
    location = resp.headers["location"]
    # GitHub's authorize URL carries the scope as a query param; `repo`
    # must be present when the private upgrade was requested.
    assert "repo" in location


def test_login_default_does_not_request_repo_scope(client):
    resp = client.get(
        "/api/auth/github/login", follow_redirects=False
    )
    assert resp.status_code in (302, 307)
    location = resp.headers["location"]
    assert "repo" not in location


def _login_as(client, respx_mock, *, github_id: int, login: str, token: str):
    respx_mock.reset()
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200, json={"access_token": token, "scope": "read:user,user:email"}
    )
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"id": github_id, "login": login, "name": login, "avatar_url": ""}
    )
    respx_mock.get("https://api.github.test/user/emails").respond(200, json=[])
    return client.get(
        f"/api/auth/github/callback?code=c&state={state}", follow_redirects=False
    )


@pytest.mark.asyncio
async def test_login_with_reused_github_login_does_not_500(
    client, respx_mock: respx.MockRouter
):
    # github_id=42 owned "foo", renamed away; github_id=99 now owns "foo".
    assert _login_as(client, respx_mock, github_id=42, login="foo", token="t1").status_code == 303
    r = _login_as(client, respx_mock, github_id=99, login="foo", token="t2")
    assert r.status_code == 303
    assert r.headers["location"] == "/"

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        new_owner = (await session.execute(
            select(User).where(User.github_login == "foo")
        )).scalar_one()
        assert new_owner.github_id == 99
        old = (await session.execute(
            select(User).where(User.github_id == 42)
        )).scalar_one()
        assert old.github_login != "foo"


@pytest.mark.asyncio
async def test_rename_carries_trace_ownership_and_login_reuse_does_not(
    client, respx_mock: respx.MockRouter
):
    from app.storage.models import Trace

    _login_as(client, respx_mock, github_id=42, login="alice", token="t1")
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        session.add(Trace(
            short_id="abc12345", owner_login="alice", platform="web",
            byte_size=10, message_count=1, is_private=False,
        ))
        await session.commit()

    # Someone else takes "alice": the trace must NOT become theirs.
    _login_as(client, respx_mock, github_id=99, login="alice", token="t2")
    async with SessionLocal() as session:
        t = (await session.execute(select(Trace))).scalar_one()
        assert t.owner_login != "alice"
        displaced = t.owner_login

    # The original user logs in under their new name: ownership follows.
    _login_as(client, respx_mock, github_id=42, login="alice-new", token="t3")
    async with SessionLocal() as session:
        t = (await session.execute(select(Trace))).scalar_one()
        assert t.owner_login == "alice-new"
        assert t.owner_login != displaced
