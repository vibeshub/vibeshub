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


def test_aws_secret_pattern_does_not_eat_json_escapes():
    import json
    payload = {"x": "line1\n" + "a" * 39 + " tail"}
    line = json.dumps(payload).encode() + b"\n"
    out, report = redact_jsonl(line)
    assert json.loads(out) == payload


def test_redacts_additional_token_formats():
    secrets = {
        "github_pat": "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef",
        "openai_key": "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP",
        "slack_token": "xoxb-" + "1" * 12 + "-" + "2" * 13 + "-" + "x" * 24,
    }
    for category, secret in secrets.items():
        line = ('{"x":"see https://' + secret + '@github.com/a/b ok"}\n').encode()
        out, report = redact_jsonl(line)
        assert secret.encode() not in out, category
        assert report.counts.get(category) == 1, category


def test_redacts_pem_private_key_block():
    import json
    pem = ("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz\nabc\n"
           "-----END RSA PRIVATE KEY-----\n")
    line = json.dumps({"x": "cat id_rsa\n" + pem}).encode() + b"\n"
    out, report = redact_jsonl(line)
    assert b"MIIEowIBAAKCAQEAxyz" not in out
    assert report.counts["private_key"] == 1
    assert json.loads(out)
