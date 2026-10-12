"""Lệnh quản trị: `python -m app.cli <lệnh>`."""

import argparse
import dataclasses
import json
import sys
from pathlib import Path

from app import schema
from app.db import SessionLocal
from app.geo.seed import seed_geo
from app.samples.importer import import_genbank
from app.samples.report import geo_report


def run_seed_geo(_args: argparse.Namespace) -> None:
    with SessionLocal.begin() as session:
        counts = seed_geo(session)
    print(f"Đã nạp {counts['units']} đơn vị và {counts['aliases']} tên thay thế.")


def init_db(args: argparse.Namespace) -> None:
    """Đưa schema lên phiên bản mới nhất rồi nạp dữ liệu địa danh; chạy lại nhiều lần vẫn an toàn."""
    schema.upgrade()
    run_seed_geo(args)


def run_import_genbank(args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        report = import_genbank(session, args.metadata, args.sequences, pathogen=args.pathogen)
    json.dump(dataclasses.asdict(report), sys.stdout, ensure_ascii=False, indent=2)
    print()


def run_geo_report(_args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        report = geo_report(session)
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    print()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Lệnh quản trị VietStrain")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("init-db", help="chạy migration rồi nạp dữ liệu địa danh").set_defaults(run=init_db)
    commands.add_parser("seed-geo", help="nạp hoặc cập nhật đơn vị hành chính và tên thay thế").set_defaults(
        run=run_seed_geo
    )

    genbank = commands.add_parser("import-genbank", help="nhập bản ghi GenBank từ kết quả ingest của Nextstrain")
    genbank.add_argument("--metadata", type=Path, required=True, help="file metadata TSV")
    genbank.add_argument("--sequences", type=Path, required=True, help="file FASTA, tên chuỗi là accession")
    genbank.add_argument("--pathogen", default="dengue")
    genbank.set_defaults(run=run_import_genbank)

    commands.add_parser("geo-report", help="thống kê mức gán địa danh của mẫu Việt Nam (JSON)").set_defaults(
        run=run_geo_report
    )

    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
