"""Chạy migration từ mã Python, dùng cho lệnh khởi tạo và cho test."""

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import settings

_ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def alembic_config(url: str | None = None) -> Config:
    config = Config(str(_ALEMBIC_INI))
    # Truyền qua `attributes` thay vì ghi vào file ini: URL không bị ConfigParser diễn giải ký tự %.
    config.attributes["url"] = url or settings.database_url
    return config


def upgrade(url: str | None = None, revision: str = "head") -> None:
    command.upgrade(alembic_config(url), revision)


def downgrade(url: str | None = None, revision: str = "base") -> None:
    command.downgrade(alembic_config(url), revision)
