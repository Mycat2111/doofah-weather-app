"""Shared fixtures: a bucket laid out like Open-Meteo's, served from a folder, and a fresh database."""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import omfiles
import psycopg
import pytest
from psycopg import sql

from doofah_pipeline import ecmwf
from doofah_pipeline.grid import size

# The forecast store's migrations, in order: the schema, then what the app reads through.
MIGRATIONS = sorted((Path(__file__).resolve().parents[2] / "supabase" / "migrations").glob("*_wx_*.sql"))
BUCKET_URL = "https://bucket.test"
SMALL_N = 24  # an O24 grid: 3,168 points, a dozen of them inside the Thailand box


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def seconds(t: datetime) -> int:
    return int(t.timestamp())


def sample(variable: str, index: np.ndarray, step: np.ndarray, run: int) -> np.ndarray:
    """What the fake files hold for each global point index and step: easy to check, different per run."""
    i, s = np.meshgrid(index, step, indexing="ij")
    return {
        ecmwf.PRECIPITATION: (i % 5) * 0.5 + s * 0.1 + run,
        ecmwf.TEMPERATURE: 25 + s * 0.5 + run,
        ecmwf.WIND_U: np.full(i.shape, 3.0),
        ecmwf.WIND_V: np.full(i.shape, 4.0),
        ecmwf.CLOUD: (i * 7 + s) % 101.0,
    }[variable].astype(np.float32)


class FakeBucket:
    """Open-Meteo's data_run layout in a folder, served through httpx.MockTransport."""

    SCALE = {ecmwf.PRECIPITATION: 10, ecmwf.TEMPERATURE: 20, ecmwf.WIND_U: 20, ecmwf.WIND_V: 20, ecmwf.CLOUD: 1}

    def __init__(self, root: Path, n: int = SMALL_N):
        self.root = root
        self.n = n
        self.requests: list[httpx.Request] = []
        self.fail: Callable[[httpx.Request], httpx.Response | None] = lambda _: None

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        failed = self.fail(request)
        if failed is not None:
            return failed
        path = self.root / request.url.path.lstrip("/")
        if not path.is_file():
            return httpx.Response(404)
        data = path.read_bytes()
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-length": str(len(data))})
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers.get("range", ""))
        if match is None:
            return httpx.Response(200, content=data)
        start, end = int(match[1]), int(match[2])
        return httpx.Response(206, content=data[start : end + 1])

    def add_run(
        self,
        reference_time: datetime,
        hours: list[int],
        *,
        run: int = 0,
        variables: tuple[str, ...] = ecmwf.VARIABLES,
        short: str | None = None,
        latest: bool = True,
    ) -> list[datetime]:
        """Writes one run's files; `short` leaves that variable's last step out (a run still being written)."""
        folder = self.root / f"data_run/{ecmwf.MODEL}/{reference_time:%Y/%m/%d/%H%MZ}"
        folder.mkdir(parents=True, exist_ok=True)
        valid_times = [reference_time + timedelta(hours=h) for h in hours]
        index = np.arange(size(self.n))
        for variable in variables:
            steps = np.arange(len(hours))
            if variable == ecmwf.PRECIPITATION:
                steps = steps[1:]  # rain is a total over the step before, so there's none at the start
            if variable == short:
                steps = steps[:-1]
            values = sample(variable, index, steps, run)[None]
            times = np.array([seconds(valid_times[s]) for s in steps], dtype=np.int64)
            writer = omfiles.OmFileWriter(str(folder / f"{variable}.om"))
            time_variable = writer.write_array(times, chunks=[len(times)], name="time")
            root = writer.write_array(
                values,
                chunks=[1, 7, len(times)],
                scale_factor=self.SCALE[variable],
                compression="pfor_delta_2d_int16",
                name=variable,
                children=[time_variable],
            )
            writer.close(root)
        meta = {
            "created_at": f"{reference_time + timedelta(hours=7):%Y-%m-%dT%H:%M:%SZ}",
            "reference_time": f"{reference_time:%Y-%m-%dT%H:%MZ}",
            "temporal_resolution_seconds": 3600,
            "valid_times": [f"{t:%Y-%m-%dT%H:%MZ}" for t in valid_times],
            "variables": list(variables),
        }
        (folder / "meta.json").write_text(json.dumps(meta))
        if latest:
            (self.root / f"data_run/{ecmwf.MODEL}/latest.json").write_text(json.dumps(meta))
        return valid_times


@pytest.fixture
def fake_bucket(tmp_path: Path) -> FakeBucket:
    return FakeBucket(tmp_path / "bucket")


@pytest.fixture
def small_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    """Runs the ECMWF job on the O24 grid the fake bucket is written on."""
    monkeypatch.setattr(ecmwf, "N", SMALL_N)


def new_database(prepare: str | None = None) -> Iterator[str]:
    """A new database with the wx migrations applied (after `prepare`, if given), dropped afterwards.

    TEST_DATABASE_URL is a server where the user may create databases and
    PostGIS is installed, e.g. postgresql://postgres:postgres@localhost:5432/postgres.
    """
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL is not set")
    name = f"wx_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("create database {} encoding 'UTF8' template template0").format(sql.Identifier(name)))
    url = psycopg.conninfo.make_conninfo(admin_url, dbname=name)
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            if prepare:
                conn.execute(prepare)
            for migration in MIGRATIONS:
                conn.execute(migration.read_text())
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(sql.SQL("drop database if exists {} with (force)").format(sql.Identifier(name)))


@pytest.fixture
def database_url() -> Iterator[str]:
    """A new database with the wx migrations applied, dropped afterwards."""
    yield from new_database()
