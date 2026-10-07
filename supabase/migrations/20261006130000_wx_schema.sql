-- DooFah v2 forecast store: model runs, the points they cover, and each
-- point's forecast, in the `wx` schema. Plan: "DooFah v2 forecast system plan".
--
-- Run once in Supabase's SQL editor (or with `supabase db push`); running it
-- again changes nothing. Only the Python pipeline (pipeline/) writes here,
-- with the database's own connection string; the browser's keys (anon and
-- authenticated) can't read or write anything in `wx`.
--
-- Times are timestamptz (an absolute moment). The database prints them in
-- Thai time (+07); never store a Thai clock time without its zone.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists wx;

-- New sessions print times in Thai time. Skipped where the role may not change
-- the database's settings; every time is still stored with its zone.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Bangkok');
exception
  when insufficient_privilege then
    raise notice 'timezone not changed: % (sessions can still say set timezone to ''Asia/Bangkok'')', sqlerrm;
end $$;

/* ------------------------------------------------------------------ */
/* Sources, grids and points                                           */
/* ------------------------------------------------------------------ */

-- Where each layer comes from, and how the app credits it.
create table if not exists wx.sources (
  id text primary key, -- ecmwf_hres; later ecmwf_ens, wrf, radar, nowcast, blend
  label_en text not null,
  label_th text not null,
  provider text not null,
  licence text not null,
  attribution text not null
);

-- The grid a source is published on. `extent` is the area the pipeline loads.
create table if not exists wx.grids (
  id smallint generated always as identity primary key,
  name text unique not null, -- ecmwf_o1280; later wrf_d03_2km, ecmwf_ens_025, radar_1km
  source text not null references wx.sources,
  spacing_km real not null,
  extent extensions.geometry(polygon, 4326) not null
);

create table if not exists wx.stations (
  id text primary key, -- WMO number, e.g. '48455'
  network text not null, -- 'tmd_synop'; later 'haii'
  name_th text not null,
  name_en text not null,
  location extensions.geometry(point, 4326) not null,
  elevation_m real,
  active boolean not null default true
);

-- Every place a forecast is stored for: grid cells, named places, weather stations.
create table if not exists wx.points (
  id integer generated always as identity primary key,
  kind text not null check (kind in ('cell', 'place', 'station')),
  grid_id smallint references wx.grids, -- cells only
  grid_index integer, -- cells only: the point's index in the provider's global array
  station_id text references wx.stations, -- stations only
  admin_code text, -- places only: province or district code
  location extensions.geometry(point, 4326) not null,
  check ((kind = 'cell') = (grid_id is not null and grid_index is not null))
);
create index if not exists points_location on wx.points using gist (location);
create unique index if not exists points_cell on wx.points (grid_id, grid_index) where kind = 'cell';

/* ------------------------------------------------------------------ */
/* Runs and their forecasts                                            */
/* ------------------------------------------------------------------ */

do $$
begin
  create type wx.run_status as enum ('fetching', 'processing', 'ready', 'superseded', 'archived', 'failed');
exception
  when duplicate_object then null;
end $$;

-- One model run (for nowcasts and blends, one radar time). Users only ever see `ready` runs.
create table if not exists wx.runs (
  id bigint generated always as identity primary key,
  source text not null references wx.sources,
  grid_id smallint not null references wx.grids,
  run_time timestamptz not null, -- the model's start time; for nowcasts, the radar time
  run_time_inferred boolean not null default false, -- the provider didn't say (TMD's NWP API)
  published_at timestamptz, -- when the provider's files were complete
  ready_at timestamptz, -- when users could see it
  status wx.run_status not null default 'fetching',
  valid_times timestamptz[] not null default '{}', -- the time axis every forecast array lines up with
  period_minutes smallint[] not null default '{}', -- rain at valid_times[i] fell in the period_minutes[i] before it
  tile_prefix text, -- where the run's map frames are in object storage
  details jsonb not null default '{}', -- provider files, counts, the last error
  unique (source, grid_id, run_time)
);
create index if not exists runs_latest on wx.runs (source, run_time desc) where status = 'ready';

-- Which runs a blend was made from (Phase 2).
create table if not exists wx.run_inputs (
  run_id bigint references wx.runs on delete cascade,
  input_run_id bigint references wx.runs,
  role text not null, -- 'nowcast', 'nwp'
  primary key (run_id, input_run_id)
);

-- A point's whole run as arrays that line up with wx.runs.valid_times. The
-- pipeline loads each run into its own partition (wx.point_forecasts_r<run id>)
-- in the same transaction that marks it ready, and drops it two runs later.
create table if not exists wx.point_forecasts (
  run_id bigint not null references wx.runs,
  point_id integer not null references wx.points,
  precip_mm real[] not null, -- rain in each period; null at the run's start time
  precip_prob smallint[], -- % chance of rain (ensemble)
  temp_c real[],
  wind_ms real[],
  wind_dir smallint[], -- degrees the wind blows from
  cloud_pct smallint[],
  primary key (run_id, point_id)
) partition by list (run_id);

-- One map frame: a PMTiles file in object storage (step 3).
create table if not exists wx.frames (
  run_id bigint not null references wx.runs on delete cascade,
  layer text not null default 'precip', -- precip, precip_prob; later temp, wind, cloud
  valid_time timestamptz not null,
  period_minutes smallint not null,
  tiles_key text not null,
  min_zoom smallint not null,
  max_zoom smallint not null,
  primary key (run_id, layer, valid_time)
);

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

