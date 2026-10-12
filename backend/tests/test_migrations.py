from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app import schema
from app.models import Base
from tests.support import TEST_DATABASE, drop_database, recreate_database


def table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_tests_run_on_the_test_database(session):
    assert session.execute(text("SELECT current_database()")).scalar_one() == TEST_DATABASE


def test_migrations_go_up_down_and_up_again():
    # Database riêng, vì downgrade xoá sạch bảng mà các test khác đang dùng.
    name = f"{TEST_DATABASE}_migrations"
    url = recreate_database(name)
    try:
        schema.upgrade(url)
        assert {"admin_unit", "place_alias"} <= table_names(url)

        schema.downgrade(url)
        assert table_names(url) <= {"alembic_version"}

        schema.upgrade(url)
        assert {"admin_unit", "place_alias"} <= table_names(url)
    finally:
        drop_database(name)


def test_models_match_the_migrated_schema(engine):
    # Nếu sửa model mà quên viết migration (hoặc ngược lại), danh sách khác biệt sẽ không rỗng.
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []
