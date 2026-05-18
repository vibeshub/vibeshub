import pytest


@pytest.mark.asyncio
async def test_init_state_raises_when_prod_secrets_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("VIBESHUB_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("VIBESHUB_BLOB_DIR", str(tmp_path / "blobs"))
    monkeypatch.setenv("VIBESHUB_GITHUB_API_BASE", "https://api.github.test")
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://vibeshub.test")
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "true")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "")
    monkeypatch.setenv("VIBESHUB_TOKEN_ENCRYPTION_KEY", "")

    from fastapi import FastAPI
    from app.deps import init_state

    app = FastAPI()
    with pytest.raises(RuntimeError, match="Missing required auth secrets"):
        await init_state(app)


@pytest.mark.asyncio
async def test_init_state_only_warns_in_dev(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("VIBESHUB_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("VIBESHUB_BLOB_DIR", str(tmp_path / "blobs"))
    monkeypatch.setenv("VIBESHUB_GITHUB_API_BASE", "https://api.github.test")
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://vibeshub.test")
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "false")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "")
    monkeypatch.setenv("VIBESHUB_TOKEN_ENCRYPTION_KEY", "")

    from fastapi import FastAPI
    from app.deps import init_state

    app = FastAPI()
    import logging
    with caplog.at_level(logging.WARNING):
        await init_state(app)
    assert any("auth secrets unset" in r.message for r in caplog.records)
