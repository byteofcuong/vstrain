"""Hàm tạo và xoá database dùng trong test."""

from sqlalchemy import create_engine, make_url, text

from app.config import settings

TEST_DATABASE = "vietstrain_test"


def database_url(name: str) -> str:
    return make_url(settings.database_url).set(database=name).render_as_string(hide_password=False)


def recreate_database(name: str) -> str:
    """Tạo lại một database trống và trả về URL của nó."""
    admin = create_engine(database_url("postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return database_url(name)


def drop_database(name: str) -> None:
    admin = create_engine(database_url("postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()
