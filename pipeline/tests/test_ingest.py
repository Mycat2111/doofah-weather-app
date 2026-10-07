"""The ECMWF job end to end, against a fake bucket and a fresh database (needs TEST_DATABASE_URL)."""

import asyncio

import numpy as np
import psycopg
import pytest
from conftest import BUCKET_URL, SMALL_N, FakeBucket, sample, utc

from doofah_pipeline import db, ecmwf, grid
from doofah_pipeline.openmeteo import Bucket, BucketError

pytestmark = pytest.mark.usefixtures("small_grid")

HOURS = [0, 1, 2, 3, 6, 9, 12]
BANGKOK = (13.7563, 100.5018)


def ingest(url: str, fake: FakeBucket, **kwargs) -> ecmwf.Outcome:
    async def go():
        bucket = Bucket(url=BUCKET_URL, transport=fake.transport())
        try:
            with db.connect(url) as conn:
                return await ecmwf.ingest(conn, bucket, **kwargs)
        finally:
            await bucket.aclose()

    return asyncio.run(go())


def runs(url: str) -> list[tuple[str, str]]:
    with psycopg.connect(url) as conn:
        rows = conn.execute("select to_char(run_time at time zone 'UTC', 'HH24Z'), status::text from wx.runs order by run_time")
        return rows.fetchall()


def partitions(url: str) -> list[str]:
    with psycopg.connect(url) as conn:
        rows = conn.execute(
            "select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid "
            "where i.inhparent = 'wx.point_forecasts'::regclass order by 1"
        )
        return [r[0] for r in rows.fetchall()]


def test_loads_the_newest_run(database_url: str, fake_bucket: FakeBucket):
    valid_times = fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    outcome = ingest(database_url, fake_bucket)
    window = grid.window(SMALL_N, grid.Area(97, 5, 106, 21))
    assert outcome.status == "loaded"
    assert (outcome.points, outcome.steps) == (len(window), len(HOURS))
    assert runs(database_url) == [("00Z", "ready")]

    with psycopg.connect(database_url) as conn:
        run = conn.execute("select valid_times, period_minutes, published_at, details from wx.runs").fetchone()
        assert run[0] == valid_times
        assert run[1] == [0, 60, 60, 60, 180, 180, 180]
        assert run[2] == utc("2026-10-06T07:00")
        assert run[3]["points"] == len(window) and run[3]["requests"] > 0
        cells = conn.execute(
            "select p.grid_index, f.precip_mm, f.temp_c, f.wind_ms, f.wind_dir, f.cloud_pct "
            "from wx.point_forecasts f join wx.points p on p.id = f.point_id order by p.grid_index"
        ).fetchall()
    assert [c[0] for c in cells] == window.index.tolist()
    index, precip, temp, wind_ms, wind_dir, cloud = cells[0]
    steps = np.arange(len(HOURS))
    assert precip[0] is None
    assert precip[1:] == pytest.approx(sample(ecmwf.PRECIPITATION, np.array([index]), steps[1:], 0)[0], abs=0.06)
    assert temp == pytest.approx(sample(ecmwf.TEMPERATURE, np.array([index]), steps, 0)[0], abs=0.03)
    assert wind_ms == pytest.approx([5] * len(HOURS), abs=0.05)
    assert wind_dir == [217] * len(HOURS)
    assert cloud == sample(ecmwf.CLOUD, np.array([index]), steps, 0)[0].astype(int).tolist()


