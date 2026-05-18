import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.auth.crypto import TokenCipher


def test_round_trip():
    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key)
    plaintext = "gho_abcdef1234567890"
    ct = cipher.encrypt(plaintext)
    assert ct != plaintext
    assert cipher.decrypt(ct) == plaintext


def test_tampered_ciphertext_raises():
    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key)
    ct = cipher.encrypt("hello")
    bad = ct[:-2] + ("AA" if ct[-2:] != "AA" else "BB")
    with pytest.raises(InvalidToken):
        cipher.decrypt(bad)


def test_rotation_decrypts_old_writes_new():
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()

    old_only = TokenCipher(old_key)
    rotating = TokenCipher(f"{new_key},{old_key}")

    ct_old = old_only.encrypt("legacy")
    # Rotating cipher can decrypt old ciphertext
    assert rotating.decrypt(ct_old) == "legacy"
    # And writes new ciphertext with the first key
    ct_new = rotating.encrypt("fresh")
    assert TokenCipher(new_key).decrypt(ct_new) == "fresh"


def test_empty_key_raises_at_construction():
    with pytest.raises(ValueError):
        TokenCipher("")
