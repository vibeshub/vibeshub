import importlib.util
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib import error as urllib_error

_SHARE_TRACE_PATH = (
    Path(__file__).resolve().parent.parent / "commands" / "share-trace.py"
)


def _load_share_trace():
    """share-trace.py has a hyphen so it can't be imported normally; load
    it by path. Module-load has no side effects (only defs + a __main__
    guard)."""
    spec = importlib.util.spec_from_file_location(
        "share_trace_cmd", _SHARE_TRACE_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_session_id_prefers_claude_code_session_id():
    mod = _load_share_trace()
    with patch.dict(
        os.environ,
        {"CLAUDE_CODE_SESSION_ID": "from-cc", "CLAUDE_SESSION_ID": "legacy"},
        clear=True,
    ):
        assert mod._session_id() == "from-cc"


def test_session_id_falls_back_to_legacy_var():
    mod = _load_share_trace()
    with patch.dict(os.environ, {"CLAUDE_SESSION_ID": "legacy"}, clear=True):
        assert mod._session_id() == "legacy"


def test_session_id_is_none_when_unset():
    mod = _load_share_trace()
    with patch.dict(os.environ, {}, clear=True):
        assert mod._session_id() is None


def test_delete_short_id_from_bare_id():
    mod = _load_share_trace()
    assert mod._delete_short_id("abc1234567") == "abc1234567"


def test_delete_short_id_from_t_url():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://vibeshub.ai/t/abc1234567"
    ) == "abc1234567"


def test_delete_short_id_from_t_url_with_trailing_slash():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://vibeshub.ai/t/abc1234567/"
    ) == "abc1234567"


def test_delete_short_id_returns_none_for_pr_url():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://github.com/alice/repo/pull/3"
    ) is None


def test_resolve_target_prefers_pr():
    mod = _load_share_trace()
    with patch.object(mod, "resolve_pr_url", return_value="https://github.com/a/r/pull/9"), \
         patch.object(mod, "resolve_repo_full_name") as repo:
        pr_url, repo_full_name = mod._resolve_target(arg=None)
    assert pr_url == "https://github.com/a/r/pull/9"
    assert repo_full_name is None
    repo.assert_not_called()


def test_resolve_target_falls_back_to_repo_when_no_pr():
    mod = _load_share_trace()

    def no_pr(arg, cwd=None):
        raise subprocess.CalledProcessError(1, "gh", stderr="no PR")

    with patch.object(mod, "resolve_pr_url", side_effect=no_pr), \
         patch.object(mod, "resolve_repo_full_name", return_value="alice/repo"):
        pr_url, repo_full_name = mod._resolve_target(arg=None)
    assert pr_url is None
    assert repo_full_name == "alice/repo"


def test_resolve_target_falls_back_to_standalone_when_no_pr_or_repo():
    mod = _load_share_trace()

    def no_pr(arg, cwd=None):
        raise subprocess.CalledProcessError(1, "gh", stderr="no PR")

    with patch.object(mod, "resolve_pr_url", side_effect=no_pr), \
         patch.object(mod, "resolve_repo_full_name", return_value=None):
        pr_url, repo_full_name = mod._resolve_target(arg=None)
    assert pr_url is None
    assert repo_full_name is None


def test_resolve_target_uses_explicit_pr_arg():
    mod = _load_share_trace()
    with patch.object(
        mod, "resolve_pr_url", return_value="https://github.com/a/r/pull/4"
    ) as pr, patch.object(mod, "resolve_repo_full_name") as repo:
        pr_url, repo_full_name = mod._resolve_target(arg="4")
    assert pr_url == "https://github.com/a/r/pull/4"
    assert repo_full_name is None
    assert pr.call_args.args[0] == "4"
    repo.assert_not_called()


def _fake_http_response(status: int, body: str):
    """A urlopen() return value usable as a context manager."""
    resp = MagicMock()
    resp.status = status
    resp.read.return_value = body.encode("utf-8")
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


def _http_error(code: int, body: str = ""):
    return urllib_error.HTTPError(
        url="http://x", code=code, msg="err", hdrs=None,
        fp=io.BytesIO(body.encode("utf-8")),
    )


# --- _delete_by_short_id ---


