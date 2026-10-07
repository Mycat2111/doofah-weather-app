"""What the app reads through Supabase's REST API: public.wx_point and public.wx_status (needs TEST_DATABASE_URL)."""

import asyncio
from collections.abc import Iterator

import psycopg
import pytest
from conftest import BUCKET_URL, FakeBucket, new_database, utc

from doofah_pipeline import db, ecmwf
from doofah_pipeline.openmeteo import Bucket

pytestmark = pytest.mark.usefixtures("small_grid")

HOURS = [0, 1, 2, 3, 6, 9, 12]
BANGKOK = (13.7563, 100.5018)
WX_POINT = "public.wx_point(double precision, double precision, text)"


def ingest(url: str, fake: FakeBucket) -> ecmwf.Outcome:
    async def go():
        bucket = Bucket(url=BUCKET_URL, transport=fake.transport())
        try:
            with db.connect(url) as conn:
                return await ecmwf.ingest(conn, bucket)
        finally:
            await bucket.aclose()

    return asyncio.run(go())


def one(url: str, query: str, params: tuple = ()):
    with psycopg.connect(url) as conn:
        return conn.execute(query, params).fetchone()[0]


def test_a_place_gets_the_newest_run_in_thai_time(database_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    fake_bucket.add_run(utc("2026-10-06T06:00"), HOURS, run=1)
    ingest(database_url, fake_bucket)
    point = one(database_url, "select public.wx_point(%s, %s)", BANGKOK)

    assert point["source"] == {
        "id": "ecmwf_hres",
        "label_en": "ECMWF IFS 9 km",
        "label_th": "ECMWF IFS 9 กม.",
        "licence": "CC BY 4.0",
        "attribution": "Forecast data by ECMWF (CC BY 4.0), via Open-Meteo",
    }
    assert point["run"]["time"] == "2026-10-06T13:00+07:00"
    assert point["run"]["ready_at"].endswith("+07:00") and point["run"]["grid_km"] == 9
    assert point["times"][0] == "2026-10-06T13:00+07:00" and point["times"][-1] == "2026-10-07T01:00+07:00"
    assert point["period_minutes"] == [0, 60, 60, 60, 180, 180, 180]
    for column in ("precip_mm", "temp_c", "wind_ms", "wind_dir", "cloud_pct"):
        assert len(point[column]) == len(HOURS), column
    assert point["precip_mm"][0] is None and all(v is not None for v in point["precip_mm"][1:])
    assert point["temp_c"][0] == pytest.approx(26, abs=0.03)  # 25 + run 1
    assert point["wind_dir"] == [217] * len(HOURS)
    assert 0 <= point["point"]["distance_km"] < 300  # the O24 test grid is coarse
    assert set(point["point"]) == {"lat", "lon", "distance_km"}


def test_no_forecast_outside_the_area_or_before_a_run(database_url: str, fake_bucket: FakeBucket):
    assert one(database_url, "select public.wx_point(%s, %s)", BANGKOK) is None
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    ingest(database_url, fake_bucket)
    assert one(database_url, "select public.wx_point(35.68, 139.69)") is None  # Tokyo
    assert one(database_url, "select public.wx_point(%s, %s, 'wrf')", BANGKOK) is None


def test_status_says_which_run_users_see_and_why_a_newer_one_failed(database_url: str, fake_bucket: FakeBucket):
    assert one(database_url, "select public.wx_status()") == [
        {"source": "ecmwf_hres", "ready": None, "newest": None}
    ]
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    ingest(database_url, fake_bucket)
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "insert into wx.runs (source, grid_id, run_time, status, details) "
            "select 'ecmwf_hres', id, %s, 'failed', '{\"error\": \"cloud_cover.om: not an om file\"}' "
            "from wx.grids where name = 'ecmwf_o1280'",
            (utc("2026-10-06T06:00"),),
        )
    [status] = one(database_url, "select public.wx_status()")
    assert status["ready"]["run_time"] == "2026-10-06T07:00+07:00"
    assert status["ready"]["steps"] == len(HOURS)
    assert status["newest"] == {
        "run_time": "2026-10-06T13:00+07:00",
        "status": "failed",
        "error": "cloud_cover.om: not an om file",
    }


# Supabase's roles, and the default it gives new functions in `public`: every role may call them.
SUPABASE_ROLES = """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
"""


@pytest.fixture
def supabase_url() -> Iterator[str]:
    yield from new_database(prepare=SUPABASE_ROLES)


def test_only_the_secret_key_may_read_the_store(supabase_url: str, fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), HOURS)
    ingest(supabase_url, fake_bucket)
    with psycopg.connect(supabase_url) as conn:
        for role, allowed in (("anon", False), ("authenticated", False), ("service_role", True)):
            for fn in (WX_POINT, "public.wx_status()"):
                assert conn.execute("select has_function_privilege(%s, %s, 'execute')", (role, fn)).fetchone()[0] is (
                    allowed
                ), (role, fn)
        conn.execute("set role service_role")
        point = conn.execute("select public.wx_point(%s, %s)", BANGKOK).fetchone()[0]
        assert point["run"]["time"] == "2026-10-06T07:00+07:00"
        assert conn.execute("select public.wx_status()").fetchone()[0][0]["ready"]["steps"] == len(HOURS)
        conn.execute("reset role")
        conn.execute("set role anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select public.wx_point(%s, %s)", BANGKOK)
