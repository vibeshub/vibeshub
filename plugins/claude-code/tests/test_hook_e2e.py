import json
import os
import subprocess
import sys
from pathlib import Path
from threading import Thread

import pytest
import uvicorn
from fastapi import FastAPI


@pytest.fixture
def fake_gh_dir(tmp_path: Path) -> Path:
    """Create a directory with a fake `gh` script that prints a token then no-ops on comment."""
    gh = tmp_path / "gh"
    gh.write_text(
        "#!/usr/bin/env bash\n"
        "case \"$1 $2\" in\n"
        "  'auth token') echo 'ghp_test_fake'; exit 0 ;;\n"
        "  'pr comment') exit 0 ;;\n"
        "  *) exit 1 ;;\n"
        "esac\n"
    )
    gh.chmod(0o755)
    return tmp_path


@pytest.fixture
def fake_server():
    """Spin up a real FastAPI server that emulates /api/ingest."""
    app = FastAPI()
    received: list[dict] = []

    @app.post("/api/ingest", status_code=201)
    async def ingest(body: dict):
        received.append(body)
        return {
            "trace_id": "00000000-0000-0000-0000-000000000001",
            "short_id": "abc1234567",
            "trace_url": "http://localhost:9999/alice/repo/pull/3/abc1234567",
        }

    config = uvicorn.Config(app, host="127.0.0.1", port=9999, log_level="error")
    server = uvicorn.Server(config)
    thread = Thread(target=server.run, daemon=True)
    thread.start()

    import time
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)

    yield received

    server.should_exit = True
    thread.join(timeout=2)


def test_hook_uploads_when_gh_pr_create_succeeds(
    tmp_path: Path,
    fake_gh_dir: Path,
    fake_server,
    monkeypatch,
):
    fake_home = tmp_path / "home"
    cwd = tmp_path / "repo"
    cwd.mkdir()

    encoded = str(cwd).replace("/", "-")
    transcript_dir = fake_home / ".claude" / "projects" / encoded
    transcript_dir.mkdir(parents=True)
    session_id = "session-xyz"
    (transcript_dir / f"{session_id}.jsonl").write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
    )

    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-create.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "gh pr create --fill"},
        "tool_response": {
            "stdout": "https://github.com/alice/repo/pull/3\n",
            "stderr": "",
        },
    }

    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_AUTO_YES"] = "1"
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = subprocess.run(
        [sys.executable, str(hook_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    body = fake_server[0]
    assert body["pr_url"] == "https://github.com/alice/repo/pull/3"
    assert body["platform"] == "claude-code"
    assert "[vibeshub] trace uploaded" in proc.stderr


def test_hook_no_op_when_command_is_not_gh_pr_create(tmp_path: Path):
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-create.py"

    payload = {
        "session_id": "irrelevant",
        "cwd": str(tmp_path),
        "tool_input": {"command": "ls -la"},
        "tool_response": {"stdout": "", "stderr": ""},
    }

    env = os.environ.copy()
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)

    proc = subprocess.run(
        [sys.executable, str(hook_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )

    assert proc.returncode == 0
    assert proc.stderr == ""


def test_hook_silent_when_pr_create_failed(tmp_path: Path):
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-create.py"

    payload = {
        "session_id": "irrelevant",
        "cwd": str(tmp_path),
        "tool_input": {"command": "gh pr create"},
        "tool_response": {"stdout": "error: not on a branch\n", "stderr": ""},
    }

    env = os.environ.copy()
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)

    proc = subprocess.run(
        [sys.executable, str(hook_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )

    assert proc.returncode == 0
    assert proc.stderr == ""
