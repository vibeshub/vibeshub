from __future__ import annotations

from app.auth.scopes import has_repo_scope
from app.storage.models import User


def test_has_repo_scope_true_when_repo_present():
    user = User(token_scopes="repo,read:user")
    assert has_repo_scope(user) is True


def test_has_repo_scope_false_when_repo_absent():
    user = User(token_scopes="read:user,user:email")
    assert has_repo_scope(user) is False


def test_has_repo_scope_false_when_scopes_empty():
    user = User(token_scopes="")
    assert has_repo_scope(user) is False
