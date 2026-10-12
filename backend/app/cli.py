"""Lệnh quản trị: `python -m app.cli <lệnh>`."""

import argparse
import dataclasses
import json
import sys
from pathlib import Path

from sqlalchemy import select

from app import schema
from app.db import SessionLocal
from app.geo.seed import seed_geo
from app.jobs import queue
from app.models import Job, JobStep
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


def run_enqueue(args: argparse.Namespace) -> None:
    with SessionLocal.begin() as session:
        job = queue.enqueue(session, args.kind, json.loads(args.params), priority=args.priority)
        print(job.id)


def run_job(args: argparse.Namespace) -> None:
    """In một job cùng các bước của nó, để theo dõi từ dòng lệnh."""
    with SessionLocal() as session:
        job = session.get(Job, args.id)
        if job is None:
            sys.exit(f"Không có job {args.id}")
        steps = session.scalars(select(JobStep).filter_by(job_id=job.id).order_by(JobStep.position))
        report = {
            "id": job.id,
            "kind": job.kind,
            "status": job.status,
            "params": job.params,
            "result": job.result,
            "error": job.error,
            "worker": job.worker,
            "seconds": (job.finished_at - job.started_at).total_seconds() if job.finished_at else None,
            "steps": [{"name": step.name, "status": step.status, **step.metrics} for step in steps],
        }
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

    enqueue = commands.add_parser("enqueue", help="xếp một job vào hàng đợi, in ra mã job")
    enqueue.add_argument("kind", help="loại job, ví dụ tool_versions")
    enqueue.add_argument("--params", default="{}", help="tham số của job, dạng JSON")
    enqueue.add_argument("--priority", type=int, default=0)
    enqueue.set_defaults(run=run_enqueue)

    job = commands.add_parser("job", help="xem một job và các bước của nó (JSON)")
    job.add_argument("id", type=int)
    job.set_defaults(run=run_job)

    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
