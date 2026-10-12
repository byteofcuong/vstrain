"""Chuẩn hoá tên địa danh thành khoá so khớp.

Nextstrain so khớp địa danh bằng chính chuỗi tên, nên "Daklak", "Dak Lak" và "Đắk Lắk" là ba nơi khác nhau.
Ở đây mọi cách viết của cùng một nơi được đưa về một khoá; bảng `place_alias` tra theo khoá đó.
"""

import unicodedata

# Từ chỉ cấp hành chính, so theo từng từ đã bỏ dấu. So theo từ (không so theo chuỗi con) để
# "Thanh Hoa" không bị coi là "Thanh pho" và "Ha Tinh" không bị coi là có tiền tố "Tinh".
_PREFIXES: tuple[tuple[str, ...], ...] = (("thanh", "pho"), ("tinh",), ("tp",))
_SUFFIXES: tuple[tuple[str, ...], ...] = (("province",), ("city",))


def strip_diacritics(text: str) -> str:
    """Bỏ dấu tiếng Việt. Chữ đ không tách được bằng NFD nên phải thay riêng."""
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def place_key(name: str | None) -> str:
    """Khoá so khớp của một tên địa danh; rỗng nếu tên không có chữ hay số nào."""
    if not name:
        return ""
    plain = strip_diacritics(name).lower()
    tokens = "".join(c if c.isalnum() else " " for c in plain).split()
    # Chỉ cắt khi còn lại ít nhất một từ: tên toàn từ hành chính vẫn phải cho khoá khác rỗng.
    for prefix in _PREFIXES:
        if len(tokens) > len(prefix) and tuple(tokens[: len(prefix)]) == prefix:
            tokens = tokens[len(prefix) :]
            break
    for suffix in _SUFFIXES:
        if len(tokens) > len(suffix) and tuple(tokens[-len(suffix) :]) == suffix:
            tokens = tokens[: -len(suffix)]
            break
    return "".join(tokens)