-- What fell at the stations ...
create table if not exists wx.observations (
  station_id text not null references wx.stations,
  obs_time timestamptz not null, -- end of the period
  period_minutes smallint not null, -- station reports give rain over 1, 3, 6, 12 or 24 hours
  precip_mm real, -- null = not reported, 0 = reported dry
  temp_c real,
  qc smallint not null default 0, -- 0 raw, 1 passed, 2 suspect, 3 rejected
  received_at timestamptz not null default now(),
  primary key (station_id, obs_time, period_minutes)
) partition by range (obs_time); -- one partition a month, added by the pipeline

-- ... and what each source forecast there, kept after the run's points are dropped.
create table if not exists wx.forecast_archive (
  station_id text not null references wx.stations,
  run_id bigint not null references wx.runs, -- its valid_times give the time axis
  precip_mm real[] not null,
  precip_prob smallint[],
  primary key (run_id, station_id)
);

-- The handover weights, versioned so a fitted set can be switched on and back off.
create table if not exists wx.blend_weights (
  version integer not null,
  handover text not null check (handover in ('nowcast>wrf', 'wrf>ecmwf_hres')),
  region text not null default 'TH',
  season text not null default 'all',
  lead_minutes integer not null,
  weight_out real not null check (weight_out between 0 and 1), -- the outgoing source's weight
  active boolean not null default false,
  fitted_at timestamptz not null default now(),
  notes text,
  primary key (version, handover, region, season, lead_minutes)
);

/* ------------------------------------------------------------------ */
/* Radar (Phase 2)                                                     */
/* ------------------------------------------------------------------ */

create table if not exists wx.radar_sites (
  id text primary key,
  operator text not null check (operator in ('tmd', 'bma', 'haii')),
  name text not null,
  location extensions.geometry(point, 4326) not null,
  range_km real not null,
  image_url text not null,
  palette jsonb not null, -- the legend: [{"rgb": "#00c800", "dbz": 20}, ...]
  mask_key text, -- pixels to ignore: map lines, range rings, labels
  georef jsonb not null, -- how image pixels map to the ground
  zr_a real not null default 200, -- Z = a R^b
  zr_b real not null default 1.6
);

create table if not exists wx.radar_frames (
  site_id text not null, -- a radar_sites id, or 'composite'
  observed_at timestamptz not null,
  raw_key text not null,
  rain_key text, -- rain rate, mm/h, as a Cloud-Optimized GeoTIFF
  status text not null default 'new' check (status in ('new', 'converted', 'late', 'failed')),
  quality jsonb not null default '{}',
  primary key (site_id, observed_at)
);

/* ------------------------------------------------------------------ */
/* Reading a point                                                     */
/* ------------------------------------------------------------------ */

-- The newest ready run of one source at the grid point nearest (lat, lon), step
-- by step. The stitched, multi-source answer for the app (wx.point_series)
-- comes in step 6; this one is for checking a run.
create or replace function wx.point_forecast(p_lat double precision, p_lon double precision, p_source text default 'ecmwf_hres')
returns table (
  run_time timestamptz,
  valid_time timestamptz,
  period_minutes smallint,
  precip_mm real,
  temp_c real,
  wind_ms real,
  wind_dir smallint,
  cloud_pct smallint,
  distance_km real
)
language sql
stable
set search_path = ''
as $$
  with run as (
    select r.id, r.run_time, r.grid_id, r.valid_times, r.period_minutes
    from wx.runs r
    where r.source = p_source and r.status = 'ready'
    order by r.run_time desc
    limit 1
  ),
  nearest as (
    select p.id, p.location
    from wx.points p
    join run on p.grid_id = run.grid_id and p.kind = 'cell'
    order by p.location operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)
    limit 1
  )
  select
    run.run_time,
    t.valid_time,
    run.period_minutes[t.i],
    f.precip_mm[t.i],
    f.temp_c[t.i],
    f.wind_ms[t.i],
    f.wind_dir[t.i],
    f.cloud_pct[t.i],
    (extensions.st_distance(
      nearest.location::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography
    ) / 1000)::real
  from run
  cross join nearest
  join wx.point_forecasts f on f.run_id = run.id and f.point_id = nearest.id
  cross join lateral unnest(run.valid_times) with ordinality as t (valid_time, i)
  order by t.i
$$;

/* ------------------------------------------------------------------ */
/* Who can use it                                                      */
/* ------------------------------------------------------------------ */

-- Row level security with no policies on every table, and nothing granted to
-- the browser's roles. The API reads through service_role (Supabase's secret
-- key) once its routes arrive; plain Postgres has none of these roles.
do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'wx' and c.relkind in ('r', 'p') and not c.relispartition loop
    execute format('alter table wx.%I enable row level security', t.relname);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema wx from anon, authenticated;
    revoke all on schema wx from anon, authenticated;
  end if;
  revoke execute on function wx.point_forecast(double precision, double precision, text) from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema wx, extensions to service_role;
    grant select on all tables in schema wx to service_role;
    grant execute on function wx.point_forecast(double precision, double precision, text) to service_role;
  end if;
end $$;

/* ------------------------------------------------------------------ */
/* What the pipeline loads first                                       */
/* ------------------------------------------------------------------ */

insert into wx.sources (id, label_en, label_th, provider, licence, attribution)
values (
  'ecmwf_hres',
  'ECMWF IFS 9 km',
  'ECMWF IFS 9 กม.',
  'ECMWF, via Open-Meteo open data',
  'CC BY 4.0',
  'Forecast data by ECMWF (CC BY 4.0), via Open-Meteo'
)
on conflict (id) do nothing;

-- Thailand and its neighbours' edges: 97 to 106 E, 5 to 21 N.
insert into wx.grids (name, source, spacing_km, extent)
values ('ecmwf_o1280', 'ecmwf_hres', 9, extensions.st_makeenvelope(97, 5, 106, 21, 4326))
on conflict (name) do nothing;
