"""Băm và kiểm tra mật khẩu bằng scrypt của thư viện chuẩn (lý do chọn scrypt: ADR-008).

Chuỗi lưu trong DB tự mô tả: `scrypt$n=131072,r=8,p=1$<muối>$<khoá>`, muối và khoá viết bằng base64. Tham số nằm
trong chuỗi nên nâng tham số sau này không làm hỏng mật khẩu đã lưu.
"""

import base64
import binascii
import hashlib
import hmac
import secrets
import unicodedata

# Mức tối thiểu OWASP khuyến nghị cho scrypt: khoảng 128 MB bộ nhớ, 0,3 giây trên máy phát triển.
N = 2**17
R = 8
P = 1
KEY_BYTES = 32
SALT_BYTES = 16

MIN_LENGTH = 10
# Chặn việc gửi một chuỗi vài megabyte để bắt server băm ở mỗi lần đăng nhập.
MAX_LENGTH = 200

# Trần cho tham số đọc từ chuỗi đã lưu: một dòng bị sửa trong DB không được bắt server cấp phát hàng gigabyte.
_MAX_N = 2**20
_MAX_R = 16
_MAX_P = 4


class WeakPassword(ValueError):
    """Mật khẩu quá ngắn hoặc quá dài để được nhận."""


def _key(password: str, salt: bytes, n: int, r: int, p: int, length: int) -> bytes:
    # Chuẩn hoá NFKC: cùng một mật khẩu tiếng Việt gõ bằng hai bộ gõ (chữ dựng sẵn hoặc dấu rời) phải cho cùng khoá.
    text = unicodedata.normalize("NFKC", password).encode("utf-8")
    return hashlib.scrypt(text, salt=salt, n=n, r=r, p=p, dklen=length, maxmem=128 * n * r * p + 2**20)


def _text(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    if not MIN_LENGTH <= len(password) <= MAX_LENGTH:
        raise WeakPassword(f"Password must have between {MIN_LENGTH} and {MAX_LENGTH} characters")
    salt = secrets.token_bytes(SALT_BYTES)
    return f"scrypt$n={N},r={R},p={P}${_text(salt)}${_text(_key(password, salt, N, R, P, KEY_BYTES))}"


def verify_password(password: str, encoded: str) -> bool:
    """Mật khẩu có khớp chuỗi đã lưu không. Chuỗi không đọc được thì trả False, không bao giờ ném lỗi."""
    if len(password) > MAX_LENGTH:
        return False
    try:
        scheme, parameters, salt_text, key_text = encoded.split("$")
        if scheme != "scrypt":
            return False
        values = dict(item.split("=") for item in parameters.split(","))
        n, r, p = int(values["n"]), int(values["r"]), int(values["p"])
        salt = base64.b64decode(salt_text, validate=True)
        expected = base64.b64decode(key_text, validate=True)
    except (ValueError, KeyError, binascii.Error):
        return False
    # n phải là luỹ thừa của 2 lớn hơn 1, như scrypt đòi hỏi.
    if not (1 < n <= _MAX_N and n & (n - 1) == 0 and 0 < r <= _MAX_R and 0 < p <= _MAX_P and expected):
        return False
    return hmac.compare_digest(_key(password, salt, n, r, p, len(expected)), expected)
