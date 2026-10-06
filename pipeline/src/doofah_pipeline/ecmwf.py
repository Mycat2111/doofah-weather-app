"""ECMWF IFS 9 km (HRES) from Open-Meteo's open data into wx.point_forecasts.

One job loads one run: the newest one Open-Meteo has finished, or a named
one. It reads five variables at the grid points inside wx.grids.extent
(Thailand: about 25,000 points, 109 or 145 steps), turns wind components into
speed and direction, and publishes the run in one transaction.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import psycopg

from . import db, grid
from .openmeteo import Bucket, RunMeta

MODEL = "ecmwf_ifs"  # Open-Meteo's name for the 9 km run
SOURCE = "ecmwf_hres"
GRID = "ecmwf_o1280"
N = 1280

PRECIPITATION = "precipitation"  # mm over the step before each time; none at the run's start
TEMPERATURE = "temperature_2m"  # °C
WIND_U = "wind_u_component_10m"  # m/s, towards the east
WIND_V = "wind_v_component_10m"  # m/s, towards the north
CLOUD = "cloud_cover"  # %
VARIABLES = (PRECIPITATION, TEMPERATURE, WIND_U, WIND_V, CLOUD)


class NotReady(Exception):
    """The run isn't complete on the bucket yet; the next attempt should find it."""


@dataclass(frozen=True)
class Outcome:
    status: str  # loaded, up_to_date, not_ready, busy
    source: str
    run_time: datetime | None = None
    run_id: int | None = None
    points: int = 0
    steps: int = 0
    seconds: float = 0.0
    retired: list[int] = field(default_factory=list)
    note: str = ""


def align(name: str, times: np.ndarray, values: np.ndarray, valid_times: tuple[datetime, ...]) -> np.ndarray:
    """A variable on the run's time axis, NaN where it has nothing (rain at the start).

    Every valid time after the first must be there; a shorter file means the
    run is still being written.
    """
    seconds = np.array([int(t.timestamp()) for t in valid_times], dtype=np.int64)
    position = {int(s): i for i, s in enumerate(seconds)}
    unknown = [int(t) for t in times if int(t) not in position]
    if unknown:
        first = datetime.fromtimestamp(unknown[0], timezone.utc)
        raise ValueError(f"{name}: {len(unknown)} times not in meta.json, the first {first:%Y-%m-%dT%H:%MZ}")
    missing = sorted(set(position) - {int(t) for t in times} - {int(seconds[0])})
    if missing:
        raise NotReady(f"{name}: {len(missing)} of {len(seconds)} steps not written yet")
    out = np.full((values.shape[0], len(seconds)), np.nan, dtype=np.float32)
    out[:, [position[int(t)] for t in times]] = values
    return out


def period_minutes(valid_times: tuple[datetime, ...]) -> list[int]:
    """How long the rain at each valid time fell for: 0 at the start, then 60, 180 or 360."""
    return [0] + [int((b - a).total_seconds() // 60) for a, b in zip(valid_times, valid_times[1:])]


def wind(u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Speed (m/s) and the direction it blows from (degrees, 0 = from the north)."""
    speed = np.hypot(u, v)
    direction = np.mod(270 - np.degrees(np.arctan2(v, u)), 360)
    direction = np.where(np.round(direction) >= 360, 0, direction)
    return speed, direction


async def fetch(bucket: Bucket, meta: RunMeta, window: grid.Window) -> dict[str, np.ndarray]:
    """The five variables at the window's points, each [points, valid times]."""
    missing = sorted(set(VARIABLES) - meta.variables)
    if missing:
        raise NotReady(f"{meta.folder} has no {', '.join(missing)} yet")
    reads = await asyncio.gather(*(bucket.read_window(meta, name, window) for name in VARIABLES))
    return {name: align(name, times, values, meta.valid_times) for name, (times, values) in zip(VARIABLES, reads)}


def columns(values: dict[str, np.ndarray]) -> list[db.Column]:
    speed, direction = wind(values[WIND_U], values[WIND_V])
    return [
        db.Column("precip_mm", np.maximum(values[PRECIPITATION], 0), 2),
        db.Column("temp_c", values[TEMPERATURE], 2),
        db.Column("wind_ms", speed, 2),
        db.Column("wind_dir", direction, None),
        db.Column("cloud_pct", np.clip(values[CLOUD], 0, 100), None),
    ]


async def ingest(
    conn: psycopg.Connection,
    bucket: Bucket,
    *,
    run_time: datetime | None = None,
    keep_previous: int = 1,
    log: Callable[[str], None] = lambda _: None,
) -> Outcome:
    """Loads `run_time`'s run, or the newest finished one, unless it's loaded already.

    The database calls block the event loop; nothing else runs meanwhile.
    """
    started = time.monotonic()
    target = db.grid(conn, GRID)
    with db.lock(conn, f"{SOURCE}:{GRID}") as got:
        if not got:
            return Outcome("busy", SOURCE, run_time, note="another copy of this job is loading")
        meta = await (bucket.run(MODEL, run_time) if run_time else bucket.latest(MODEL))
        status = db.run_status(conn, SOURCE, target.id, meta.reference_time)
        if status in db.DONE:
            return Outcome("up_to_date", SOURCE, meta.reference_time, note=f"run is {status}")
        log(f"{SOURCE} {meta.reference_time:%Y-%m-%d %H:%MZ}: {len(meta.valid_times)} steps, reading {meta.folder}")
        requests, size = bucket.stats.requests, bucket.stats.bytes
        try:
            window = grid.window(N, target.area)
            values = await fetch(bucket, meta, window)
            read_seconds = time.monotonic() - started
            log(f"read {len(window)} points in {read_seconds:.1f} s ({bucket.stats.bytes - size:,} bytes)")
            point_ids = db.ensure_points(conn, target.id, window)
            run_id = db.load_run(
                conn,
                source=SOURCE,
                grid_id=target.id,
                run_time=meta.reference_time,
                published_at=meta.created_at,
                valid_times=meta.valid_times,
                period_minutes=period_minutes(meta.valid_times),
                point_ids=point_ids,
                columns=columns(values),
                details={
                    "bucket": bucket.url,
                    "folder": meta.folder,
                    "variables": list(VARIABLES),
                    "points": len(window),
                    "requests": bucket.stats.requests - requests,
                    "bytes": bucket.stats.bytes - size,
                    "read_seconds": round(read_seconds, 1),
                },
            )
        except NotReady as error:
            return Outcome("not_ready", SOURCE, meta.reference_time, note=str(error))
        except Exception as error:
            try:
                db.record_failure(
                    conn,
                    source=SOURCE,
                    grid_id=target.id,
                    run_time=meta.reference_time,
                    published_at=meta.created_at,
                    error=f"{type(error).__name__}: {error}",
                )
            except psycopg.Error as failure:
                log(f"couldn't record the failure: {failure}")
            raise
        if run_id is None:  # finished by something that doesn't take the lock (a manual load)
            return Outcome("up_to_date", SOURCE, meta.reference_time, note="loaded meanwhile")
        retired = db.retire_old_runs(conn, SOURCE, target.id, keep_previous)
    return Outcome(
        "loaded",
        SOURCE,
        meta.reference_time,
        run_id=run_id,
        points=len(point_ids),
        steps=len(meta.valid_times),
        seconds=round(time.monotonic() - started, 1),
        retired=retired,
    )
