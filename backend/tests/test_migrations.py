import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

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


def test_the_status_of_samples_is_not_dropped_while_some_of_them_are_not_public():
    # Schema trước 0009 không có chỗ ghi "chưa công khai": bỏ cột `status` thì mẫu chưa kiểm tra, bị từ chối hay
    # bị ẩn đều hiện ra ở API công khai.
    name = f"{TEST_DATABASE}_downgrade"
    url = recreate_database(name)
    engine = create_engine(url)
    try:
        schema.upgrade(url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO sample (display_name, pathogen, source, status, geo_status) "
                    "VALUES ('x', 'dengue', 'submission', 'hidden', 'missing')"
                )
            )

        with pytest.raises(RuntimeError, match="1 sample"):
            schema.downgrade(url, "0008")
        assert "submission" in table_names(url)

        # Người vận hành đã quyết định: mẫu thành công khai. Mẫu công khai không cản việc lùi schema.
        with engine.begin() as connection:
            connection.execute(text("UPDATE sample SET status = 'accepted'"))
        schema.downgrade(url, "0008")
        assert "submission" not in table_names(url)
    finally:
        engine.dispose()
        drop_database(name)


def test_a_cancelled_job_becomes_a_failed_one_when_the_schema_goes_back_to_where_jobs_could_not_be_cancelled():
    name = f"{TEST_DATABASE}_cancelled"
    url = recreate_database(name)
    engine = create_engine(url)
    try:
        schema.upgrade(url)
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO job (kind, status) VALUES ('build_dataset', 'cancelled')"))
            connection.execute(
                text("INSERT INTO job (kind, status, error) VALUES ('tool_versions', 'failed', 'RuntimeError: x')")
            )

        schema.downgrade(url, "0010")

        with engine.begin() as connection:
            rows = connection.execute(text("SELECT kind, status, error FROM job ORDER BY id")).all()
            assert [tuple(row) for row in rows] == [
                ("build_dataset", "failed", "Cancelled by an administrator"),
                ("tool_versions", "failed", "RuntimeError: x"),
            ]
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(text("INSERT INTO job (kind, status) VALUES ('noop', 'cancelled')"))

        schema.upgrade(url)
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO job (kind, status) VALUES ('noop', 'cancelled')"))
    finally:
        engine.dispose()
        drop_database(name)


def test_models_match_the_migrated_schema(engine):
    # Nếu sửa model mà quên viết migration (hoặc ngược lại), danh sách khác biệt sẽ không rỗng.
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []
