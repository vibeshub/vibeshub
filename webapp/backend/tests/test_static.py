from pathlib import Path

import pytest


def _set_frontend_dist(monkeypatch, path: Path) -> None:
    """Patch app.main to look for frontend_dist at the given path."""
    import app.main as main
    monkeypatch.setattr(main, "_frontend_dist_override", path, raising=False)


def test_root_serves_placeholder_when_no_index_html(tmp_path, monkeypatch, _settings_env):
    _set_frontend_dist(monkeypatch, tmp_path / "no-such-dir")
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as client:
        r = client.get("/")
        assert r.status_code == 200
        assert "frontend build not present" in r.text.lower()


def test_root_serves_spa_when_index_html_present(tmp_path, monkeypatch, _settings_env):
    spa_dir = tmp_path / "spa"
    spa_dir.mkdir()
    (spa_dir / "index.html").write_text("<!doctype html><html><body>SPA</body></html>")
    _set_frontend_dist(monkeypatch, spa_dir)

    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as client:
        r = client.get("/")
        assert r.status_code == 200
        assert "SPA" in r.text


def test_deep_link_falls_back_to_index_html(tmp_path, monkeypatch, _settings_env):
    spa_dir = tmp_path / "spa"
    spa_dir.mkdir()
    (spa_dir / "index.html").write_text("<!doctype html><html><body>SPA SHELL</body></html>")
    (spa_dir / "assets").mkdir()
    (spa_dir / "assets" / "main.js").write_text("console.log('hi')")
    _set_frontend_dist(monkeypatch, spa_dir)

    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as client:
        # Deep link should serve the SPA shell
        r = client.get("/alice/repo/pull/3/abc1234567")
        assert r.status_code == 200
        assert "SPA SHELL" in r.text

        # Real asset should be served as-is, not redirected to index.html
        r = client.get("/assets/main.js")
        assert r.status_code == 200
        assert "console.log" in r.text

        # API route still works (under the dist case the catch-all might shadow it
        # if the include_router isn't ordered correctly; this guards against regression)
        r = client.get("/api/health")
        assert r.status_code == 200
