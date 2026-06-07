import pytest
import respx
from fastapi.testclient import TestClient


TEST_FERNET_KEY = "uPL4kPYxOJ-9pTewq6Vg0_LZeQyzrIw0idl_Ld_AQ7E="


@pytest.fixture(autouse=True)
def _settings_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBESHUB_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("VIBESHUB_BLOB_DIR", str(tmp_path / "blobs"))
    monkeypatch.setenv("VIBESHUB_GITHUB_API_BASE", "https://api.github.test")
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://vibeshub.test")
    # Auth / OAuth / cache config — fixed test values.
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "Iv1.test")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "ghp_fallback")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "x" * 32)
    monkeypatch.setenv("VIBESHUB_TOKEN_ENCRYPTION_KEY", TEST_FERNET_KEY)
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "false")


@pytest.fixture
def client(_settings_env):
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
async def db_session(_settings_env):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.storage.models import Base
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(eng, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session
    await eng.dispose()
