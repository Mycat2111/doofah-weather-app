"""The `wx` schema (supabase/migrations/*_wx_schema.sql): grids, points and runs.

A run becomes visible in one transaction: its row turns `ready` together with
its own partition of wx.point_forecasts, so nobody ever reads half a run. The
previous ready run turns `superseded`; older ones lose their points and turn
`archived` (their run rows stay, for calibration).
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .grid import Area, Window

DONE = ("ready", "superseded", "archived")


@dataclass(frozen=True)
class Grid:
    id: int
    name: str
    area: Area


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=True, application_name="doofah-pipeline")


def grid(conn: psycopg.Connection, name: str) -> Grid:
    row = conn.execute(
        """select id, extensions.st_xmin(extent), extensions.st_ymin(extent),
                  extensions.st_xmax(extent), extensions.st_ymax(extent)
           from wx.grids where name = %s""",
        [name],
    ).fetchone()
    if row is None:
        raise LookupError(f"grid {name} is missing: apply supabase/migrations/20261006130000_wx_schema.sql")
    return Grid(id=row[0], name=name, area=Area(west=row[1], south=row[2], east=row[3], north=row[4]))


@contextmanager
def lock(conn: psycopg.Connection, name: str) -> Iterator[bool]:
    """A session lock so two copies of a job never load at once. Needs a session connection, not a
    transaction pooler (Supabase: the session pooler on port 5432, or the direct connection)."""
    key = f"wx:{name}"
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s))", [key]).fetchone()[0]
    try:
        yield got
    finally:
        if got and not conn.broken:
            conn.execute("select pg_advisory_unlock(hashtext(%s))", [key])


def run_status(conn: psycopg.Connection, source: str, grid_id: int, run_time: datetime) -> str | None:
    row = conn.execute(
        "select status::text from wx.runs where source = %s and grid_id = %s and run_time = %s",
        [source, grid_id, run_time],
    ).fetchone()
    return row[0] if row else None


def ensure_points(conn: psycopg.Connection, grid_id: int, window: Window) -> np.ndarray:
    """The wx.points ids of the window's grid points, in window order, adding the ones not there yet."""

    def known() -> dict[int, int]:
        rows = conn.execute(
            "select grid_index, id from wx.points where grid_id = %s and kind = 'cell' and grid_index = any(%s)",
            [grid_id, window.index.tolist()],
        ).fetchall()
        return dict(rows)

    ids = known()
    missing = [k for k, index in enumerate(window.index.tolist()) if index not in ids]
    if missing:
        with conn.transaction(), conn.cursor() as cur:
            with cur.copy("copy wx.points (kind, grid_id, grid_index, location) from stdin") as copy:
                for k in missing:
                    point = f"SRID=4326;POINT({window.lon[k]:.6f} {window.lat[k]:.6f})"
                    copy.write_row(("cell", grid_id, int(window.index[k]), point))
        ids = known()
    return np.array([ids[i] for i in window.index.tolist()], dtype=np.int64)


COPY_BATCH = 2000  # points formatted at a time, to keep memory flat


def array_literals(values: np.ndarray, digits: int | None) -> list[str]:
    """Each row of `values` as a Postgres array literal, like {1.5,NULL,2}.

    NaN (or infinity) becomes NULL; `digits` None means whole numbers. Formatting
    the text here is several times faster than psycopg adapting lists of floats.
    """
    missing = ~np.isfinite(values)
    if digits is None:
        rows, text = np.where(missing, 0, np.round(values)).astype(np.int64).tolist(), str
    else:
        rows, text = np.round(values.astype(np.float64), digits).tolist(), repr
    literals = []
    for row, gaps, any_gap in zip(rows, missing, missing.any(axis=1).tolist()):
        if any_gap:
            items = ("NULL" if gap else text(v) for v, gap in zip(row, gaps.tolist()))
        else:
            items = map(text, row)
        literals.append("{" + ",".join(items) + "}")
    return literals


@dataclass(frozen=True)
class Column:
    name: str
    values: np.ndarray  # [points, steps], NaN where there is nothing
    digits: int | None  # None: smallint


