import re

import pytest

from app.short_id import generate, looks_like_short_id


def test_generate_returns_10_char_lowercase_base32():
    sid = generate()
    assert re.fullmatch(r"[a-z2-7]{10}", sid), sid


def test_generate_is_unique_across_many_calls():
    seen = {generate() for _ in range(1000)}
    assert len(seen) == 1000


def test_looks_like_short_id():
    assert looks_like_short_id("abcdefghij")
    assert not looks_like_short_id("abc")
    assert not looks_like_short_id("ABCDEFGHIJ")
    assert not looks_like_short_id("0bcdefghij")  # 0 not in alphabet
