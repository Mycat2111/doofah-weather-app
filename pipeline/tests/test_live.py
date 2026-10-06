"""Reads today's run from Open-Meteo's real bucket: WX_LIVE=1 pytest -m live."""

import asyncio
import os

import numpy as np
import pytest

from doofah_pipeline import ecmwf, grid
from doofah_pipeline.openmeteo import Bucket

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not os.environ.get("WX_LIVE"), reason="set WX_LIVE=1 to read Open-Meteo's bucket"),
]

BANGKOK_AREA = grid.Area(west=100.3, south=13.5, east=100.8, north=14.0)


def test_newest_ecmwf_run_reads_and_makes_sense():
    async def read():
        bucket = Bucket()
        try:
            meta = await bucket.latest(ecmwf.MODEL)
            values = await ecmwf.fetch(bucket, meta, grid.window(ecmwf.N, BANGKOK_AREA))
            return meta, values
        finally:
            await bucket.aclose()

    meta, values = asyncio.run(read())
    assert len(meta.valid_times) in (109, 145)  # 06/18Z runs reach +144 h, 00/12Z +360 h
    assert set(ecmwf.period_minutes(meta.valid_times)) <= {0, 60, 180, 360}
    temp = values[ecmwf.TEMPERATURE]
    assert temp.shape[1] == len(meta.valid_times)
    assert np.nanmin(temp) > 5 and np.nanmax(temp) < 45
    rain = values[ecmwf.PRECIPITATION]
    assert np.all(np.isnan(rain[:, 0])) and not np.any(np.isnan(rain[:, 1:]))
    assert np.nanmin(rain) > -0.1 and np.nanmax(rain) < 300
    assert np.nanmax(values[ecmwf.CLOUD]) <= 100.5
