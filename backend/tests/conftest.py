"""Fixture dùng chung.

Test chạy trên database riêng `vietstrain_test`. Tên database được đổi trong `settings` ngay khi pytest nạp
file này, trước khi `app.db` tạo engine, nên mã nào mở kết nối trong lúc test cũng không chạm database chính.
Vì vậy `app.db` và `app.main` chỉ được import bên trong fixture.
"""

import shutil
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from app import schema
from app.config import settings
from tests.support import TEST_DATABASE, database_url, recreate_database

settings.database_url = database_url(TEST_DATABASE)


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    """Database test được tạo mới và dựng schema bằng migration, một lần cho cả phiên test."""
    recreate_database(TEST_DATABASE)
    schema.upgrade(settings.database_url)
    from app.db import engine

    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    """Session nằm trong một transaction bao ngoài; mọi thay đổi bị huỷ khi test xong."""
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            yield session
        transaction.rollback()


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    """Client gọi API thật, dùng chung session (và transaction) với test."""
    from app.db import get_session
    from app.main import app

    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def committed(engine: Engine) -> Iterator[sessionmaker[Session]]:
    """Session thật, commit thật: cho test cần nhiều kết nối cùng lúc. Bảng hàng đợi được dọn sau khi chạy."""
    yield sessionmaker(bind=engine, expire_on_commit=False)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE job CASCADE"))


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Test đánh dấu `tools` cần Augur, Nextclade, IQ-TREE; chúng chỉ có trong image worker."""
    if shutil.which("augur") is not None:
        return
    skip = pytest.mark.skip(reason="cần công cụ sinh học: chạy trong image worker")
    for item in items:
        if "tools" in item.keywords:
            item.add_marker(skip)
