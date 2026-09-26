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


def test_aws_secret_pattern_does_not_eat_json_escapes():
    # 39 token chars right after a "\n" escape: the regex must not treat the
    # escape's "n" as the 40th char, or the line stops being valid JSON.
    import json
    payload = {"x": "line1\n" + "a" * 39 + " tail"}
    line = json.dumps(payload).encode() + b"\n"
    out, report = redact_jsonl(line)
    assert json.loads(out) == payload
    assert report.total() == 0


@pytest.mark.parametrize("category, secret", [
    ("github_pat", "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef"),
    ("openai_key", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP"),
    ("slack_token", "xoxb-" + "1" * 12 + "-" + "2" * 13 + "-" + "x" * 24),
])
def test_redacts_additional_token_formats(category, secret):
    line = ('{"x":"git clone https://' + secret + '@github.com/a/b"}\n').encode()
    out, report = redact_jsonl(line)
    assert secret.encode() not in out
    assert report.counts[category] == 1


def test_redacts_pem_private_key_block():
    import json
    pem = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEowIBAAKCAQEAxyz\nabc\n"
        "-----END RSA PRIVATE KEY-----\n"
    )
    line = json.dumps({"x": "cat id_rsa\n" + pem}).encode() + b"\n"
    out, report = redact_jsonl(line)
    assert b"MIIEowIBAAKCAQEAxyz" not in out
    assert report.counts["private_key"] == 1
    assert json.loads(out)  # still valid JSON