def test_point_forecast_answers_in_thai_time(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    ingest(database_url, fake_bucket)
    with psycopg.connect(database_url) as conn:
        assert conn.execute("show timezone").fetchone()[0] == "Asia/Bangkok"
        rows = conn.execute(
            "select run_time::text, valid_time::text, period_minutes, precip_mm, distance_km from wx.point_forecast(%s, %s)",
            BANGKOK,
        ).fetchall()
    assert len(rows) == len(HOURS)
    assert rows[0][:3] == ("2026-10-06 07:00:00+07", "2026-10-06 07:00:00+07", 0)
    assert rows[-1][1] == "2026-10-06 19:00:00+07"
    assert rows[0][3] is None and rows[1][3] is not None
    assert rows[0][4] < 300  # the O24 test grid is coarse; ECMWF's points are 9 km apart


def test_a_loaded_run_is_not_loaded_again(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    assert ingest(database_url, fake_bucket).status == "loaded"
    fake_bucket.requests.clear()
    again = ingest(database_url, fake_bucket)
    assert again.status == "up_to_date"
    assert [r.url.path for r in fake_bucket.requests] == [f"/data_run/{ecmwf.MODEL}/latest.json"]
    with psycopg.connect(database_url) as conn:
        assert conn.execute("select count(*) from wx.points").fetchone()[0] == ingest_points()


def ingest_points() -> int:
    return len(grid.window(SMALL_N, grid.Area(97, 5, 106, 21)))


def test_newer_runs_supersede_then_archive_older_ones(database_url: str, fake_bucket: FakeBucket):
    for run, hour in enumerate(["00", "06", "12"]):
        fake_bucket.add_run(utc(f"2026-10-06T{hour}:00"), HOURS, run=run)
        outcome = ingest(database_url, fake_bucket)
        assert outcome.status == "loaded"
    assert runs(database_url) == [("00Z", "archived"), ("06Z", "superseded"), ("12Z", "ready")]
    assert outcome.retired == [1]
    assert partitions(database_url) == ["point_forecasts_r2", "point_forecasts_r3"]
    with psycopg.connect(database_url) as conn:
        # Points are shared by every run, and the app sees the newest one.
        assert conn.execute("select count(*) from wx.points").fetchone()[0] == ingest_points()
        run_time, temp = conn.execute(
            "select run_time, temp_c from wx.point_forecast(%s, %s) limit 1", BANGKOK
        ).fetchone()
    assert run_time == utc("2026-10-06T12:00")
    assert temp == pytest.approx(27, abs=0.03)  # 25 + run 2


def test_an_older_run_loaded_late_does_not_replace_the_newest(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS, latest=False)
    fake_bucket.add_run(utc("2026-10-06T06:00"), HOURS, run=1)
    assert ingest(database_url, fake_bucket).status == "loaded"
    assert ingest(database_url, fake_bucket, run_time=utc("2026-10-06T00:00")).status == "loaded"
    assert runs(database_url) == [("00Z", "superseded"), ("06Z", "ready")]


def test_a_failed_run_keeps_the_previous_one_visible(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    ingest(database_url, fake_bucket)
    fake_bucket.add_run(utc("2026-10-06T06:00"), HOURS, run=1)
    (fake_bucket.root / f"data_run/{ecmwf.MODEL}/2026/10/06/0600Z/cloud_cover.om").write_bytes(b"not an om file")
    with pytest.raises(Exception):
        ingest(database_url, fake_bucket)
    assert runs(database_url) == [("00Z", "ready"), ("06Z", "failed")]
    with psycopg.connect(database_url) as conn:
        error = conn.execute("select details->>'error' from wx.runs where status = 'failed'").fetchone()[0]
        assert error
        assert conn.execute("select run_time from wx.point_forecast(%s, %s) limit 1", BANGKOK).fetchone()[0] == utc(
            "2026-10-06T00:00"
        )
    assert partitions(database_url) == ["point_forecasts_r1"]

    # Once the file is fixed, the next attempt loads the run over the failed row.
    fake_bucket.add_run(utc("2026-10-06T06:00"), HOURS, run=1)
    assert ingest(database_url, fake_bucket).status == "loaded"
    assert runs(database_url) == [("00Z", "superseded"), ("06Z", "ready")]


def test_a_run_still_being_written_waits(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS, short=ecmwf.TEMPERATURE)
    outcome = ingest(database_url, fake_bucket)
    assert outcome.status == "not_ready" and "temperature_2m" in outcome.note
    fake_bucket.add_run(utc("2026-10-06T06:00"), HOURS, variables=ecmwf.VARIABLES[:2])
    outcome = ingest(database_url, fake_bucket)
    assert outcome.status == "not_ready" and "cloud_cover" in outcome.note
    assert runs(database_url) == []


def test_only_one_copy_loads_at_a_time(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    with db.connect(database_url) as other, db.lock(other, f"{ecmwf.SOURCE}:{ecmwf.GRID}") as got:
        assert got
        assert ingest(database_url, fake_bucket).status == "busy"
    assert ingest(database_url, fake_bucket).status == "loaded"


def test_a_missing_run_is_an_error(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    with pytest.raises(BucketError, match="404"):
        ingest(database_url, fake_bucket, run_time=utc("2026-10-05T18:00"))
    assert runs(database_url) == []
