"""Mô hình dữ liệu. Mỗi lát cắt thêm bảng của nó, kèm một migration."""

import datetime as dt
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Tên ràng buộc cố định để migration gọi đúng tên khi sửa hoặc xoá.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UnitLevel(StrEnum):
    MACRO_REGION = "macro_region"  # miền: Bắc, Trung, Nam
    REGION = "region"  # vùng kinh tế - xã hội
    PROVINCE = "province"  # đơn vị cấp tỉnh


class AdminUnit(Base):
    """Đơn vị hành chính hoặc vùng, có hiệu lực theo thời gian.

    Nextstrain dùng tên làm khoá và không có khái niệm thời gian. Ở đây mỗi đơn vị có mã riêng; tỉnh của bộ 63
    hết hiệu lực ngày 2025-06-30 và trỏ tới đơn vị kế thừa trong bộ 34 (hiệu lực từ 2025-07-01).
    """

    __tablename__ = "admin_unit"
    __table_args__ = (
        CheckConstraint("level IN ('macro_region', 'region', 'province')", name="level_known"),
        CheckConstraint("(level = 'province') = (unit_set IS NOT NULL)", name="only_provinces_have_a_set"),
    )

    code: Mapped[str] = mapped_column(String(60), primary_key=True)  # mã nội bộ, ví dụ 'vn63:dak-lak'
    level: Mapped[str] = mapped_column(String(20))
    unit_set: Mapped[str | None] = mapped_column(String(10))  # 'vn63' | 'vn34'; vùng và miền không thuộc bộ nào
    name_vi: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))
    parent_code: Mapped[str | None] = mapped_column(ForeignKey("admin_unit.code"))  # tỉnh -> vùng -> miền
    successor_code: Mapped[str | None] = mapped_column(ForeignKey("admin_unit.code"))
    valid_from: Mapped[dt.date | None] = mapped_column(Date)
    valid_to: Mapped[dt.date | None] = mapped_column(Date)


class PlaceAlias(Base):
    """Một cách viết địa danh, đã chuẩn hoá thành khoá bằng `place_key`, trỏ tới đúng một đơn vị."""

    __tablename__ = "place_alias"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    unit_code: Mapped[str] = mapped_column(ForeignKey("admin_unit.code", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # 'name' | 'variant' | 'city'
    source: Mapped[str] = mapped_column(String(20))  # 'seed' | 'admin'
    example: Mapped[str] = mapped_column(String(200))  # một cách viết gốc của khoá, để người đọc hiểu khoá


class Sample(Base):
    """Một mẫu: bản ghi GenBank hoặc mẫu do phòng xét nghiệm nộp.

    Nextstrain không có bản ghi theo mẫu ở phía server; ở đây mỗi mẫu là một dòng truy vấn được.
    """

    __tablename__ = "sample"
    __table_args__ = (
        CheckConstraint(
            "geo_status IN ('province', 'region', 'missing', 'unresolved', 'foreign')", name="geo_status_known"
        ),
        CheckConstraint(
            "(date_min IS NULL) = (date_max IS NULL) AND (date_min IS NULL OR date_min <= date_max)",
            name="date_range_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Mã duy nhất mà pipeline được thấy: chỉ có chữ ASCII và số, không phụ thuộc tên do người dùng đặt.
    # Chữ S đứng đầu để công cụ không đọc nhầm thành số; quá bảy chữ số thì không đệm và không cắt.
    internal_id: Mapped[str] = mapped_column(
        String(20),
        Computed("'S' || CASE WHEN id < 10000000 THEN lpad(id::text, 7, '0') ELSE id::text END", persisted=True),
        unique=True,
    )
    display_name: Mapped[str] = mapped_column(String(300))  # tên hiển thị, không bao giờ đưa cho công cụ ngoài
    pathogen: Mapped[str] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(20))  # 'genbank' | 'submission'
    accession: Mapped[str | None] = mapped_column(String(40), unique=True)

    collection_date_raw: Mapped[str | None] = mapped_column(String(40))
    date_min: Mapped[dt.date | None] = mapped_column(Date)  # ngày không trọn vẹn được lưu thành khoảng
    date_max: Mapped[dt.date | None] = mapped_column(Date)

    country: Mapped[str | None] = mapped_column(String(100))
    division_raw: Mapped[str | None] = mapped_column(String(200))  # địa danh gốc, giữ nguyên văn
    location_raw: Mapped[str | None] = mapped_column(String(200))
    admin_unit_code: Mapped[str | None] = mapped_column(ForeignKey("admin_unit.code"), index=True)
    region_code: Mapped[str | None] = mapped_column(ForeignKey("admin_unit.code"), index=True)
    geo_status: Mapped[str] = mapped_column(String(20))

    host: Mapped[str | None] = mapped_column(String(100))
    meta: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))  # các trường gốc còn lại
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SampleSequence(Base):
    """Chuỗi nucleotide của một mẫu, tách bảng riêng để truy vấn metadata không phải đọc chuỗi."""

    __tablename__ = "sample_sequence"

    sample_id: Mapped[int] = mapped_column(ForeignKey("sample.id", ondelete="CASCADE"), primary_key=True)
    sequence: Mapped[str] = mapped_column(Text)
    length: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))  # để biết chuỗi có đổi không mà không phải so cả chuỗi


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class Job(Base):
    """Một việc chạy nền. Bảng này chính là hàng đợi: worker lấy dòng `queued` bằng FOR UPDATE SKIP LOCKED."""

    __tablename__ = "job"
    __table_args__ = (CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name="status_known"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    kind: Mapped[str] = mapped_column(String(40))  # tên handler trong worker
    params: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String(20), server_default=JobStatus.QUEUED.value, index=True)
    priority: Mapped[int] = mapped_column(Integer, server_default=text("0"))  # số lớn hơn được lấy trước
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    worker: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))  # worker báo còn sống
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class JobStep(Base):
    """Một bước của job, ghi ngay khi bắt đầu để giao diện thấy tiến độ khi job còn chạy."""

    __tablename__ = "job_step"
    __table_args__ = (UniqueConstraint("job_id", "position"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)  # thứ tự của bước trong job, từ 1
    name: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20))  # 'running' | 'succeeded' | 'failed'
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    metrics: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))  # thời gian, CPU, bộ nhớ
    log_tail: Mapped[str | None] = mapped_column(Text)
