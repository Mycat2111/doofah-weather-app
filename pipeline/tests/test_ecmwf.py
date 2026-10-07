import numpy as np
import pytest
from conftest import utc

from doofah_pipeline import ecmwf

VALID = (utc("2026-10-06T00:00"), utc("2026-10-06T01:00"), utc("2026-10-06T04:00"), utc("2026-10-06T10:00"))


def stamp(*indexes):
    return np.array([int(VALID[i].timestamp()) for i in indexes], dtype=np.int64)


def test_period_minutes_follow_the_steps():
    assert ecmwf.period_minutes(VALID) == [0, 60, 180, 360]


def test_align_leaves_the_start_empty_for_rain():
    values = np.array([[1, 2, 3]], dtype=np.float32)
    out = ecmwf.align("precipitation", stamp(1, 2, 3), values, VALID)
    assert np.isnan(out[0, 0])
    assert out[0, 1:].tolist() == [1, 2, 3]


def test_align_says_not_ready_when_steps_are_missing():
    with pytest.raises(ecmwf.NotReady, match="1 of 4"):
        ecmwf.align("temperature_2m", stamp(0, 1, 2), np.zeros((1, 3), np.float32), VALID)


def test_align_refuses_times_the_run_does_not_list():
    times = np.append(stamp(0, 1, 2, 3), int(utc("2026-10-07T00:00").timestamp()))
    with pytest.raises(ValueError, match="not in meta.json"):
        ecmwf.align("temperature_2m", times, np.zeros((1, 5), np.float32), VALID)


@pytest.mark.parametrize(
    ("u", "v", "speed", "direction"),
    [
        (0, -5, 5, 0),  # blowing south: a north wind
        (-5, 0, 5, 90),  # blowing west: from the east
        (0, 5, 5, 180),
        (5, 0, 5, 270),
        (3, 4, 5, 216.87),  # towards the north-east, from the south-west
        (0.001, -5, 5, 0),  # 359.99 rounds to north, not 360
    ],
)
def test_wind_speed_and_where_it_blows_from(u, v, speed, direction):
    s, d = ecmwf.wind(np.array([u], np.float32), np.array([v], np.float32))
    assert s[0] == pytest.approx(speed, abs=0.01)
    assert d[0] == pytest.approx(direction, abs=0.01)


def test_columns_clip_and_round():
    values = {
        ecmwf.PRECIPITATION: np.array([[np.nan, -0.04, 1.234]], np.float32),
        ecmwf.TEMPERATURE: np.array([[30.0, 30.05, 31]], np.float32),
        ecmwf.WIND_U: np.array([[3, 3, 3]], np.float32),
        ecmwf.WIND_V: np.array([[4, 4, 4]], np.float32),
        ecmwf.CLOUD: np.array([[-1, 50, 101]], np.float32),
    }
    by_name = {c.name: c for c in ecmwf.columns(values)}
    assert list(by_name) == ["precip_mm", "temp_c", "wind_ms", "wind_dir", "cloud_pct"]
    precip = by_name["precip_mm"].values[0]
    assert np.isnan(precip[0]) and precip[1] == 0
    assert by_name["cloud_pct"].values[0].tolist() == [0, 50, 100]
    assert by_name["wind_dir"].digits is None and by_name["cloud_pct"].digits is None
