import datetime as dt
import unicodedata

import pytest

from app.submissions.validate import (
    MAX_FASTA_CHARS,
    InvalidSubmission,
    SequenceLimits,
    check_submission,
    clean_collection_date,
    clean_host,
    clean_name,
    read_single_fasta,
)

TODAY = dt.date(2026, 10, 13)
LIMITS = SequenceLimits(min_length=20, max_length=40)
GENOME = "ACGT" * 6  # 24 nucleotide: nằm trong giới hạn của LIMITS


def problem(call, *args, **kwargs) -> tuple[str, str]:
    """Trường và mã của lỗi duy nhất mà lời gọi gây ra."""
    with pytest.raises(InvalidSubmission) as caught:
        call(*args, **kwargs)
    (only,) = caught.value.problems
    return only.field, only.code


# --- FASTA ---


def test_one_fasta_record_gives_its_sequence_in_upper_case_without_line_breaks():
    text = ">mau so 1 ghi chu\nacgtacgtacgt\nACGTACGTACGT\n"

    assert read_single_fasta(text, LIMITS) == GENOME


@pytest.mark.parametrize(
    "text",
    [
        "\ufeff>mau\r\n" + GENOME + "\r\n",  # file lưu từ Notepad của Windows: có BOM, xuống dòng CR LF
        "\n\n>mau\n" + GENOME,  # dòng trống ở đầu, không có xuống dòng ở cuối
        ">mau\n" + GENOME[:12] + " \n\t" + GENOME[12:] + "\n\n",  # khoảng trắng lẫn trong chuỗi
        ">mau\r" + GENOME + "\r",  # xuống dòng kiểu Mac cũ
    ],
)
def test_the_ways_real_files_differ_do_not_matter(text):
    assert read_single_fasta(text, LIMITS) == GENOME


def test_rna_letters_are_stored_as_dna():
    assert read_single_fasta(">mau\n" + "ACGU" * 6, LIMITS) == GENOME


def test_ambiguity_codes_are_nucleotides_too():
    sequence = "ACGT" * 5 + "RYKMSWBDHVN"

    assert read_single_fasta(f">mau\n{sequence}\n", LIMITS) == sequence


@pytest.mark.parametrize("text", ["", "   \n\n", GENOME, "mau\n" + GENOME, '{"fasta": 1}', "%PDF-1.7\n" + GENOME])
def test_text_that_does_not_start_with_a_header_line_is_not_fasta(text):
    assert problem(read_single_fasta, text, LIMITS) == ("fasta", "NOT_FASTA")


def test_a_file_with_two_records_is_refused():
    text = f">mot\n{GENOME}\n>hai\n{GENOME}\n"

    assert problem(read_single_fasta, text, LIMITS) == ("fasta", "MULTIPLE_SEQUENCES")


def test_a_header_with_nothing_under_it_is_refused():
    assert problem(read_single_fasta, ">mau\n\n", LIMITS) == ("fasta", "EMPTY_SEQUENCE")


@pytest.mark.parametrize("bad", ["-", "*", "X", "1", "é", ".", "?", ";", "\x00"])
def test_a_character_that_is_not_a_nucleotide_code_is_refused(bad):
    text = f">mau\n{GENOME[:10]}{bad}{GENOME[10:]}\n"

    assert problem(read_single_fasta, text, LIMITS) == ("fasta", "INVALID_CHARACTERS")


def test_the_message_names_the_bad_character_and_where_it_is_but_does_not_copy_the_file():
    text = ">mau\n" + GENOME[:10] + "!" + GENOME[10:] + "\n"

    with pytest.raises(InvalidSubmission) as caught:
        read_single_fasta(text, LIMITS)

    message = caught.value.problems[0].message
    assert "'!'" in message and "11" in message
    assert GENOME[:10] not in message


def test_a_second_header_hidden_inside_the_sequence_does_not_get_through():
    # Dấu ">" ở giữa dòng không mở bản ghi mới, nhưng cũng không phải mã nucleotide.
    text = f">mau\n{GENOME[:8]}>S0000001\n{GENOME[8:]}\n"

    assert problem(read_single_fasta, text, LIMITS) == ("fasta", "INVALID_CHARACTERS")


def test_a_sequence_outside_the_length_range_of_the_pathogen_is_refused():
    assert problem(read_single_fasta, ">mau\n" + "ACGT" * 4 + "ACG", LIMITS) == ("fasta", "SEQUENCE_TOO_SHORT")
    assert problem(read_single_fasta, ">mau\n" + "ACGT" * 10 + "A", LIMITS) == ("fasta", "SEQUENCE_TOO_LONG")
    # Đúng hai đầu của khoảng thì được nhận.
    assert len(read_single_fasta(">mau\n" + "ACGT" * 5, LIMITS)) == 20
    assert len(read_single_fasta(">mau\n" + "ACGT" * 10, LIMITS)) == 40


def test_a_sequence_that_is_mostly_unknown_is_refused():
    # Đủ dài, nhưng số vị trí đọc được (A, C, G, T) ít hơn mức tối thiểu để vào cây.
    text = ">mau\n" + "ACGT" * 4 + "ACG" + "N" * 10

    assert problem(read_single_fasta, text, LIMITS) == ("fasta", "TOO_FEW_KNOWN_BASES")
    assert read_single_fasta(">mau\n" + "ACGT" * 5 + "N" * 10, LIMITS).count("N") == 10


def test_a_file_over_the_size_limit_is_refused_before_it_is_read():
    text = ">mau\n" + "A" * MAX_FASTA_CHARS

    assert problem(read_single_fasta, text, SequenceLimits(1, 10**9)) == ("fasta", "FASTA_TOO_LARGE")


