import asyncio

import pytest

from app.auth.sessions import SESSION_COOKIE_NAME
from tests._auth_helpers import authed_cookies


def test_me_anonymous_returns_204(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 204
    assert r.content == b""


def test_me_authenticated_returns_user_fields(client):
    cookies, user = asyncio.get_event_loop().run_until_complete(
        authed_cookies(client, login="alice", github_id=7)
    )
    r = client.get("/api/auth/me", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["login"] == "alice"
    assert body["name"] == "Alice"
    assert body["avatar_url"].endswith("alice.png")
    assert "id" in body


def test_me_unknown_session_returns_204_and_clears_cookie(client):
    r = client.get("/api/auth/me", cookies={SESSION_COOKIE_NAME: "no_such_sid"})
    assert r.status_code == 204
    # Set-Cookie header clears the cookie
    set_cookie = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "Max-Age=0" in set_cookie or 'max-age=0' in set_cookie.lower()
