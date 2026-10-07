-- DooFah v2 step 2: what the app's server reads from the forecast store
-- (20261006130000_wx_schema.sql). Two functions in `public`, so Supabase's
-- REST API can call them (POST /rest/v1/rpc/wx_point): only with the secret
-- key, which only DooFah's server holds. The browser's keys can't call them.
--
-- Run once in Supabase's SQL editor, after the wx schema; running it again
-- changes nothing.

-- A moment as Thai time, the way the app shows it: 2026-10-07T13:00+07:00.
create or replace function wx.thai_time(t timestamptz)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select to_char(t at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI"+07:00"')
$$;

-- The newest ready run of one source at the grid point nearest (lat, lon), as
-- one JSON object whose arrays line up with `times`. Rain at times[i] fell in
-- the period_minutes[i] before it (0 at the run's start, where it is null).
-- Null when the source has no ready run, or the place is outside the area
-- the pipeline loads (wx.grids.extent).
create or replace function public.wx_point(p_lat double precision, p_lon double precision, p_source text default 'ecmwf_hres')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with run as (
    select r.id, r.run_time, r.ready_at, r.grid_id, r.valid_times, r.period_minutes, g.spacing_km
    from wx.runs r
    join wx.grids g on g.id = r.grid_id
    where r.source = p_source
      and r.status = 'ready'
      and extensions.st_covers(g.extent, extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326))
    order by r.run_time desc
    limit 1
  ),
  nearest as (
    -- The point is written out here (not taken from a CTE) so the GiST index finds the nearest cell.
    select p.id, p.location
    from wx.points p
    join run on p.grid_id = run.grid_id and p.kind = 'cell'
    order by p.location operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)
    limit 1
  ),
  cell as (
    select
      nearest.id,
      nearest.location,
      extensions.st_distance(
        nearest.location::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography
      ) / 1000 as distance_km
    from nearest
  )
  select jsonb_build_object(
    'source', jsonb_build_object(
      'id', s.id,
      'label_en', s.label_en,
      'label_th', s.label_th,
      'licence', s.licence,
      'attribution', s.attribution
    ),
    'run', jsonb_build_object(
      'time', wx.thai_time(run.run_time),
      'ready_at', wx.thai_time(run.ready_at),
      'grid_km', run.spacing_km
    ),
    'point', jsonb_build_object(
      'lat', round(extensions.st_y(cell.location)::numeric, 4),
      'lon', round(extensions.st_x(cell.location)::numeric, 4),
      'distance_km', round(cell.distance_km::numeric, 1)
    ),
    'times', (select jsonb_agg(wx.thai_time(t.valid_time) order by t.i)
              from unnest(run.valid_times) with ordinality as t (valid_time, i)),
    'period_minutes', to_jsonb(run.period_minutes),
    'precip_mm', to_jsonb(f.precip_mm),
    'temp_c', to_jsonb(f.temp_c),
    'wind_ms', to_jsonb(f.wind_ms),
    'wind_dir', to_jsonb(f.wind_dir),
    'cloud_pct', to_jsonb(f.cloud_pct)
  )
  from run
  cross join cell
  join wx.sources s on s.id = p_source
  join wx.point_forecasts f on f.run_id = run.id and f.point_id = cell.id
$$;

-- For /api/health: each source's newest ready run, and its newest run of any
-- kind (a failed one says why).
create or replace function public.wx_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source', s.id,
    'ready', (
      select jsonb_build_object(
        'run_time', wx.thai_time(r.run_time),
        'ready_at', wx.thai_time(r.ready_at),
        'steps', cardinality(r.valid_times)
      )
      from wx.runs r
      where r.source = s.id and r.status = 'ready'
      order by r.run_time desc
      limit 1
    ),
    'newest', (
      select jsonb_build_object(
        'run_time', wx.thai_time(r.run_time),
        'status', r.status,
        'error', r.details ->> 'error'
      )
      from wx.runs r
      where r.source = s.id
      order by r.run_time desc
      limit 1
    )
  ) order by s.id), '[]'::jsonb)
  from wx.sources s
$$;

-- Only the server's secret key (service_role) may call them. Supabase grants
-- new functions in `public` to the browser's roles by default, so they are
-- taken back here by name.
do $$
begin
  revoke execute on function public.wx_point(double precision, double precision, text) from public;
  revoke execute on function public.wx_status() from public;
  revoke execute on function wx.thai_time(timestamptz) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.wx_point(double precision, double precision, text) from anon, authenticated;
    revoke execute on function public.wx_status() from anon, authenticated;
    revoke execute on function wx.thai_time(timestamptz) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.wx_point(double precision, double precision, text) to service_role;
    grant execute on function public.wx_status() to service_role;
    grant execute on function wx.thai_time(timestamptz) to service_role;
  end if;
end $$;