# --- Tên mẫu, vật chủ ---


def test_a_vietnamese_sample_name_is_kept_as_typed():
    assert clean_name("  Hà_Nội/01/2024 ") == "Hà_Nội/01/2024"


def test_a_name_typed_with_separate_accents_is_stored_in_one_form():
    composed = unicodedata.normalize("NFC", "Hà_Nội/01/2024")
    decomposed = unicodedata.normalize("NFD", composed)
    assert composed != decomposed

    assert clean_name(decomposed) == composed


@pytest.mark.parametrize(
    "name",
    [
        "",
        "   ",
        "hai\ndòng",
        "tab\tở giữa",
        "nul\x00",
        "chuông\x07",
        "đổi chiều‮chữ",  # ký tự đổi chiều chữ, dùng để giả mạo tên
        "ngắt dòng unicode",
        "x" * 301,
    ],
)
def test_a_name_that_is_empty_too_long_or_has_control_characters_is_refused(name):
    assert problem(clean_name, name) == ("displayName", "INVALID_NAME")


def test_a_name_of_exactly_300_characters_is_accepted():
    assert clean_name("ô" * 300) == "ô" * 300


def test_the_host_is_optional_and_cleaned_like_a_name():
    assert clean_host(None) is None
    assert clean_host("   ") is None
    assert clean_host(" Homo sapiens ") == "Homo sapiens"
    assert problem(clean_host, "Homo\nsapiens") == ("host", "INVALID_HOST")
    assert problem(clean_host, "h" * 101) == ("host", "INVALID_HOST")


# --- Ngày lấy mẫu ---


@pytest.mark.parametrize(
    ("typed", "stored", "first", "last"),
    [
        ("2024-01-15", "2024-01-15", dt.date(2024, 1, 15), dt.date(2024, 1, 15)),
        ("2024-02", "2024-02-XX", dt.date(2024, 2, 1), dt.date(2024, 2, 29)),
        ("2023", "2023-XX-XX", dt.date(2023, 1, 1), dt.date(2023, 12, 31)),
        (" 2024-01-15 ", "2024-01-15", dt.date(2024, 1, 15), dt.date(2024, 1, 15)),
    ],
)
def test_a_date_may_be_a_day_a_month_or_a_year(typed, stored, first, last):
    cleaned = clean_collection_date(typed, today=TODAY)

    assert (cleaned.raw, cleaned.first, cleaned.last) == (stored, first, last)


def test_a_date_today_is_accepted_and_tomorrow_is_not():
    assert clean_collection_date("2026-10-13", today=TODAY).first == TODAY
    assert problem(clean_collection_date, "2026-10-14", today=TODAY) == ("collectionDate", "DATE_IN_FUTURE")
    assert problem(clean_collection_date, "2026-11", today=TODAY) == ("collectionDate", "DATE_IN_FUTURE")
    assert problem(clean_collection_date, "2027", today=TODAY) == ("collectionDate", "DATE_IN_FUTURE")


def test_the_current_month_and_year_end_today_not_in_the_future():
    # "Tháng này" và "năm nay" chưa trôi qua hết: khoảng ngày dừng ở hôm nay.
    month = clean_collection_date("2026-10", today=TODAY)
    year = clean_collection_date("2026", today=TODAY)

    assert (month.raw, month.first, month.last) == ("2026-10-XX", dt.date(2026, 10, 1), TODAY)
    assert (year.raw, year.first, year.last) == ("2026-XX-XX", dt.date(2026, 1, 1), TODAY)


@pytest.mark.parametrize(
    "typed",
    [
        "",
        "hôm qua",
        "15/01/2024",
        "2024-13",
        "2024-02-30",
        "2024-1-5",
        "24-01-15",
        "2024-01-15T00:00",
        "1899",
        "0000-01-01",
    ],
)
def test_text_that_is_not_a_real_date_is_refused(typed):
    assert problem(clean_collection_date, typed, today=TODAY) == ("collectionDate", "INVALID_DATE")


def test_the_oldest_year_accepted_is_1900():
    assert clean_collection_date("1900", today=TODAY).first == dt.date(1900, 1, 1)


# --- Cả lần nộp ---


def test_a_good_submission_comes_back_cleaned():
    cleaned = check_submission(
        display_name=" Hà_Nội/01/2024 ",
        collection_date="2024-01",
        host="Homo sapiens",
        fasta=f">ten trong file\n{GENOME.lower()}\n",
        limits=LIMITS,
        today=TODAY,
    )

    assert cleaned.display_name == "Hà_Nội/01/2024"
    assert cleaned.date.raw == "2024-01-XX"
    assert cleaned.host == "Homo sapiens"
    assert cleaned.sequence == GENOME


def test_a_problem_in_the_optional_field_alone_still_stops_the_submission():
    assert problem(
        check_submission,
        display_name="Hà_Nội/01/2024",
        collection_date="2024-01",
        host="Homo\nsapiens",
        fasta=f">mau\n{GENOME}\n",
        limits=LIMITS,
        today=TODAY,
    ) == ("host", "INVALID_HOST")


def test_every_problem_is_reported_at_once_so_the_form_can_show_them_together():
    with pytest.raises(InvalidSubmission) as caught:
        check_submission(
            display_name="",
            collection_date="2030-01-01",
            host="a\nb",
            fasta="không phải fasta",
            limits=LIMITS,
            today=TODAY,
        )

    assert [(one.field, one.code) for one in caught.value.problems] == [
        ("displayName", "INVALID_NAME"),
        ("collectionDate", "DATE_IN_FUTURE"),
        ("host", "INVALID_HOST"),
        ("fasta", "NOT_FASTA"),
    ]
