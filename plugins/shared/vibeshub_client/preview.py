from __future__ import annotations


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


def has_interactive_tty() -> bool:
    """Return True if /dev/tty can be opened for interactive prompting.

    Claude Code's hook subprocesses (especially under the VSCode extension)
    typically have no controlling terminal, so this returns False there.
    Callers should branch on this rather than calling confirm_via_tty
    speculatively — the two failure modes (no tty vs. user said no) need
    to be distinguished.
    """
    try:
        with open("/dev/tty", "r+"):
            return True
    except OSError:
        return False


def confirm_via_tty(summary: str) -> bool:
    """Prompt y/N on /dev/tty. Caller must verify has_interactive_tty() first.

    Reads /dev/tty directly so it works even when stdin/stdout are piped
    (which they are when run as a Claude Code hook — stdin is the JSON
    payload). Returns False on any non-yes response.
    """
    with open("/dev/tty", "r+") as tty:
        tty.write(summary)
        tty.write("Upload to vibeshub? [y/N] ")
        tty.flush()
        response = tty.readline()
    return parse_yes_no(response)
