import pytest

from vibeshub_client.share_trigger import classify_share_trigger


@pytest.mark.parametrize("command,expected", [
    ("gh pr create --fill", "create"),
    ("gh pr create", "create"),
    ("git push", "push"),
    ("git push origin HEAD", "push"),
    ("git add . && git push", "push"),
    ("gh pr edit --title x", "edit"),
    ("gh pr edit 5 --body y", "edit"),
    ("gh pr edit --add-label x && git push", "edit"),
    ("ls -la", None),
    ("git commit -m x", None),
    ("git status", None),
    ("", None),
])
def test_classify_share_trigger(command, expected):
    assert classify_share_trigger(command) == expected
