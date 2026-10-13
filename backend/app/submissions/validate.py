"""Kiểm tra một lần nộp mẫu trước khi nó chạm vào database hay công cụ.

Mọi hàm ở đây thuần tuý: nhận văn bản, trả giá trị đã làm sạch hoặc ném `InvalidSubmission` kèm danh sách lỗi.
Mỗi lỗi có tên trường, một mã để giao diện dịch, và một câu tiếng Anh cho người phát triển. Câu đó không bao giờ
chép lại nội dung người dùng gửi lên, ngoài một ký tự sai.
"""

import calendar
import datetime as dt
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

# Một genome dengue khoảng 11 KB; 2 MB là rất rộng cho một bản ghi mà vẫn đủ nhỏ để đọc trọn vào bộ nhớ.
MAX_FASTA_CHARS = 2 * 1024 * 1024
MAX_NAME_LENGTH = 300
MAX_HOST_LENGTH = 100
OLDEST_YEAR = 1900

# Mã nucleotide của IUPAC. Dấu gạch (chỗ trống của một alignment) không được nhận: chuỗi nộp là chuỗi thô.
_NUCLEOTIDES = frozenset("ACGTRYKMSWBDHVN")
_KNOWN_BASES = "ACGT"
_DATE = re.compile(r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?")
# Ký tự điều khiển, ký tự định dạng vô hình (kể cả ký tự đổi chiều chữ), vùng dùng riêng, mã chưa gán, và hai
# ký tự ngắt dòng của Unicode.
_UNPRINTABLE_CATEGORIES = ("C", "Zl", "Zp")

T = TypeVar("T")


@dataclass(frozen=True)
class Problem:
    field: str
    code: str
    message: str


class InvalidSubmission(ValueError):
    def __init__(self, problems: list[Problem]) -> None:
        super().__init__("; ".join(f"{problem.field}: {problem.message}" for problem in problems))
        self.problems = problems


@dataclass(frozen=True)
class SequenceLimits:
    """Khoảng độ dài hợp lệ của một genome, lấy từ cấu hình pathogen."""

    min_length: int  # cũng là số A, C, G, T tối thiểu
    max_length: int


@dataclass(frozen=True)
class CollectionDate:
    raw: str  # dạng lưu, cùng quy ước với bản ghi GenBank: "2024-01-15", "2024-01-XX", "2024-XX-XX"
    first: dt.date
    last: dt.date


@dataclass(frozen=True)
class CleanMetadata:
    """Tên, ngày và vật chủ của một mẫu đã qua kiểm tra: thứ người nộp khai, và sửa được về sau."""

    display_name: str
    date: CollectionDate
    host: str | None


@dataclass(frozen=True)
class CleanSubmission:
    display_name: str
    date: CollectionDate
    host: str | None
    sequence: str


def _refuse(field: str, code: str, message: str) -> InvalidSubmission:
    return InvalidSubmission([Problem(field, code, message)])


def read_single_fasta(text: str, limits: SequenceLimits) -> str:
    """Chuỗi nucleotide của bản ghi duy nhất trong một file FASTA: viết hoa, liền một dòng, U đổi thành T.

    Tên trong dòng tiêu đề bị bỏ qua: tên mẫu đến từ form, và công cụ chỉ thấy mã nội bộ (ADR-003).
    """
    if len(text) > MAX_FASTA_CHARS:
        raise _refuse("fasta", "FASTA_TOO_LARGE", f"The file is larger than {MAX_FASTA_CHARS // (1024 * 1024)} MB")
    lines = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [line.strip() for line in lines]
    while lines and not lines[0]:
        lines.pop(0)
    if not lines or not lines[0].startswith(">"):
        raise _refuse("fasta", "NOT_FASTA", "The file does not start with a FASTA header line ('>')")
    if any(line.startswith(">") for line in lines[1:]):
        raise _refuse("fasta", "MULTIPLE_SEQUENCES", "The file holds more than one sequence; submit one at a time")

    sequence = "".join("".join(line.split()) for line in lines[1:]).upper().replace("U", "T")
    if not sequence:
        raise _refuse("fasta", "EMPTY_SEQUENCE", "There is no sequence under the header line")
    for position, character in enumerate(sequence, start=1):
        if character not in _NUCLEOTIDES:
            raise _refuse(
                "fasta",
                "INVALID_CHARACTERS",
                f"Character {character!r} at position {position} is not a nucleotide code",
            )
    if len(sequence) < limits.min_length:
        raise _refuse(
            "fasta",
            "SEQUENCE_TOO_SHORT",
            f"The sequence has {len(sequence)} nucleotides; at least {limits.min_length} are needed",
        )
    if len(sequence) > limits.max_length:
        raise _refuse(
            "fasta",
            "SEQUENCE_TOO_LONG",
            f"The sequence has {len(sequence)} nucleotides; at most {limits.max_length} are expected",
        )
    known = sum(sequence.count(base) for base in _KNOWN_BASES)
    if known < limits.min_length:
        raise _refuse(
            "fasta",
            "TOO_FEW_KNOWN_BASES",
            f"Only {known} positions are A, C, G or T; at least {limits.min_length} are needed",
        )
    return sequence


def _readable(text: str) -> bool:
    return not any(unicodedata.category(character).startswith(_UNPRINTABLE_CATEGORIES) for character in text)


def clean_name(raw: str) -> str:
    """Tên hiển thị của mẫu: giữ nguyên chữ người nộp gõ, ở dạng Unicode dựng sẵn (NFC), bỏ khoảng trắng hai đầu."""
    name = unicodedata.normalize("NFC", raw).strip()
    if not 0 < len(name) <= MAX_NAME_LENGTH or not _readable(name):
        raise _refuse(
            "displayName",
            "INVALID_NAME",
            f"The sample name must be 1 to {MAX_NAME_LENGTH} characters on one line, without control characters",
        )
    return name


def clean_host(raw: str | None) -> str | None:
    host = unicodedata.normalize("NFC", raw or "").strip()
    if not host:
        return None
    if len(host) > MAX_HOST_LENGTH or not _readable(host):
        raise _refuse(
            "host",
            "INVALID_HOST",
            f"The host must be at most {MAX_HOST_LENGTH} characters on one line, without control characters",
        )
    return host


def clean_collection_date(raw: str, *, today: dt.date) -> CollectionDate:
    """Ngày lấy mẫu ở mức người nộp biết: một ngày ("2024-01-15"), một tháng ("2024-01") hoặc một năm ("2024").

    Ngày không trọn vẹn thành một khoảng. Khoảng đó không vượt quá hôm nay: mẫu không thể được lấy ở tương lai.
    """
    match = _DATE.fullmatch(raw.strip())
    invalid = _refuse("collectionDate", "INVALID_DATE", "The collection date must be YYYY, YYYY-MM or YYYY-MM-DD")
    if match is None:
        raise invalid
    year, month, day = (int(part) if part else None for part in match.groups())
    if year < OLDEST_YEAR:
        raise invalid
    try:
        if month is None:
            first, last, stored = dt.date(year, 1, 1), dt.date(year, 12, 31), f"{year:04d}-XX-XX"
        elif day is None:
            first = dt.date(year, month, 1)
            last = first.replace(day=calendar.monthrange(year, month)[1])
            stored = f"{year:04d}-{month:02d}-XX"
        else:
            first = last = dt.date(year, month, day)
            stored = first.isoformat()
    except ValueError:
        raise invalid from None
    if first > today:
        raise _refuse("collectionDate", "DATE_IN_FUTURE", "The collection date is in the future")
    return CollectionDate(stored, first, min(last, today))


def check_metadata(*, display_name: str, collection_date: str, host: str | None, today: dt.date) -> CleanMetadata:
    """Kiểm tra tên, ngày và vật chủ, gom mọi lỗi lại. Dùng lúc nộp và lúc sửa, nên hai lúc cùng một quy tắc."""
    problems: list[Problem] = []

    def checked(check: Callable[[], T]) -> T | None:
        try:
            return check()
        except InvalidSubmission as error:
            problems.extend(error.problems)
            return None

    name = checked(lambda: clean_name(display_name))
    date = checked(lambda: clean_collection_date(collection_date, today=today))
    cleaned_host = checked(lambda: clean_host(host))
    if problems or name is None or date is None:
        raise InvalidSubmission(problems)
    return CleanMetadata(display_name=name, date=date, host=cleaned_host)


def check_submission(
    *, display_name: str, collection_date: str, host: str | None, fasta: str, limits: SequenceLimits, today: dt.date
) -> CleanSubmission:
    """Kiểm tra mọi trường và gom tất cả lỗi lại, để form báo một lượt thay vì từng lỗi một."""
    problems: list[Problem] = []
    metadata = sequence = None
    try:
        metadata = check_metadata(display_name=display_name, collection_date=collection_date, host=host, today=today)
    except InvalidSubmission as error:
        problems.extend(error.problems)
    try:
        sequence = read_single_fasta(fasta, limits)
    except InvalidSubmission as error:
        problems.extend(error.problems)
    if problems or metadata is None or sequence is None:
        raise InvalidSubmission(problems)
    return CleanSubmission(
        display_name=metadata.display_name, date=metadata.date, host=metadata.host, sequence=sequence
    )
