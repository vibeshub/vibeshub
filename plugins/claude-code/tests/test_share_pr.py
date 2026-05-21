import importlib.util
import os
from pathlib import Path
from unittest.mock import patch

_SHARE_PR_PATH = Path(__file__).resolve().parent.parent / "commands" / "share-pr.py"


def _load_share_pr():
    """share-pr.py has a hyphen so it can't be imported normally; load it by
    path. Module-load has no side effects (only defs + an __main__ guard)."""
    spec = importlib.util.spec_from_file_location("share_pr_cmd", _SHARE_PR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_session_id_prefers_claude_code_session_id():
    mod = _load_share_pr()
    with patch.dict(
        os.environ,
        {"CLAUDE_CODE_SESSION_ID": "from-cc", "CLAUDE_SESSION_ID": "legacy"},
        clear=True,
    ):
        assert mod._session_id() == "from-cc"


def test_session_id_falls_back_to_legacy_var():
    mod = _load_share_pr()
    with patch.dict(os.environ, {"CLAUDE_SESSION_ID": "legacy"}, clear=True):
        assert mod._session_id() == "legacy"


def test_session_id_is_none_when_unset():
    mod = _load_share_pr()
    with patch.dict(os.environ, {}, clear=True):
        assert mod._session_id() is None
