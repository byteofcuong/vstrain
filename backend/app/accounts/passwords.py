"""Băm và kiểm tra mật khẩu bằng scrypt của thư viện chuẩn (lý do chọn scrypt: ADR-008).

Chuỗi lưu trong DB tự mô tả: `scrypt$n=131072,r=8,p=1$<muối>$<khoá>`, muối và khoá viết bằng base64. Tham số nằm
trong chuỗi nên nâng tham số sau này không làm hỏng mật khẩu đã lưu.
"""

import base64
import binascii
import hashlib
import hmac
import secrets
import threading
import unicodedata

# Mức tối thiểu OWASP khuyến nghị cho scrypt: khoảng 128 MB bộ nhớ, 0,3 giây trên máy phát triển.
N = 2**17
R = 8
P = 1
KEY_BYTES = 32
SALT_BYTES = 16

# Độ dài tính trên mật khẩu đã chuẩn hoá, để một mật khẩu được nhận hay không không phụ thuộc bộ gõ.
MIN_LENGTH = 10
MAX_LENGTH = 200
# Trần cho chuỗi chưa chuẩn hoá: dạng dấu rời của tiếng Việt dài gấp tới ba lần dạng dựng sẵn. Dài hơn thế thì
# không chuẩn hoá và không băm, để không ai bắt server làm việc với một chuỗi vài megabyte.
RAW_LIMIT = 4 * MAX_LENGTH

# Trần cho tham số đọc từ chuỗi đã lưu: một dòng bị sửa trong DB không được bắt server cấp phát hàng gigabyte.
_MAX_N = 2**20
_MAX_R = 16
_MAX_P = 4

# Mỗi lần băm giữ khoảng 128 MB. Đăng nhập không cần quyền gì, nên số lần băm chạy cùng lúc phải có trần:
# nhiều nhất bấy nhiêu lần chạy, bấy nhiêu lần chờ, phần còn lại bị từ chối ngay thay vì giữ luồng của server.
CONCURRENT_HASHES = 4
WAITING_HASHES = 8
_running = threading.BoundedSemaphore(CONCURRENT_HASHES)
_admitted = threading.BoundedSemaphore(CONCURRENT_HASHES + WAITING_HASHES)


class WeakPassword(ValueError):
    """Mật khẩu quá ngắn, quá dài, hoặc không phải văn bản hợp lệ."""


class TooBusy(RuntimeError):
    """Đang có quá nhiều lần băm; lần này không được nhận."""


def _normalized(password: str) -> tuple[int, bytes] | None:
    """Độ dài và dạng byte của mật khẩu đã chuẩn hoá; `None` nếu nó quá dài hoặc không viết được thành UTF-8.

    Chuẩn hoá NFKC: cùng một mật khẩu tiếng Việt gõ bằng hai bộ gõ (chữ dựng sẵn hoặc dấu rời) cho cùng kết quả.
    """
    if len(password) > RAW_LIMIT:
        return None
    text = unicodedata.normalize("NFKC", password)
    try:
        return len(text), text.encode("utf-8")
    except UnicodeEncodeError:
        return None


def _key(raw: bytes, salt: bytes, n: int, r: int, p: int, length: int) -> bytes:
    if not _admitted.acquire(blocking=False):
        raise TooBusy("Too many passwords are being checked")
    try:
        with _running:
            return hashlib.scrypt(raw, salt=salt, n=n, r=r, p=p, dklen=length, maxmem=128 * n * r * p + 2**20)
    finally:
        _admitted.release()


def _text(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    normalized = _normalized(password)
    if normalized is None or not MIN_LENGTH <= normalized[0] <= MAX_LENGTH:
        raise WeakPassword(f"Password must have between {MIN_LENGTH} and {MAX_LENGTH} characters")
    salt = secrets.token_bytes(SALT_BYTES)
    return f"scrypt$n={N},r={R},p={P}${_text(salt)}${_text(_key(normalized[1], salt, N, R, P, KEY_BYTES))}"


def verify_password(password: str, encoded: str) -> bool:
    """Mật khẩu có khớp chuỗi đã lưu không. Chuỗi không đọc được thì trả False chứ không ném lỗi.

    Ném `TooBusy` khi đang có quá nhiều lần băm.
    """
    normalized = _normalized(password)
    if normalized is None:
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
    return hmac.compare_digest(_key(normalized[1], salt, n, r, p, len(expected)), expected)
