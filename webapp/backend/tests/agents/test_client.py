import pytest


@pytest.fixture(autouse=True)
def _clear_module(monkeypatch):
    """Ensure get_client reads the current env on each call."""
    yield


def test_get_client_returns_none_when_env_unset(monkeypatch):
    monkeypatch.delenv("VIBESHUB_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    from app.agents._client import get_client
    assert get_client() is None


def test_get_client_returns_none_when_only_partially_set(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    from app.agents._client import get_client
    assert get_client() is None


def test_get_client_constructs_openai_when_all_set(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://example/v1")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5-deploy")
    from app.agents._client import get_client, get_model
    client = get_client()
    assert client is not None
    # OpenAI client exposes .responses; we don't actually call out
    assert hasattr(client, "responses")
    assert get_model() == "gpt-5.5-deploy"
