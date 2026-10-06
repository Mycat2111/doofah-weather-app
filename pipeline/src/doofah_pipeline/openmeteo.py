"""Model runs from Open-Meteo's open data on AWS (s3://openmeteo, CC BY 4.0).

The layout read here (https://github.com/open-meteo/open-data):

    data_run/<model>/latest.json                     the newest complete run's meta.json
    data_run/<model>/YYYY/MM/DD/HHMMZ/meta.json      reference_time, valid_times, variables
    data_run/<model>/YYYY/MM/DD/HHMMZ/<variable>.om  [1, points, times], chunked 7 points by every time

Only an area's points are read, row by row, through HTTP range requests.
Rain in a file is the total over the step before each time (1, 3 or 6 hours
for ECMWF IFS); checked on 6 Oct 2026 by comparing the same 6-hour windows in
two runs whose steps differ there.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
import numpy as np
import omfiles

from .grid import Window

DEFAULT_BUCKET = "https://openmeteo.s3.amazonaws.com"
BLOCK_SIZE = 64 * 1024
ATTEMPTS = 3


class BucketError(RuntimeError):
    pass


@dataclass(frozen=True)
class RunMeta:
    model: str
    reference_time: datetime
    valid_times: tuple[datetime, ...]
    variables: frozenset[str]
    created_at: datetime | None

    @property
    def folder(self) -> str:
        return run_folder(self.model, self.reference_time)


def parse_time(text: str) -> datetime:
    """Open-Meteo's UTC times: '2026-10-06T00:00Z' or '2026-10-06T00:00:00Z'. No zone means UTC."""
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def run_folder(model: str, reference_time: datetime) -> str:
    return f"data_run/{model}/{reference_time.astimezone(timezone.utc):%Y/%m/%d/%H%MZ}/"


def parse_meta(model: str, raw: dict) -> RunMeta:
    try:
        return RunMeta(
            model=model,
            reference_time=parse_time(raw["reference_time"]),
            valid_times=tuple(parse_time(t) for t in raw["valid_times"]),
            variables=frozenset(raw["variables"]),
            created_at=parse_time(raw["created_at"]) if raw.get("created_at") else None,
        )
    except (KeyError, TypeError, ValueError) as error:
        raise BucketError(f"unexpected meta.json for {model}: {error}") from error


@dataclass
class Stats:
    requests: int = 0
    bytes: int = 0


class _BlockFile:
    """What omfiles needs from an async fsspec filesystem (`_size`, `_cat_file`), for one file.

    omfiles asks for many small ranges close together (a row's chunks and the
    index entries that find them). Fetching whole 64 KB blocks and answering
    from them takes about a tenth of the requests.
    """

    def __init__(self, client: httpx.AsyncClient, stats: Stats, block_size: int):
        self._client = client
        self._stats = stats
        self._block_size = block_size
        self._blocks: dict[int, asyncio.Future[bytes]] = {}
        self._length: int | None = None

    async def _size(self, path: str) -> int:
        if self._length is None:
            response = await _request(self._client, "HEAD", path)
            self._length = int(response.headers["content-length"])
        return self._length

    async def _fetch(self, path: str, block: int) -> bytes:
        size = await self._size(path)
        start = block * self._block_size
        end = min(size, start + self._block_size) - 1
        response = await _request(self._client, "GET", path, headers={"Range": f"bytes={start}-{end}"})
        self._stats.requests += 1
        self._stats.bytes += len(response.content)
        if len(response.content) != end - start + 1:
            raise BucketError(f"{path}: asked for bytes {start}-{end}, got {len(response.content)}")
        return response.content

    def _block(self, path: str, block: int) -> asyncio.Future[bytes]:
        if block not in self._blocks:
            self._blocks[block] = asyncio.ensure_future(self._fetch(path, block))
        return self._blocks[block]

    async def _cat_file(self, path: str, start: int | None = None, end: int | None = None, **_: object) -> bytes:
        start = start or 0
        end = await self._size(path) if end is None else end
        if end <= start:
            return b""
        first, last = start // self._block_size, (end - 1) // self._block_size
        parts = await asyncio.gather(*(self._block(path, b) for b in range(first, last + 1)))
        offset = first * self._block_size
        return b"".join(parts)[start - offset : end - offset]


async def _request(client: httpx.AsyncClient, method: str, url: str, **kwargs: object) -> httpx.Response:
    for attempt in range(ATTEMPTS):
        try:
            response = await client.request(method, url, **kwargs)
            if response.status_code < 500:
                response.raise_for_status()
                return response
            problem = f"{url} answered {response.status_code}"
        except httpx.TransportError as error:
            problem = f"{url}: {error!r}"
        except httpx.HTTPStatusError as error:
            raise BucketError(f"{url} answered {error.response.status_code}") from error
        if attempt + 1 < ATTEMPTS:
            await asyncio.sleep(0.5 * 2**attempt)
    raise BucketError(problem)


@dataclass
class Bucket:
    """Open-Meteo's bucket, or anything laid out like it."""

    url: str = DEFAULT_BUCKET
    concurrency: int = 24
    block_size: int = BLOCK_SIZE
    transport: httpx.AsyncBaseTransport | None = None
    stats: Stats = field(default_factory=Stats)

    def __post_init__(self) -> None:
        self.url = self.url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=15),
            limits=httpx.Limits(max_connections=self.concurrency),
            transport=self.transport,
            headers={"User-Agent": "doofah-pipeline (+https://github.com/Mycat2111/doofah-weather-app)"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _json(self, path: str) -> dict:
        response = await _request(self._client, "GET", f"{self.url}/{path}")
        try:
            return json.loads(response.content)
        except ValueError as error:
            raise BucketError(f"{path} is not JSON") from error

    async def latest(self, model: str) -> RunMeta:
        """The newest complete run (Open-Meteo writes latest.json once a run's files are up)."""
        return parse_meta(model, await self._json(f"data_run/{model}/latest.json"))

    async def run(self, model: str, reference_time: datetime) -> RunMeta:
        return parse_meta(model, await self._json(f"{run_folder(model, reference_time)}meta.json"))

    async def read_window(self, meta: RunMeta, variable: str, window: Window) -> tuple[np.ndarray, np.ndarray]:
        """One variable at the window's points: (times as UTC seconds, values [points, times])."""
        url = f"{self.url}/{meta.folder}{variable}.om"
        reader = await omfiles.OmFileReaderAsync.from_fsspec(_BlockFile(self._client, self.stats, self.block_size), url)
        try:
            if len(reader.shape) != 3 or reader.shape[0] != 1:
                raise BucketError(f"{url}: expected [1, points, times], got {reader.shape}")
            _, points, steps = reader.shape
            if points <= int(window.index[-1]):
                raise BucketError(f"{url}: {points} points, the window needs {int(window.index[-1]) + 1}")
            time_variable = await reader.get_child_by_name("time")
            times = np.asarray(await time_variable.read_array((slice(0, steps),)), dtype=np.int64)
            limit = asyncio.Semaphore(self.concurrency)

            async def row(start: int, stop: int) -> np.ndarray:
                async with limit:
                    return (await reader.read_array((slice(0, 1), slice(start, stop), slice(0, steps))))[0]

            values = np.concatenate(await asyncio.gather(*(row(a, b) for a, b in window.rows)))
        finally:
            reader.close()
        return times, values.astype(np.float32, copy=False)
