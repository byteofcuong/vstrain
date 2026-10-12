import unicodedata

import pytest

from app.accounts import passwords
from app.accounts.passwords import WeakPassword, hash_password, verify_password

GOOD = "correct horse battery"


def test_a_password_verifies_against_its_own_hash_and_no_other():
    encoded = hash_password(GOOD)

    assert verify_password(GOOD, encoded) is True
    assert verify_password(GOOD + "x", encoded) is False
    assert verify_password("", encoded) is False


def test_the_hash_names_its_parameters_and_does_not_contain_the_password():
    encoded = hash_password(GOOD)

    # Tham số nằm trong chuỗi, nên đổi tham số sau này không làm hỏng mật khẩu đã lưu.
    assert encoded.startswith("scrypt$n=131072,r=8,p=1$")
    assert len(encoded.split("$")) == 4
    assert GOOD not in encoded


def test_the_same_password_hashes_differently_each_time():
    first, second = hash_password(GOOD), hash_password(GOOD)

    assert first != second
    assert verify_password(GOOD, first) and verify_password(GOOD, second)


def test_a_vietnamese_password_matches_however_its_accents_were_typed():
    # Bộ gõ có thể cho chữ dựng sẵn (NFC) hoặc chữ cái cộng dấu rời (NFD); người dùng thấy cùng một chuỗi.
    composed = unicodedata.normalize("NFC", "mật khẩu của tôi")
    decomposed = unicodedata.normalize("NFD", composed)
    assert composed != decomposed

    assert verify_password(decomposed, hash_password(composed)) is True


@pytest.mark.parametrize("password", ["", "short", "123456789", "x" * 201])
def test_a_password_that_is_too_short_or_too_long_is_refused(password):
    with pytest.raises(WeakPassword):
        hash_password(password)


def test_an_overlong_password_is_rejected_without_being_hashed(monkeypatch):
    encoded = hash_password(GOOD)

    def no_hashing(*_args, **_kwargs):
        raise AssertionError("the password was hashed")

    # Không cho ai bắt server băm một chuỗi vài megabyte ở mỗi lần đăng nhập.
    monkeypatch.setattr(passwords.hashlib, "scrypt", no_hashing)
    assert verify_password("x" * 10_000_000, encoded) is False


def test_a_hash_made_by_another_scheme_does_not_verify():
    # Cùng muối, cùng khoá, nhưng ghi là của một thuật toán khác: không được coi là scrypt.
    encoded = hash_password(GOOD).replace("scrypt$", "pbkdf2$", 1)

    assert verify_password(GOOD, encoded) is False


@pytest.mark.parametrize(
    "encoded",
    [
        "",
        "plain text",
        "scrypt$n=131072,r=8,p=1$only-three-parts",
        "scrypt$n=131072,r=8,p=1$not base64!$also not",
        "argon2id$v=19$m=65536$c2FsdA$aGFzaA",
        # Tham số vô lý (1 GB bộ nhớ trở lên): từ chối chứ không thử.
        "scrypt$n=1073741824,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=131072,r=8000,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=0,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=abc,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
    ],
)
def test_a_stored_hash_that_cannot_be_read_never_verifies_and_never_raises(encoded):
    assert verify_password(GOOD, encoded) is False
