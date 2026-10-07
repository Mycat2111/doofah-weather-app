# DooFah forecast pipeline (v2)

Loads model runs into the `wx` schema in PostgreSQL. Step 1 of the v2 plan:
ECMWF IFS 9 km from [Open-Meteo's open data](https://github.com/open-meteo/open-data)
(CC BY 4.0). WRF, the ensemble, map tiles, radar and the blend come in later steps.

The web app doesn't read from here yet; it keeps using `/api/forecast` until
the new API routes arrive.

## What a run of the job does

1. Takes a lock, so two copies never load at once.
2. Reads `data_run/ecmwf_ifs/latest.json`, the newest run Open-Meteo has finished.
   If that run is already in `wx.runs`, it stops there.
3. Reads five variables at the grid points inside `wx.grids.extent` (97–106 °E,
   5–21 °N: 25,072 points of ECMWF's O1280 grid, about 9 km apart), with HTTP
   range requests: about 17 MB per variable, 20 seconds for all five.
   - rain (mm over the step before each time: 1 hour to +90 h, then 3, then 6)
   - temperature at 2 m, wind at 10 m (speed and the direction it blows from), cloud cover
4. In one transaction: adds the run to `wx.runs`, loads its own partition of
   `wx.point_forecasts` (one row per point, one array per variable, lined up with
   `wx.runs.valid_times`), and marks it `ready`. The previous run turns `superseded`.
5. Drops the points of runs older than that and marks them `archived`.

A whole load takes about 30 seconds. Each run's partition is 50 to 55 MB, so
with the previous run kept, ECMWF uses about 110 MB of the database (a third
partition exists for a moment while a new run loads).

If the run's files aren't all there yet, it stops with `not_ready` and the next
attempt picks it up. If anything else fails, the run is saved as `failed` with
the error, the previous run stays visible, and the job exits with code 1.

ECMWF runs at 00, 06, 12 and 18 UTC; Open-Meteo usually has a run up 6 to 8
hours later. `.github/workflows/ecmwf-ingest.yml` runs the job every 30 minutes
on GitHub Actions (at :17 and :47), and on demand from the Actions tab.

## Setting up

1. Apply `supabase/migrations/20261006130000_wx_schema.sql` once (Supabase's SQL
   editor, `supabase db push`, or `psql -f`). Running it again changes nothing.
2. Set `DATABASE_URL` where the job runs. On Supabase, use the **session pooler**
   (port 5432) with `?sslmode=require`: the job's lock needs a session, which the
   transaction pooler (port 6543) doesn't keep, and GitHub's runners can't reach
   the direct connection (IPv6 only).
3. For the schedule, add `DATABASE_URL` as a repository secret on GitHub
   (Settings › Secrets and variables › Actions). Until it's there, the workflow
   stops at its first step with a notice.

| Variable                | Default                              |                                       |
| ----------------------- | ------------------------------------ | ------------------------------------- |
| `DATABASE_URL`          | (required)                           | Postgres with the `wx` schema         |
| `OPEN_METEO_BUCKET_URL` | `https://openmeteo.s3.amazonaws.com` |                                       |
| `HTTP_CONCURRENCY`      | `24`                                 | parallel range requests               |
| `KEEP_PREVIOUS_RUNS`    | `1`                                  | superseded runs whose points are kept |

## Running it

The project is managed with [uv](https://docs.astral.sh/uv/) (Python 3.11 or newer; the image uses 3.12).

```sh
cd pipeline
uv sync
export DATABASE_URL=postgresql://...
uv run python -m doofah_pipeline ingest ecmwf_hres                          # the newest run
uv run python -m doofah_pipeline ingest ecmwf_hres --run 2026-10-06T00Z     # a given run (UTC)
uv run python -m doofah_pipeline status
```

Progress goes to stderr; the last line on stdout is a JSON summary
(`loaded`, `up_to_date`, `not_ready`, `busy`, or `failed`).

Or with Docker, from the repository root:

```sh
docker build -t doofah-pipeline pipeline
docker run --rm -e DATABASE_URL doofah-pipeline ingest ecmwf_hres
```

To check a run, ask the database for a place's forecast (times print in Thai time):

```sql
select * from wx.point_forecast(13.75, 100.50);
```

## Tests

The database tests need a Postgres with PostGIS where the user may create
databases. Each test makes its own database and drops it.

```sh
docker compose -f pipeline/docker-compose.yml up -d   # PostGIS on port 54329
cd pipeline
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres uv run pytest
WX_LIVE=1 uv run pytest -m live   # reads today's run from Open-Meteo's bucket
```

The tests use a fake bucket laid out like Open-Meteo's, on a coarse O24 grid,
so they need no network.

GitHub Actions runs them on every pull request that changes `pipeline/` or
`supabase/migrations/`.

## Credit

Forecast data by ECMWF (CC BY 4.0), via Open-Meteo. The app shows this
wherever it shows these forecasts (`wx.sources.attribution`).