def load_run(
    conn: psycopg.Connection,
    *,
    source: str,
    grid_id: int,
    run_time: datetime,
    published_at: datetime | None,
    valid_times: Sequence[datetime],
    period_minutes: Sequence[int],
    point_ids: np.ndarray,
    columns: Sequence[Column],
    details: dict,
) -> int | None:
    """Loads a run and makes it the source's ready run, all or nothing. None if it was loaded already."""
    for column in columns:
        if column.values.shape != (len(point_ids), len(valid_times)):
            raise ValueError(f"{column.name}: shape {column.values.shape}, expected {(len(point_ids), len(valid_times))}")
    names = [c.name for c in columns]
    with conn.transaction():
        row = conn.execute(
            """insert into wx.runs (source, grid_id, run_time, published_at, status, valid_times, period_minutes, details)
               values (%s, %s, %s, %s, 'processing', %s, %s, %s)
               on conflict (source, grid_id, run_time) do update
                 set status = 'processing', published_at = excluded.published_at, ready_at = null,
                     valid_times = excluded.valid_times, period_minutes = excluded.period_minutes,
                     details = excluded.details
                 where wx.runs.status in ('fetching', 'processing', 'failed')
               returning id""",
            [source, grid_id, run_time, published_at, list(valid_times), list(period_minutes), Jsonb(details)],
        ).fetchone()
        if row is None:
            return None
        run_id = row[0]
        partition = sql.Identifier("wx", f"point_forecasts_r{run_id}")
        conn.execute(sql.SQL("drop table if exists {}").format(partition))
        conn.execute(
            sql.SQL("create table {} partition of wx.point_forecasts for values in ({})").format(
                partition, sql.Literal(run_id)
            )
        )
        statement = sql.SQL("copy {} (run_id, point_id, {}) from stdin").format(
            partition, sql.SQL(", ").join(map(sql.Identifier, names))
        )
        with conn.cursor() as cur, cur.copy(statement) as copy:
            for start in range(0, len(point_ids), COPY_BATCH):
                part = slice(start, start + COPY_BATCH)
                literals = [array_literals(c.values[part], c.digits) for c in columns]
                copy.write(
                    "".join(
                        f"{run_id}\t{point_id}\t" + "\t".join(arrays) + "\n"
                        for point_id, *arrays in zip(point_ids[part].tolist(), *literals)
                    )
                )
        conn.execute("update wx.runs set status = 'ready', ready_at = now() where id = %s", [run_id])
        # Only the newest ready run stays ready (an older run loaded late goes straight to superseded).
        conn.execute(
            """update wx.runs set status = 'superseded'
               where source = %s and grid_id = %s and status = 'ready'
                 and id <> (select id from wx.runs where source = %s and grid_id = %s and status = 'ready'
                            order by run_time desc limit 1)""",
            [source, grid_id, source, grid_id],
        )
    return run_id


def retire_old_runs(conn: psycopg.Connection, source: str, grid_id: int, keep_previous: int) -> list[int]:
    """Drops the points of superseded runs beyond the newest `keep_previous`, marking them archived."""
    ids = [
        r[0]
        for r in conn.execute(
            """select id from wx.runs where source = %s and grid_id = %s and status = 'superseded'
               order by run_time desc offset %s""",
            [source, grid_id, keep_previous],
        ).fetchall()
    ]
    for run_id in ids:
        with conn.transaction():
            conn.execute(sql.SQL("drop table if exists {}").format(sql.Identifier("wx", f"point_forecasts_r{run_id}")))
            conn.execute("update wx.runs set status = 'archived' where id = %s", [run_id])
    return ids


def record_failure(
    conn: psycopg.Connection, *, source: str, grid_id: int, run_time: datetime, published_at: datetime | None, error: str
) -> None:
    conn.execute(
        """insert into wx.runs (source, grid_id, run_time, published_at, status, details)
           values (%s, %s, %s, %s, 'failed', %s)
           on conflict (source, grid_id, run_time) do update
             set status = 'failed', details = wx.runs.details || excluded.details
             where wx.runs.status in ('fetching', 'processing', 'failed')""",
        [source, grid_id, run_time, published_at, Jsonb({"error": error[:2000]})],
    )


def latest_runs(conn: psycopg.Connection) -> list[tuple]:
    return conn.execute(
        """select distinct on (r.source, r.grid_id) r.source, g.name, r.run_time, r.status::text, r.ready_at,
                  cardinality(r.valid_times)
           from wx.runs r join wx.grids g on g.id = r.grid_id
           order by r.source, r.grid_id, r.run_time desc"""
    ).fetchall()
