def test_new_auth_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "Iv1.abc")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "secret")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "ghp_x")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "x" * 32)
    monkeypatch.setenv(
        "VIBESHUB_TOKEN_ENCRYPTION_KEY",
        "uPL4kPYxOJ-9pTewq6Vg0_LZeQyzrIw0idl_Ld_AQ7E=",
    )
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "false")

    from app.settings import Settings

    s = Settings()
    assert s.github_oauth_client_id == "Iv1.abc"
    assert s.github_oauth_client_secret == "secret"
    assert s.github_fallback_token == "ghp_x"
    assert s.session_secret == "x" * 32
    assert s.token_encryption_key.endswith("=")
    assert s.cookie_secure is False


def test_new_auth_settings_default_empty(monkeypatch):
    # The autouse `_settings_env` fixture in conftest.py sets these env vars
    # for the test suite; this test needs a clean env to verify defaults.
    for var in (
        "VIBESHUB_GITHUB_OAUTH_CLIENT_ID",
        "VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET",
        "VIBESHUB_GITHUB_FALLBACK_TOKEN",
        "VIBESHUB_SESSION_SECRET",
        "VIBESHUB_TOKEN_ENCRYPTION_KEY",
        "VIBESHUB_COOKIE_SECURE",
    ):
        monkeypatch.delenv(var, raising=False)

    from app.settings import Settings
    s = Settings(_env_file=None)
    assert s.github_oauth_client_id == ""
    assert s.cookie_secure is True
