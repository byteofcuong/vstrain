import unicodedata

import pytest

from app.geo.normalize import place_key


@pytest.mark.parametrize(
    "name",
    [
        "Đắk Lắk",
        "Dak Lak",
        "DAKLAK",
        "dak-lak",
        "  Đắk   Lắk ",
        # Dạng tổ hợp (NFD): cùng chữ nhưng dấu là ký tự riêng, hay gặp ở dữ liệu chép từ macOS.
        unicodedata.normalize("NFD", "Đắk Lắk"),
    ],
)
def test_spellings_of_one_place_share_a_key(name):
    assert place_key(name) == "daklak"


@pytest.mark.parametrize(
    ("name", "key"),
    [
        ("Tỉnh Đắk Lắk", "daklak"),
        ("Tinh Dak Lak", "daklak"),
        ("TP. Hồ Chí Minh", "hochiminh"),
        ("Tp.Hồ Chí Minh", "hochiminh"),
        ("TP Ho Chi Minh", "hochiminh"),
        ("Thành phố Huế", "hue"),
        ("Thanh pho Hue", "hue"),
        ("Dak Lak Province", "daklak"),
        ("Ho Chi Minh City", "hochiminh"),
        ("Thành phố Hồ Chí Minh City", "hochiminh"),
    ],
)
def test_administrative_words_are_dropped(name, key):
    assert place_key(name) == key


@pytest.mark.parametrize(
    ("name", "key"),
    [
        # "Thanh" chỉ là từ hành chính khi đi cùng "phố".
        ("Thanh Hoa", "thanhhoa"),
        ("Thanh Hóa", "thanhhoa"),
        # "Tĩnh" ở cuối là tên riêng, không phải tiền tố "Tỉnh".
        ("Hà Tĩnh", "hatinh"),
        ("Tỉnh Hà Tĩnh", "hatinh"),
    ],
)
def test_real_name_parts_are_not_cut(name, key):
    assert place_key(name) == key


@pytest.mark.parametrize(("name", "key"), [("Thành phố", "thanhpho"), ("Tỉnh", "tinh"), ("City", "city")])
def test_a_name_made_only_of_administrative_words_is_kept(name, key):
    # Giữ lại để bản ghi được xếp vào "có chữ nhưng không khớp", không lẫn với "bỏ trống".
    assert place_key(name) == key


def test_old_and_new_tone_mark_placement_share_a_key():
    assert place_key("Khánh Hoà") == place_key("Khánh Hòa") == "khanhhoa"


@pytest.mark.parametrize("name", ["Bà Rịa - Vũng Tàu", "Bà Rịa–Vũng Tàu", "Ba Ria-Vung Tau", "BaRia VungTau"])
def test_separators_do_not_matter(name):
    assert place_key(name) == "bariavungtau"


@pytest.mark.parametrize("name", ["", "   ", "--", "?", None])
def test_empty_or_punctuation_only_gives_an_empty_key(name):
    assert place_key(name) == ""
