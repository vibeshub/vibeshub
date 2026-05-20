"""Tests for app.message_count.count_messages.

The reference is the frontend parser (buildSession): count one rendered
message per *last* content block of each assistant JSONL line, deduped on
(message id, block index, block type), keeping only text and tool_use.
"""
from app.message_count import count_messages


def _lines(*records: str) -> bytes:
    return ("\n".join(records) + "\n").encode("utf-8")


def test_empty_and_blank_input():
    assert count_messages(b"") == 0
    assert count_messages(b"\n  \n\n") == 0


def test_streamed_assistant_message_counts_each_appended_block():
    # One logical assistant message streamed over three lines: each line
    # carries the full content[] with one more block appended.
    jsonl = _lines(
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"}]}}',
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"},{"type":"thinking","thinking":"t"}]}}',
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"},{"type":"thinking","thinking":"t"},'
        '{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}',
    )
    # text block + tool_use block render; the thinking block does not.
    assert count_messages(jsonl) == 2


def test_only_last_block_of_each_line_is_counted():
    # A single line carrying multiple blocks counts once (the last block),
    # mirroring the parser's blockIdx = content.length - 1.
    jsonl = _lines(
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"},'
        '{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}',
    )
    assert count_messages(jsonl) == 1


def test_duplicate_final_line_is_deduped():
    line = (
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"}]}}'
    )
    assert count_messages(_lines(line, line)) == 1


def test_non_rendered_records_are_ignored():
    jsonl = _lines(
        '{"type":"user","message":{"content":"a question"}}',
        '{"type":"user","message":{"content":'
        '[{"type":"tool_result","tool_use_id":"t1"}]}}',
        '{"type":"system","subtype":"turn_duration","durationMs":5}',
        '{"type":"file-history-snapshot","snapshot":{}}',
        '{"type":"progress","data":{}}',
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"}]}}',
    )
    assert count_messages(jsonl) == 1


def test_thinking_only_message_is_not_counted():
    jsonl = _lines(
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"thinking","thinking":"hmm"}]}}',
    )
    assert count_messages(jsonl) == 0


def test_unparseable_and_malformed_lines_are_skipped():
    jsonl = _lines(
        "not json at all",
        '{"type":"assistant"}',
        '{"type":"assistant","message":{"id":"m1","content":[]}}',
        '{"type":"assistant","message":{"id":"m1","content":"a string"}}',
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"}]}}',
    )
    assert count_messages(jsonl) == 1


def test_distinct_messages_with_same_block_shape_each_count():
    # Different message ids -> distinct dedupe keys even with identical
    # block index and type.
    jsonl = _lines(
        '{"type":"assistant","message":{"id":"m1","content":'
        '[{"type":"text","text":"a"}]}}',
        '{"type":"assistant","message":{"id":"m2","content":'
        '[{"type":"text","text":"b"}]}}',
    )
    assert count_messages(jsonl) == 2
