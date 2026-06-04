import io
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path
from threading import Thread

import pytest
import uvicorn
from fastapi import FastAPI, Header, Request


def _write_fake_gh(directory: Path, *, pr_view_url: str | None) -> Path:
    """Write a fake `gh` script into `directory` and return `directory`.

    `gh auth token` and `gh pr comment` always succeed. `gh pr view` echoes
    `pr_view_url` and exits 0, or exits 1 when `pr_view_url` is None (the
    branch has no open PR). Anything else exits 1.
    """
    if pr_view_url is None:
        pr_view = "exit 1"
    else:
        pr_view = f"echo '{pr_view_url}'; exit 0"
    gh = directory / "gh"
    gh.write_text(
        "#!/usr/bin/env bash\n"
        "case \"$1 $2\" in\n"
        "  'auth token') echo 'ghp_test_fake'; exit 0 ;;\n"
        "  'pr comment') [ -n \"$VIBESHUB_TEST_COMMENT_LOG\" ] && echo x >> \"$VIBESHUB_TEST_COMMENT_LOG\"; exit 0 ;;\n"
        f"  'pr view') {pr_view} ;;\n"
        "  *) exit 1 ;;\n"
        "esac\n"
    )
    gh.chmod(0o755)
    return directory


@pytest.fixture
def fake_gh_dir(tmp_path: Path) -> Path:
    """A dir with a fake `gh` whose `pr view` resolves to alice/repo PR 3."""
    d = tmp_path / "ghbin"
    d.mkdir()
    return _write_fake_gh(d, pr_view_url="https://github.com/alice/repo/pull/3")


@pytest.fixture
def fake_gh_dir_no_pr(tmp_path: Path) -> Path:
    """A dir with a fake `gh` whose `pr view` fails (branch has no PR)."""
    d = tmp_path / "ghbin"
    d.mkdir()
    return _write_fake_gh(d, pr_view_url=None)


