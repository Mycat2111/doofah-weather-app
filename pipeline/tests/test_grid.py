import numpy as np
import pytest

from doofah_pipeline import grid

THAILAND = grid.Area(west=97, south=5, east=106, north=21)


def distance_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * np.arcsin(np.sqrt(a))


def test_o1280_has_ecmwfs_point_count():
    assert grid.size(1280) == 6_599_680
    lengths = grid.row_lengths(1280)
    assert len(lengths) == 2560
    assert lengths[0] == lengths[-1] == 20  # 4k + 16 at the poles
    assert lengths[1279] == lengths[1280] == 5136  # and at the equator


def test_latitudes_run_north_to_south_symmetrically():
    lats = grid.gaussian_latitudes(1280)
    assert np.all(np.diff(lats) < 0)
    assert np.allclose(lats, -lats[::-1])
    assert 89.9 < lats[0] < 90


def test_thailand_window():
    window = grid.window(1280, THAILAND)
    assert len(window) == 25_072
    assert int(window.index[0]) == 1_943_443
    assert int(window.index[-1]) == 2_941_700
    assert np.all(np.diff(window.index) > 0)
    assert window.lat.min() >= 5 and window.lat.max() <= 21
    assert window.lon.min() >= 97 and window.lon.max() <= 106
    # The rows are exactly the slices the index lists.
    assert np.array_equal(np.concatenate([np.arange(a, b) for a, b in window.rows]), window.index)


def test_every_place_in_thailand_is_near_a_point():
    window = grid.window(1280, THAILAND)
    for lat, lon in [(13.7563, 100.5018), (18.7883, 98.9853), (7.8804, 98.3923), (17.4138, 102.7872)]:
        assert distance_km(lat, lon, window.lat, window.lon).min() < 7  # points are about 9 km apart


def test_window_west_of_greenwich_uses_negative_longitudes():
    window = grid.window(64, grid.Area(west=-10, south=40, east=-5, north=45))
    assert window.lon.min() >= -10 and window.lon.max() <= -5
    assert len(window) > 0


@pytest.mark.parametrize("area", [grid.Area(170, 0, 190, 10), grid.Area(170, 0, -170, 10)])
def test_window_may_cross_180_degrees(area):
    window = grid.window(64, area)
    assert window.lon.max() <= 180 and window.lon.min() >= -180
    assert np.any(window.lon > 170) and np.any(window.lon < -170)


@pytest.mark.parametrize("area", [grid.Area(-5, 0, 5, 10), grid.Area(0, 0, 360, 10)])
def test_window_refuses_areas_across_0_degrees(area):
    with pytest.raises(ValueError):
        grid.window(64, area)
