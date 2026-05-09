from pathlib import Path

import pytest

from app.render.claude_code_log import render_jsonl_to_html


FIXTURES = Path(__file__).parent / "fixtures"


def test_render_returns_html_with_message_text():
    data = (FIXTURES / "sample-session.jsonl").read_bytes()
    html = render_jsonl_to_html(data)
    assert html.lstrip().startswith("<")
    assert "2 + 2" in html or "It's 4" in html
