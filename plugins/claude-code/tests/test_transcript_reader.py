from pathlib import Path

import pytest

from vibeshub_client.reader import TranscriptReader


def test_transcript_reader_is_abstract():
    with pytest.raises(TypeError):
        TranscriptReader()  # type: ignore[abstract]


def test_concrete_reader_must_implement_methods(tmp_path: Path):
    class Incomplete(TranscriptReader):
        pass

    with pytest.raises(TypeError):
        Incomplete()  # type: ignore[abstract]


def test_concrete_reader_with_methods_works(tmp_path: Path):
    fake = tmp_path / "session.jsonl"
    fake.write_text("{}\n")

    class Fake(TranscriptReader):
        def find_session(self, hook_input):
            return fake

        def platform_id(self):
            return "fake"

    reader = Fake()
    assert reader.platform_id() == "fake"
    assert reader.find_session({}) == fake
