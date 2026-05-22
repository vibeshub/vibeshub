import importlib.util
import os
from pathlib import Path
from unittest.mock import patch

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
    assert mod._delete_short_id("abc1234567", "https://vibeshub.ai") == (
        "abc1234567"
    )


def test_delete_short_id_from_t_url():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://vibeshub.ai/t/abc1234567", "https://vibeshub.ai"
    ) == "abc1234567"


def test_delete_short_id_from_t_url_with_trailing_slash():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://vibeshub.ai/t/abc1234567/", "https://vibeshub.ai"
    ) == "abc1234567"


def test_delete_short_id_returns_none_for_pr_url():
    mod = _load_share_trace()
    assert mod._delete_short_id(
        "https://github.com/alice/repo/pull/3", "https://vibeshub.ai"
    ) is None


import subprocess


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
