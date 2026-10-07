"""ECMWF's octahedral reduced Gaussian grid (O1280 for IFS 9 km), and the part of it inside an area.

The grid has 2N rows of latitude (N per hemisphere), at the Gaussian
latitudes, north to south. Row k from the nearer pole has 4k + 16 points,
evenly spaced from 0° east. Open-Meteo stores the points as one flat array in
that order, so an area becomes one contiguous slice of the array per row.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np


@dataclass(frozen=True)
class Area:
    west: float
    south: float
    east: float
    north: float


@dataclass(frozen=True)
class Window:
    """The grid points inside an area."""

    index: np.ndarray  # each point's position in the global array, ascending
    lat: np.ndarray
    lon: np.ndarray  # -180 to 180
    rows: tuple[tuple[int, int], ...]  # (start, stop) of each row's slice of the global array

    def __len__(self) -> int:
        return len(self.index)


@lru_cache
def gaussian_latitudes(n: int) -> np.ndarray:
    """The 2N Gaussian latitudes, north to south: the roots of the Legendre polynomial of degree 2N."""
    roots, _ = np.polynomial.legendre.leggauss(2 * n)
    return np.degrees(np.arcsin(roots))[::-1]


@lru_cache
def row_lengths(n: int) -> np.ndarray:
    k = np.arange(1, 2 * n + 1)
    return 4 * np.minimum(k, 2 * n + 1 - k) + 16


def size(n: int) -> int:
    return int(row_lengths(n).sum())


def window(n: int, area: Area) -> Window:
    """The points of the O`n` grid inside `area` (inclusive).

    Each row starts at 0° east, so an area may cross 180° but not 0°.
    """
    west, east = area.west % 360, area.east % 360
    if area.east - area.west >= 360 or west > east:
        raise ValueError(f"area must not cross 0° east: {area}")
    lats = gaussian_latitudes(n)
    lengths = row_lengths(n)
    starts = np.concatenate([[0], np.cumsum(lengths)[:-1]])
    index, lat, lon, rows = [], [], [], []
    for row in np.flatnonzero((lats >= area.south) & (lats <= area.north)):
        count = int(lengths[row])
        first = int(np.ceil(west * count / 360 - 1e-9))
        last = int(np.floor(east * count / 360 + 1e-9))
        if last < first:
            continue
        j = np.arange(first, last + 1)
        start = int(starts[row])
        index.append(start + j)
        lat.append(np.full(len(j), lats[row]))
        lon.append(j * 360.0 / count)
        rows.append((start + first, start + last + 1))
    if not rows:
        raise ValueError(f"no grid points inside {area}")
    lon_all = np.concatenate(lon)
    return Window(
        index=np.concatenate(index).astype(np.int64),
        lat=np.concatenate(lat),
        lon=np.where(lon_all > 180, lon_all - 360, lon_all),
        rows=tuple(rows),
    )
