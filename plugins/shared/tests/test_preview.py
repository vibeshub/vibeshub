import io

from vibeshub_client.preview import format_summary, parse_yes_no


def test_format_summary_includes_counts():
    summary = format_summary(
        message_count=12,
        byte_size=4_096,
        redactions={"aws_access_key_id": 1, "high_entropy_token": 2},
    )
    assert "12 messages" in summary
    assert "4096 bytes" in summary or "4 KB" in summary
    assert "aws_access_key_id" in summary
    assert "high_entropy_token" in summary


def test_parse_yes_no():
    assert parse_yes_no("y") is True
    assert parse_yes_no("Y") is True
    assert parse_yes_no("yes") is True
    assert parse_yes_no("") is False
    assert parse_yes_no("n") is False
    assert parse_yes_no("garbage") is False
