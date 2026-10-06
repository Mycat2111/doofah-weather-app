"""python -m doofah_pipeline ingest ecmwf_hres [--run 2026-10-06T00Z] | status

Settings come from the environment:

    DATABASE_URL           Postgres with the wx schema; on Supabase, the session
                           pooler (port 5432) or the direct connection
    OPEN_METEO_BUCKET_URL  default https://openmeteo.s3.amazonaws.com
    HTTP_CONCURRENCY       parallel range requests, default 24
    KEEP_PREVIOUS_RUNS     superseded runs whose points are kept, default 1

The last line printed is a JSON summary. Exit codes: 0 loaded, already
loaded, not ready yet or another copy busy; 1 failed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict
from datetime import datetime

from . import db, ecmwf
from .openmeteo import DEFAULT_BUCKET, Bucket, parse_time

JOBS = {ecmwf.SOURCE: ecmwf}


def log(message: str) -> None:
    print(f"{datetime.now().astimezone():%H:%M:%S} {message}", file=sys.stderr, flush=True)


def run_time(text: str) -> datetime:
    """'2026-10-06T00Z', '2026-10-06T00:00Z' or any ISO time with a zone."""
    if len(text) == 14 and text.endswith("Z"):
        text = f"{text[:-1]}:00Z"
    return parse_time(text)


def setting(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        raise SystemExit(f"{name} is not set")
    return value


async def ingest(source: str, at: datetime | None) -> dict:
    bucket = Bucket(
        url=setting("OPEN_METEO_BUCKET_URL", DEFAULT_BUCKET), concurrency=int(setting("HTTP_CONCURRENCY", "24"))
    )
    try:
        with db.connect(setting("DATABASE_URL")) as conn:
            outcome = await JOBS[source].ingest(
                conn, bucket, run_time=at, keep_previous=int(setting("KEEP_PREVIOUS_RUNS", "1")), log=log
            )
    finally:
        await bucket.aclose()
    return asdict(outcome)


def status() -> list[dict]:
    with db.connect(setting("DATABASE_URL")) as conn:
        rows = db.latest_runs(conn)
    keys = ("source", "grid", "run_time", "status", "ready_at", "steps")
    return [dict(zip(keys, row)) for row in rows]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="doofah_pipeline", description="DooFah v2 forecast pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    load = commands.add_parser("ingest", help="load a model run into the wx schema")
    load.add_argument("source", choices=sorted(JOBS))
    load.add_argument("--run", type=run_time, help="the run's start in UTC, e.g. 2026-10-06T00Z (default: newest)")
    commands.add_parser("status", help="the newest run of each source")
    args = parser.parse_args(argv)

    try:
        if args.command == "ingest":
            result = asyncio.run(ingest(args.source, args.run))
            log(f"{result['status']}: {result['note'] or result['source']}")
        else:
            result = status()
    except Exception as error:  # the summary still goes out, for the scheduler's log
        log(f"failed: {type(error).__name__}: {error}")
        print(json.dumps({"status": "failed", "error": f"{type(error).__name__}: {error}"}))
        return 1
    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
