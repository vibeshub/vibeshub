import pytest
from pydantic import ValidationError

from app.agents.digest.schema import Chapter, Digest, strip_em_dashes


def test_digest_accepts_all_five_fields():
    d = Digest(
        ask="ask",
        decisions="decisions",
        files="files",
        tests="tests",
        dead_ends="dead",
        chapters=[],
    )
    assert d.ask == "ask"
    assert d.chapters == []


def test_digest_rejects_missing_field():
    with pytest.raises(ValidationError):
        Digest(  # type: ignore[call-arg]
            ask="ask",
            decisions="decisions",
            files="files",
            tests="tests",
            chapters=[],
        )


def test_digest_caps_chapters_at_10():
    chapters = [
        Chapter(anchor_uuid=f"uuid-{i}", title=f"t{i}", caption=f"c{i}")
        for i in range(11)
    ]
    with pytest.raises(ValidationError):
        Digest(
            ask="a", decisions="d", files="f", tests="t", dead_ends="e",
            chapters=chapters,
        )


def test_digest_caps_field_lengths():
    with pytest.raises(ValidationError):
        Digest(
            ask="x" * 201, decisions="d", files="f", tests="t", dead_ends="e",
            chapters=[],
        )


def test_chapter_caps_title_and_caption():
    with pytest.raises(ValidationError):
        Chapter(anchor_uuid="u", title="x" * 81, caption="c")
    with pytest.raises(ValidationError):
        Chapter(anchor_uuid="u", title="t", caption="x" * 161)


def test_strip_em_dashes_replaces_with_comma_between_words():
    assert strip_em_dashes("a — b") == "a, b"


def test_strip_em_dashes_handles_sentence_breaks():
    assert strip_em_dashes("one — two — three") == "one, two, three"


def test_strip_em_dashes_strips_unicode_em_dash_only():
    # ASCII hyphens are left alone
    assert strip_em_dashes("file-name foo-bar") == "file-name foo-bar"