@pytest.fixture
def fake_server():
    """Spin up a real FastAPI server that emulates /api/ingest (tar + headers)."""
    app = FastAPI()
    received: list[dict] = []
    traces: dict[tuple, str] = {}  # (pr_url, session_id) -> short_id

    @app.post("/api/ingest", status_code=201)
    async def ingest(
        request: Request,
        x_vibeshub_pr_url: str | None = Header(None),
        x_vibeshub_repo: str | None = Header(None),
        x_vibeshub_platform: str = Header(...),
        x_vibeshub_plugin_version: str = Header(...),
        x_vibeshub_session_id: str | None = Header(None),
    ):
        body = await request.body()
        key = (x_vibeshub_pr_url, x_vibeshub_session_id)
        if x_vibeshub_session_id is not None and key in traces:
            short_id = traces[key]
            created = False
        else:
            short_id = f"abc{len(received) + 1:07d}"
            if x_vibeshub_session_id is not None:
                traces[key] = short_id
            created = True
        received.append(
            {
                "tar_bytes": body,
                "pr_url": x_vibeshub_pr_url,
                "repo": x_vibeshub_repo,
                "platform": x_vibeshub_platform,
                "plugin_version": x_vibeshub_plugin_version,
                "content_type": request.headers.get("content-type", ""),
                "created": created,
            }
        )
        return {
            "trace_id": "00000000-0000-0000-0000-000000000001",
            "short_id": short_id,
            "trace_url": f"http://localhost:9999/alice/repo/pull/3/{short_id}",
            "created": created,
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
    hook_script = plugin_root / "hooks" / "on-pr-share.py"
    hook_log = tmp_path / "hook.log"

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
    env["VIBESHUB_HOOK_LOG"] = str(hook_log)
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
    assert body["content_type"] == "application/x-tar"
    # gzipped tar magic
    assert body["tar_bytes"][:2] == b"\x1f\x8b"
    assert "[vibeshub] trace uploaded" in proc.stderr

    # Diagnostics for the upload attempt are written to the hook log.
    log_text = hook_log.read_text()
    upload_line = next(
        (line for line in log_text.splitlines() if "trace uploaded" in line),
        "",
    )
    assert upload_line, f"no upload line in log:\n{log_text}"
    assert "bytes=" in upload_line, upload_line
    assert "elapsed=" in upload_line, upload_line


def test_hook_uploads_codex_platform(
    tmp_path: Path,
    fake_gh_dir: Path,
    fake_server,
):
    """Under a Codex payload (transcript_path under .codex/sessions, CODEX_HOME
    set, tool_input.cmd), the hook uploads with platform=codex."""
    codex_home = tmp_path / ".codex"
    rollout = codex_home / "sessions" / "2026" / "05" / "31" / "rollout-x.jsonl"
    rollout.parent.mkdir(parents=True)
    rollout.write_text(
        '{"type":"session_meta","payload":{"id":"019e7ed1"}}\n'
        '{"type":"response_item","payload":{"type":"message","role":"user",'
        '"content":[{"type":"input_text","text":"hi"}]}}\n'
    )

    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"
    hook_log = tmp_path / "hook.log"

    payload = {
        "session_id": "019e7ed1",
        "cwd": str(tmp_path),
        "transcript_path": str(rollout),
        "tool_input": {"cmd": "gh pr create --fill"},
        "tool_response": {
            "stdout": "https://github.com/alice/repo/pull/3\n",
            "stderr": "",
        },
    }

    env = os.environ.copy()
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(hook_log)
    env["CODEX_HOME"] = str(codex_home)
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    body = fake_server[0]
    assert body["pr_url"] == "https://github.com/alice/repo/pull/3"
    assert body["platform"] == "codex"
    assert body["content_type"] == "application/x-tar"
    # gzipped tar magic
    assert body["tar_bytes"][:2] == b"\x1f\x8b"
    assert "[vibeshub] trace uploaded" in proc.stderr


def test_hook_uploads_cursor_platform(
    tmp_path: Path,
    fake_gh_dir: Path,
    fake_server,
):
    """Under a Cursor afterShellExecution payload (top-level `command`,
    VIBESHUB_PLATFORM=cursor, transcript under ~/.cursor/projects), a `git push`
    uploads with platform=cursor and bundles the dispatched subagent."""
    fake_home = tmp_path / "home"
    cwd = tmp_path / "repo"
    cwd.mkdir()
    uuid = "09fbacda-2df4-47a7-a12e-2534c6d55047"
    tdir = fake_home / ".cursor" / "projects" / "Repo" / "agent-transcripts" / uuid
    tdir.mkdir(parents=True)
    (tdir / f"{uuid}.jsonl").write_text(
        '{"role":"user","message":{"content":[{"type":"text",'
        '"text":"<user_query>do a sweep</user_query>"}]}}\n'
        '{"role":"assistant","message":{"content":['
        '{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore",'
        '"description":"Bug sweep","prompt":"Find bugs"}}]}}\n',
        encoding="utf-8",
    )
    subdir = tdir / "subagents"
    subdir.mkdir()
    (subdir / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl").write_text(
        '{"role":"user","message":{"content":[{"type":"text","text":"Find bugs"}]}}\n',
        encoding="utf-8",
    )

    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": uuid,
        "cwd": str(cwd),
        "command": "git push origin HEAD",  # Cursor afterShellExecution shape
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["VIBESHUB_PLATFORM"] = "cursor"
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    body = fake_server[0]
    assert body["platform"] == "cursor"
    assert body["tar_bytes"][:2] == b"\x1f\x8b"  # gzipped tar magic
    # The dispatched subagent was linked and bundled.
    with tarfile.open(fileobj=io.BytesIO(body["tar_bytes"]), mode="r:gz") as tf:
        names = tf.getnames()
    assert "main.jsonl" in names
    assert any(n.startswith("agents/") and n.endswith(".jsonl") for n in names), names


def test_hook_no_op_when_command_is_not_gh_pr_create(tmp_path: Path):
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

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
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

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


def _setup_transcript(tmp_path: Path) -> tuple[Path, Path, str]:
    """Create Claude Code's on-disk transcript layout under `tmp_path`.
    Returns (fake_home, cwd, session_id)."""
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
    return fake_home, cwd, session_id


def _run_hook(hook_script: Path, payload: dict, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(hook_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


def test_hook_uploads_when_git_push_to_pr_branch(
    tmp_path: Path, fake_gh_dir: Path, fake_server,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "git push origin HEAD"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    assert fake_server[0]["pr_url"] == "https://github.com/alice/repo/pull/3"
    assert "[vibeshub] trace uploaded" in proc.stderr


def test_hook_uploads_when_gh_pr_edit(
    tmp_path: Path, fake_gh_dir: Path, fake_server,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "gh pr edit --title 'new title'"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    assert fake_server[0]["pr_url"] == "https://github.com/alice/repo/pull/3"


def test_hook_silent_when_git_push_has_no_pr(
    tmp_path: Path, fake_gh_dir_no_pr: Path,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "git push"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir_no_pr) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0
    assert proc.stderr == ""


def test_hook_refresh_from_same_session_skips_repeat_comment(
    tmp_path: Path, fake_gh_dir: Path, fake_server,
):
    """A second push from the same session refreshes the trace (created=False
    from the server's upsert) and must NOT post another PR comment."""
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"
    comment_log = tmp_path / "comments.log"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "git push"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["VIBESHUB_TEST_COMMENT_LOG"] = str(comment_log)
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc1 = _run_hook(hook_script, payload, env)
    proc2 = _run_hook(hook_script, payload, env)

    assert proc1.returncode == 0, proc1.stderr
    assert proc2.returncode == 0, proc2.stderr
    # Both uploads reached the server; it upserted them to one trace.
    assert len(fake_server) == 2
    assert fake_server[0]["created"] is True
    assert fake_server[1]["created"] is False
    # The PR comment was posted exactly once — for the first upload only.
    assert comment_log.read_text().count("x") == 1
