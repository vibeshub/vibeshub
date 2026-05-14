from __future__ import annotations

import os
import sys
from typing import IO


def format_summary(message_count: int, byte_size: int, redactions: dict[str, int]) -> str:
    if byte_size >= 1024:
        size_str = f"{byte_size // 1024} KB"
    else:
        size_str = f"{byte_size} bytes"
    redaction_str = ", ".join(
        f"{k}: {v}" for k, v in sorted(redactions.items()) if v
    ) or "none"
    return (
        f"vibeshub upload preview\n"
        f"  {message_count} messages, {byte_size} bytes ({size_str})\n"
        f"  redactions: {redaction_str}\n"
    )


def parse_yes_no(s: str) -> bool:
    return s.strip().lower() in ("y", "yes")


def confirm_via_tty(summary: str) -> bool:
    """
    Print summary and ask y/N on the controlling terminal. Reads /dev/tty
    directly so we work even when stdin/stdout are piped (which they are when
    run as a Claude Code hook — stdin is the JSON payload).

    Returns False if no tty is available (e.g., headless mode) or the user
    answers anything other than y/yes.

    Override: set VIBESHUB_AUTO_YES=1 to skip the prompt and assume yes.
    """
    if os.environ.get("VIBESHUB_AUTO_YES") == "1":
        return True
    try:
        with open("/dev/tty", "r+") as tty:
            tty.write(summary)
            tty.write("Upload to vibeshub? [y/N] ")
            tty.flush()
            response = tty.readline()
    except OSError:
        return False
    return parse_yes_no(response)
