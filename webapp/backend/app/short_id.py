import re
import secrets

_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"  # RFC 4648 base32, lowercase
_PATTERN = re.compile(r"^[a-z2-7]{10}$")


def generate() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(10))


def looks_like_short_id(value: str) -> bool:
    return bool(_PATTERN.fullmatch(value))
