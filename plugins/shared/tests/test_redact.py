from vibeshub_client.redact import redact_jsonl


def test_redacts_aws_keys():
    out, report = redact_jsonl(b'{"x":"AKIAIOSFODNN7EXAMPLE"}\n')
    assert b"AKIAIOSFODNN7EXAMPLE" not in out
    assert report.counts["aws_access_key_id"] == 1


def test_redacts_anthropic_key():
    out, report = redact_jsonl(
        b'{"x":"sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n'
    )
    assert report.counts["anthropic_key"] == 1


def test_redacts_high_entropy_long_token():
    suspicious = "Zk9pZ2g1aFRYV2pNT0F5VG9KbXdiM3NjMUVjbHJZMnFKMnE0SE5lUDlsZw"  # 60 chars
    line = b'{"raw":"' + suspicious.encode() + b'"}\n'
    out, report = redact_jsonl(line)
    assert report.counts.get("high_entropy_token", 0) >= 1


def test_does_not_redact_short_alphanumerics():
    out, report = redact_jsonl(b'{"id":"deadbeef"}\n')
    assert out == b'{"id":"deadbeef"}\n'
    assert sum(report.counts.values()) == 0


def test_does_not_redact_natural_language():
    line = b'{"text":"the quick brown fox jumps over the lazy dog"}\n'
    out, report = redact_jsonl(line)
    assert out == line
    assert sum(report.counts.values()) == 0
