"""Lệnh quản trị: `python -m app.cli <lệnh>`."""

import argparse

from app import schema
from app.db import SessionLocal
from app.geo.seed import seed_geo


def run_seed_geo() -> None:
    with SessionLocal.begin() as session:
        counts = seed_geo(session)
    print(f"Đã nạp {counts['units']} đơn vị và {counts['aliases']} tên thay thế.")


def init_db() -> None:
    """Đưa schema lên phiên bản mới nhất rồi nạp dữ liệu địa danh; chạy lại nhiều lần vẫn an toàn."""
    schema.upgrade()
    run_seed_geo()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Lệnh quản trị VietStrain")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-db", help="chạy migration rồi nạp dữ liệu địa danh").set_defaults(run=init_db)
    commands.add_parser("seed-geo", help="nạp hoặc cập nhật đơn vị hành chính và tên thay thế").set_defaults(
        run=run_seed_geo
    )
    args = parser.parse_args(argv)
    args.run()


if __name__ == "__main__":
    main()
