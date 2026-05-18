from __future__ import annotations

from cryptography.fernet import Fernet, MultiFernet


class TokenCipher:
    """Fernet-based at-rest encryption for OAuth access tokens.

    Pass a single key for normal use, or a comma-separated list of keys for
    rotation: writes use the first key; reads try keys in order. Each key
    must be a 44-char urlsafe-base64-encoded 32-byte value (the output of
    `cryptography.fernet.Fernet.generate_key()`).
    """

    def __init__(self, key_or_keys: str) -> None:
        if not key_or_keys:
            raise ValueError("token encryption key is required")
        keys = [k.strip() for k in key_or_keys.split(",") if k.strip()]
        if not keys:
            raise ValueError("token encryption key is required")
        fernets = [Fernet(k.encode()) for k in keys]
        self._cipher = MultiFernet(fernets) if len(fernets) > 1 else fernets[0]

    def encrypt(self, plaintext: str) -> str:
        return self._cipher.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._cipher.decrypt(ciphertext.encode()).decode()
