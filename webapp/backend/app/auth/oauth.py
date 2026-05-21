from __future__ import annotations

from authlib.integrations.starlette_client import OAuth

from app.settings import Settings


def build_oauth(settings: Settings) -> OAuth:
    """Build a fresh Authlib OAuth registry from settings.

    Called at app start; not a module-global so tests get a clean instance
    per app build.
    """
    oauth = OAuth()
    oauth.register(
        name="github",
        client_id=settings.github_oauth_client_id,
        client_secret=settings.github_oauth_client_secret,
        access_token_url="https://github.com/login/oauth/access_token",
        authorize_url="https://github.com/login/oauth/authorize",
        api_base_url="https://api.github.com/",
        # Default (minimal) scopes for an ordinary login. A `?scope=private`
        # login overrides this per-request with `repo` added — see
        # PRIVATE_SCOPE in app/api/auth.py — so private-repo traces can be
        # access-checked against the viewer's own GitHub permissions.
        client_kwargs={"scope": "read:user user:email"},
    )
    return oauth
