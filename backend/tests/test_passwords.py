import threading
import time
import unicodedata

import pytest

from app.accounts import passwords
from app.accounts.passwords import TooBusy, WeakPassword, hash_password, verify_password

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


@pytest.mark.parametrize("length", [10, 200])
def test_the_shortest_and_the_longest_allowed_passwords_are_accepted(length):
    password = "x" * length

    assert verify_password(password, hash_password(password)) is True


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
        # Tham số mà scrypt không nhận hoặc tốn thời gian vô lý.
        "scrypt$n=131072,r=0,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=131072,r=8,p=0$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=131072,r=8,p=64$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=1,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
        "scrypt$n=100000,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==",
    ],
)
def test_a_stored_hash_that_cannot_be_read_never_verifies_and_never_raises(encoded, monkeypatch):
    def no_hashing(*_args, **_kwargs):
        raise AssertionError("the server tried to hash with a stored value it should have refused")

    monkeypatch.setattr(passwords.hashlib, "scrypt", no_hashing)

    assert verify_password(GOOD, encoded) is False


@pytest.mark.parametrize("parameters", ["n=1048576,r=8,p=1", "n=131072,r=64,p=1", "n=524288,r=16,p=1"])
def test_a_stored_hash_asking_for_a_gigabyte_is_refused_without_trying(parameters, monkeypatch):
    # Tham số hợp lệ về hình thức nhưng đòi 1 GB bộ nhớ: một dòng bị sửa trong DB không được làm server cấp phát nó.
    def no_hashing(*_args, **_kwargs):
        raise AssertionError("the server tried to hash with these parameters")

    monkeypatch.setattr(passwords.hashlib, "scrypt", no_hashing)

    assert verify_password(GOOD, f"scrypt${parameters}$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==") is False


def test_a_stored_hash_with_twice_the_current_memory_cost_still_verifies():
    # Chỗ để nâng tham số về sau: gấp đôi mức hiện tại vẫn nằm trong trần.
    current = passwords.N
    passwords.N = 2**18
    try:
        encoded = hash_password(GOOD)
    finally:
        passwords.N = current

    assert encoded.startswith("scrypt$n=262144,")
    assert verify_password(GOOD, encoded) is True


def test_the_length_limits_apply_to_the_password_as_normalised_however_it_was_typed():
    # Chín ký tự với người gõ, nhưng dạng dấu rời có 13 code point: cả hai dạng đều phải bị coi là quá ngắn.
    composed = unicodedata.normalize("NFC", "mật khẩu1")
    decomposed = unicodedata.normalize("NFD", composed)
    assert (len(composed), len(decomposed)) == (9, 13)

    for typed in (composed, decomposed):
        with pytest.raises(WeakPassword):
            hash_password(typed)


def test_a_long_vietnamese_password_still_verifies_when_typed_with_separate_accents():
    # 200 ký tự là dài nhất được nhận; dạng dấu rời của nó dài gấp ba và vẫn phải đăng nhập được.
    composed = unicodedata.normalize("NFC", "ậ" * 200)
    decomposed = unicodedata.normalize("NFD", composed)
    assert len(decomposed) == 600

    assert verify_password(decomposed, hash_password(composed)) is True


def test_text_that_cannot_be_encoded_is_refused_instead_of_crashing():
    # Một nửa cặp thay thế (surrogate) lẻ không viết được thành UTF-8; JSON vẫn mang được nó tới server.
    broken = "\ud800" * 12

    with pytest.raises(WeakPassword):
        hash_password(broken)
    assert verify_password(broken, hash_password(GOOD)) is False


def test_only_a_few_hashes_run_at_once_and_the_overflow_is_turned_away(monkeypatch):
    # Mỗi lần băm cần khoảng 128 MB: không giới hạn thì một loạt request đăng nhập làm server hết bộ nhớ.
    active = 0
    most = 0
    lock = threading.Lock()

    def slow_scrypt(*_args, dklen, **_kwargs):
        nonlocal active, most
        with lock:
            active += 1
            most = max(most, active)
        time.sleep(0.2)
        with lock:
            active -= 1
        return b"k" * dklen

    encoded = hash_password(GOOD)
    monkeypatch.setattr(passwords.hashlib, "scrypt", slow_scrypt)
    outcomes = []

    def attempt():
        try:
            verify_password(GOOD, encoded)
            outcomes.append("done")
        except TooBusy:
            outcomes.append("busy")

    threads = [threading.Thread(target=attempt) for _ in range(30)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    waiting_room = passwords.CONCURRENT_HASHES + passwords.WAITING_HASHES
    assert most == passwords.CONCURRENT_HASHES
    assert outcomes.count("done") == waiting_room
    assert outcomes.count("busy") == 30 - waiting_room


def test_a_thread_that_has_left_its_slot_must_ask_for_one_again(monkeypatch):
    # Server dùng lại luồng cho request sau: luồng vừa xong một lần đăng nhập không được coi là còn giữ chỗ.
    monkeypatch.setattr(passwords, "_admitted", threading.BoundedSemaphore(1))
    monkeypatch.setattr(passwords, "_running", threading.BoundedSemaphore(1))
    with passwords.hashing_slot():
        pass
    entered, release = threading.Event(), threading.Event()

    def occupy():
        with passwords.hashing_slot():
            entered.set()
            release.wait(10)

    other = threading.Thread(target=occupy)
    other.start()
    try:
        assert entered.wait(5)
        with pytest.raises(TooBusy), passwords.hashing_slot():
            pass
    finally:
        release.set()
        other.join()


def test_a_slot_held_for_a_whole_login_counts_once_and_covers_the_hashing_inside_it(monkeypatch):
    # Đăng nhập giữ một chỗ từ trước khi chạm vào database tới sau khi commit; lần băm bên trong dùng chính
    # chỗ đó, không xin thêm chỗ thứ hai.
    monkeypatch.setattr(passwords, "N", 2**10)
    encoded = hash_password(GOOD)
    release = threading.Event()
    lock = threading.Lock()
    inside = 0
    outcomes = []

    def attempt():
        nonlocal inside
        try:
            with passwords.hashing_slot():
                with lock:
                    inside += 1
                release.wait(10)
                outcomes.append(verify_password(GOOD, encoded))
        except TooBusy:
            outcomes.append("busy")

    threads = [threading.Thread(target=attempt) for _ in range(30)]
    for thread in threads:
        thread.start()
    capacity = passwords.CONCURRENT_HASHES + passwords.WAITING_HASHES
    deadline = time.monotonic() + 5
    while outcomes.count("busy") < 30 - capacity and time.monotonic() < deadline:
        time.sleep(0.01)
    # Chờ thêm một nhịp: nếu trần số lần chạy không còn, mọi lần đã được nhận sẽ kịp vào trong.
    time.sleep(0.2)
    turned_away, running = outcomes.count("busy"), inside
    release.set()
    for thread in threads:
        thread.join()

    assert turned_away == 30 - capacity
    assert running == passwords.CONCURRENT_HASHES
    assert outcomes.count(True) == capacity and outcomes.count("busy") == 30 - capacity