def test_delete_by_short_id_success(capsys):
    import asyncio

    mod = _load_share_trace()
    with patch("vibeshub_client.gh_token.get_gh_token", return_value="tok"), \
         patch("urllib.request.urlopen",
               return_value=_fake_http_response(204, "")) as urlopen:
        asyncio.run(mod._delete_by_short_id("abc1234567", "https://vibeshub.ai"))
    out = capsys.readouterr()
    assert "deleted trace abc1234567" in out.out
    req = urlopen.call_args.args[0]
    assert req.method == "DELETE"
    assert req.full_url == "https://vibeshub.ai/api/traces/abc1234567"


def test_delete_by_short_id_failure_status(capsys):
    import asyncio

    mod = _load_share_trace()
    with patch("vibeshub_client.gh_token.get_gh_token", return_value="tok"), \
         patch("urllib.request.urlopen",
               side_effect=_http_error(403, "forbidden")):
        asyncio.run(mod._delete_by_short_id("abc1234567", "https://vibeshub.ai"))
    err = capsys.readouterr().err
    assert "delete failed: 403" in err
    assert "forbidden" in err


# --- _delete_by_pr ---


def test_delete_by_pr_no_traces_found(capsys):
    import asyncio

    mod = _load_share_trace()
    pr_url = "https://github.com/alice/repo/pull/7"
    with patch("urllib.request.urlopen",
               return_value=_fake_http_response(
                   200, json.dumps({"traces": []}))):
        asyncio.run(mod._delete_by_pr(pr_url, "https://vibeshub.ai"))
    assert "no traces found for that PR" in capsys.readouterr().err


def test_delete_by_pr_404_reports_no_traces(capsys):
    import asyncio

    mod = _load_share_trace()
    pr_url = "https://github.com/alice/repo/pull/7"
    with patch("urllib.request.urlopen", side_effect=_http_error(404)):
        asyncio.run(mod._delete_by_pr(pr_url, "https://vibeshub.ai"))
    assert "no traces found for that PR" in capsys.readouterr().err


def test_delete_by_pr_happy_path(capsys):
    import asyncio

    mod = _load_share_trace()
    pr_url = "https://github.com/alice/repo/pull/7"

    list_resp = _fake_http_response(
        200, json.dumps({"traces": [{"short_id": "abc1234567"}]})
    )
    delete_resp = _fake_http_response(204, "")

    def fake_urlopen(req_or_url, *args, **kwargs):
        # First call is the GET list (a str URL), second is the DELETE.
        if isinstance(req_or_url, str):
            assert req_or_url == (
                "https://vibeshub.ai/api/traces/alice/repo/pull/7"
            )
            return list_resp
        assert req_or_url.method == "DELETE"
        return delete_resp

    with patch("vibeshub_client.gh_token.get_gh_token", return_value="tok"), \
         patch("urllib.request.urlopen", side_effect=fake_urlopen):
        asyncio.run(mod._delete_by_pr(pr_url, "https://vibeshub.ai"))
    assert "deleted trace abc1234567" in capsys.readouterr().out


# --- digit-only routing in main() ---


def test_main_delete_digit_routes_through_pr_path():
    mod = _load_share_trace()
    with patch.object(sys, "argv", ["share-trace", "delete", "42"]), \
         patch.object(mod, "resolve_pr_url",
                      return_value="https://github.com/a/r/pull/42") as rpr, \
         patch.object(mod, "_delete_by_pr") as by_pr, \
         patch.object(mod, "_delete_by_short_id") as by_short, \
         patch.object(mod, "_delete_short_id") as short_id, \
         patch.object(mod.asyncio, "run", lambda coro: coro.close()):
        mod.main()
    rpr.assert_called_once_with("42")
    by_pr.assert_called_once()
    assert by_pr.call_args.args[0] == "https://github.com/a/r/pull/42"
    by_short.assert_not_called()
    short_id.assert_not_called()


def test_main_delete_bare_token_routes_through_short_id_path():
    mod = _load_share_trace()
    with patch.object(sys, "argv", ["share-trace", "delete", "abc1234567"]), \
         patch.object(mod, "_delete_by_pr") as by_pr, \
         patch.object(mod, "_delete_by_short_id") as by_short, \
         patch.object(mod.asyncio, "run", lambda coro: coro.close()):
        mod.main()
    by_short.assert_called_once()
    assert by_short.call_args.args[0] == "abc1234567"
    by_pr.assert_not_called()


def test_share_trace_uses_select_adapter():
    src = _SHARE_TRACE_PATH.read_text()
    assert "select_adapter" in src
    assert "ClaudeCodeTranscriptReader()" not in src  # no longer constructed directly
