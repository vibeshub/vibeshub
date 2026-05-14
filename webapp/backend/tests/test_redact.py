from pathlib import Path

import pytest

from app.redact.patterns import redact_jsonl, RedactionReport


FIXTURES = Path(__file__).parent / "fixtures"


def test_redacts_aws_keys():
    line = b'{"x":"AKIAIOSFODNN7EXAMPLE"}\n'
    out, report = redact_jsonl(line)
    assert b"AKIAIOSFODNN7EXAMPLE" not in out
    assert b"[REDACTED:aws_access_key_id]" in out
    assert report.counts["aws_access_key_id"] == 1


def test_redacts_github_token():
    line = b'{"x":"ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n'
    out, report = redact_jsonl(line)
    assert b"ghp_aaaa" not in out
    assert report.counts["github_token"] == 1


def test_redacts_openai_key():
    line = b'{"x":"sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n'
    out, report = redact_jsonl(line)
    assert report.counts["openai_key"] == 1


def test_redacts_anthropic_key():
    line = b'{"x":"sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n'
    out, report = redact_jsonl(line)
    assert report.counts["anthropic_key"] == 1


def test_redacts_dotenv_style_assignment():
    line = b'{"x":"SECRET_TOKEN=abc123def456ghi789jkl012mno345pqr"}\n'
    out, report = redact_jsonl(line)
    assert b"abc123def456" not in out
    assert report.counts["env_assignment"] == 1


def test_no_redaction_for_clean_input():
    line = b'{"text":"hello world, no secrets here"}\n'
    out, report = redact_jsonl(line)
    assert out == line
    assert sum(report.counts.values()) == 0


def test_full_fixture_redaction():
    data = (FIXTURES / "secrets-session.jsonl").read_bytes()
    out, report = redact_jsonl(data)
    # All four named patterns hit at least once
    for cat in ("aws_access_key_id", "aws_secret_access_key",
                "github_token", "openai_key", "anthropic_key"):
        assert report.counts[cat] >= 1, cat
