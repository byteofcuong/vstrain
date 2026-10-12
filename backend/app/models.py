"""Mô hình dữ liệu. Mỗi lát cắt thêm bảng của nó, kèm một migration."""

import datetime as dt
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, ForeignKey, MetaData, String
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
