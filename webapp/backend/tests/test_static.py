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
