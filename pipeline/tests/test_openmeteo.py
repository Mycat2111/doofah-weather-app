import asyncio

import httpx
import numpy as np
import pytest
from conftest import BUCKET_URL, SMALL_N, FakeBucket, sample, utc

from doofah_pipeline import ecmwf, grid
from doofah_pipeline.openmeteo import Bucket, BucketError, parse_meta, parse_time, run_folder

AREA = grid.Area(west=97, south=5, east=106, north=21)


def test_parse_meta():
    meta = parse_meta(
        "ecmwf_ifs",
        {
            "created_at": "2026-10-06T07:12:31Z",
            "reference_time": "2026-10-06T00:00Z",
            "valid_times": ["2026-10-06T00:00Z", "2026-10-06T01:00Z"],
            "variables": ["precipitation"],
        },
    )
    assert meta.reference_time == utc("2026-10-06T00:00")
    assert meta.valid_times[1] == utc("2026-10-06T01:00")
    assert meta.created_at == utc("2026-10-06T07:12:31")
    assert meta.folder == "data_run/ecmwf_ifs/2026/10/06/0000Z/"
    with pytest.raises(BucketError):
        parse_meta("ecmwf_ifs", {"reference_time": "2026-10-06T00:00Z"})


def test_times_without_a_zone_are_utc():
    assert parse_time("2026-10-06T06:00") == utc("2026-10-06T06:00")
    assert parse_time("2026-10-06T13:00+07:00") == utc("2026-10-06T06:00")
    assert run_folder("ecmwf_ifs", parse_time("2026-10-06T13:00+07:00")) == "data_run/ecmwf_ifs/2026/10/06/0600Z/"


def test_read_window_returns_the_areas_points(fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), [0, 1, 2, 3, 6])
    window = grid.window(SMALL_N, AREA)

    async def read():
        bucket = Bucket(url=BUCKET_URL, transport=fake_bucket.transport())
        try:
            meta = await bucket.latest(ecmwf.MODEL)
            return meta, await bucket.read_window(meta, ecmwf.TEMPERATURE, window), bucket.stats
        finally:
            await bucket.aclose()

    meta, (times, values), stats = asyncio.run(read())
    assert len(meta.valid_times) == 5
    assert list(times) == [int(t.timestamp()) for t in meta.valid_times]
    assert values.dtype == np.float32
    assert np.allclose(values, sample(ecmwf.TEMPERATURE, window.index, np.arange(5), 0), atol=0.03)
    assert stats.requests > 0 and stats.bytes > 0


def test_read_window_asks_for_whole_blocks_once(fake_bucket: FakeBucket):
    fake_bucket.add_run(utc("2026-10-06T00:00"), [0, 1, 2])
    window = grid.window(SMALL_N, grid.Area(west=0.1, south=-89, east=359.9, north=89))  # nearly every row

    async def read():
        bucket = Bucket(url=BUCKET_URL, transport=fake_bucket.transport(), block_size=1024)
        try:
            meta = await bucket.latest(ecmwf.MODEL)
            await bucket.read_window(meta, ecmwf.CLOUD, window)
        finally:
            await bucket.aclose()

    asyncio.run(read())
    ranges = [r.headers["range"] for r in fake_bucket.requests if "range" in r.headers]
    assert len(ranges) == len(set(ranges))  # no block fetched twice
    assert all(int(r.split("=")[1].split("-")[0]) % 1024 == 0 for r in ranges)


def test_requests_retry_server_errors_but_not_missing_files(fake_bucket: FakeBucket, monkeypatch):
    no_wait = asyncio.sleep
    monkeypatch.setattr(asyncio, "sleep", lambda _: no_wait(0))
    fake_bucket.add_run(utc("2026-10-06T00:00"), [0, 1])
    failures = iter([httpx.Response(503), httpx.Response(500)])
    fake_bucket.fail = lambda request: next(failures, None)

    async def latest():
        bucket = Bucket(url=BUCKET_URL, transport=fake_bucket.transport())
        try:
            return await bucket.latest(ecmwf.MODEL)
        finally:
            await bucket.aclose()

    assert asyncio.run(latest()).reference_time == utc("2026-10-06T00:00")
    assert len(fake_bucket.requests) == 3

    async def missing():
        bucket = Bucket(url=BUCKET_URL, transport=fake_bucket.transport())
        try:
            await bucket.run(ecmwf.MODEL, utc("2026-10-05T12:00"))
        finally:
            await bucket.aclose()

    fake_bucket.requests.clear()
    with pytest.raises(BucketError, match="404"):
        asyncio.run(missing())
    assert len(fake_bucket.requests) == 1
