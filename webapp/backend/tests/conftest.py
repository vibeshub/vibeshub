import pytest
import respx
from fastapi.testclient import TestClient


@pytest.fixture
def _settings_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBESHUB_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("VIBESHUB_BLOB_DIR", str(tmp_path / "blobs"))
    monkeypatch.setenv("VIBESHUB_GITHUB_API_BASE", "https://api.github.test")
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://vibeshub.test")


@pytest.fixture
def client(_settings_env):
    # Lazy import so env vars are seen by Settings()
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router
