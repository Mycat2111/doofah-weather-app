-- Shared weather reports from people ("it's raining here"), kept for 3 hours.
--
-- Run once in Supabase's SQL editor (or with `supabase db push`); running it
-- again changes nothing. README: "Shared reports on Supabase".
--
-- Only DooFah's server uses this, with the project's secret key, through the
-- four functions below; the table and functions are closed to the browser's
-- keys (anon and authenticated).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
-- Supabase Cron, for the cleanup every 10 minutes.
create extension if not exists pg_cron;

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

do $$
begin
  create type public.report_kind as enum ('sunny', 'cloudy', 'lightRain', 'heavyRain');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.crowd_reports (
  id bigint generated always as identity primary key,
  kind public.report_kind not null,
  -- Rounded to 0.01° (about 1 km) before it is saved: enough for the weather, not enough to find a home.
  location extensions.geometry(point, 4326) not null,
  created_at timestamptz not null default now(),
  -- A keyed hash of the phone's random id (never the id itself or an IP address), so one phone
  -- changing its mind replaces its report instead of adding another.
  reporter text not null
);

-- The map asks for boxes: GiST answers "which points are in this box" without reading the rest.
create index if not exists crowd_reports_location_idx on public.crowd_reports using gist (location);
create index if not exists crowd_reports_created_at_idx on public.crowd_reports (created_at);
create index if not exists crowd_reports_reporter_idx on public.crowd_reports (reporter, created_at desc);

-- Row level security with no policies: the publishable (anon) key can't read or write a row. The secret
-- key is Supabase's service_role, which skips row level security, and only DooFah's server holds it.
alter table public.crowd_reports enable row level security;
revoke all on table public.crowd_reports from anon, authenticated;
grant select, insert, delete on table public.crowd_reports to service_role;

/* ------------------------------------------------------------------ */
/* How long a report lasts                                             */
/* ------------------------------------------------------------------ */

-- The page fades a report out over the same 3 hours (REPORT_TTL_MS in src/lib/crowdReports.ts).
create or replace function public.crowd_report_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '3 hours'
$$;

/* ------------------------------------------------------------------ */
/* Reports in a box, for the map                                       */
/* ------------------------------------------------------------------ */

-- The live reports in a box, newest first, when there are at most max_points of them. With more, they are
-- counted per cell (`cell` degrees a side, placed at the average of its reports), so a whole country stays
-- one small answer.
create or replace function public.crowd_reports_in_box(
  west double precision,
  south double precision,
  east double precision,
  north double precision,
  max_points integer,
  cell double precision
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  box extensions.geometry := extensions.st_makeenvelope(west, south, east, north, 4326);
  since timestamptz := now() - public.crowd_report_ttl();
  found integer;
begin
  -- Counted only up to one past the limit: enough to choose, without counting a busy box to the end.
  select count(*) into found
  from (
    select 1
    from public.crowd_reports r
    where r.location operator(extensions.&&) box and r.created_at > since
    limit max_points + 1
  ) first_ones;

  if found <= max_points then
    return jsonb_build_object(
      'reports',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', r.id::text,
              'kind', r.kind,
              'lat', extensions.st_y(r.location),
              'lon', extensions.st_x(r.location),
              'time', r.created_at
            )
            order by r.created_at desc
          )
          from public.crowd_reports r
          where r.location operator(extensions.&&) box and r.created_at > since
        ),
        '[]'::jsonb
      ),
      'cells', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'reports', '[]'::jsonb,
    'cells',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'lat', round(c.lat::numeric, 3),
            'lon', round(c.lon::numeric, 3),
            'count', c.count,
            'kinds', jsonb_build_object(
              'sunny', c.sunny, 'cloudy', c.cloudy, 'lightRain', c.light_rain, 'heavyRain', c.heavy_rain
            ),
            'newest', c.newest
          )
          order by c.count desc
        )
        from (
          select
            avg(extensions.st_y(r.location)) as lat,
            avg(extensions.st_x(r.location)) as lon,
            count(*) as count,
            count(*) filter (where r.kind = 'sunny') as sunny,
            count(*) filter (where r.kind = 'cloudy') as cloudy,
            count(*) filter (where r.kind = 'lightRain') as light_rain,
            count(*) filter (where r.kind = 'heavyRain') as heavy_rain,
            max(r.created_at) as newest
          from public.crowd_reports r
          where r.location operator(extensions.&&) box and r.created_at > since
          group by floor(extensions.st_y(r.location) / cell), floor(extensions.st_x(r.location) / cell)
        ) c
      ),
      '[]'::jsonb
    )
  );
end
$$;

/* ------------------------------------------------------------------ */
/* Sending a report                                                    */
/* ------------------------------------------------------------------ */

-- Saves a report, or says why not. Reporting again within 10 minutes and 1 km replaces the phone's last
-- report there (changing your mind is not a second witness), and a phone keeps at most 6 reports an hour.
create or replace function public.submit_crowd_report(
  p_reporter text,
  p_kind public.report_kind,
  p_lat double precision,
  p_lon double precision
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  spot extensions.geometry;
  replaced bigint[];
  recent integer;
  saved public.crowd_reports;
begin
  if p_reporter is null or length(p_reporter) not between 8 and 64
    or p_lat is null or p_lat not between -90 and 90
    or p_lon is null or p_lon not between -180 and 180 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  spot := extensions.st_setsrid(
    extensions.st_makepoint(round(p_lon::numeric, 2)::double precision, round(p_lat::numeric, 2)::double precision),
    4326
  );

  select coalesce(array_agg(r.id), '{}') into replaced
  from public.crowd_reports r
  where r.reporter = p_reporter
    and r.created_at > now() - interval '10 minutes'
    and extensions.st_dwithin(r.location::extensions.geography, spot::extensions.geography, 1000);

  select count(*) into recent
  from public.crowd_reports r
  where r.reporter = p_reporter and r.created_at > now() - interval '1 hour' and r.id <> all (replaced);
  if recent >= 6 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  delete from public.crowd_reports r where r.id = any (replaced);
  insert into public.crowd_reports (kind, location, reporter)
  values (p_kind, spot, p_reporter)
  returning * into saved;

  return jsonb_build_object(
    'ok', true,
    'replaced', cardinality(replaced),
    'report', jsonb_build_object(
      'id', saved.id::text,
      'kind', saved.kind,
      'lat', extensions.st_y(saved.location),
      'lon', extensions.st_x(saved.location),
      'time', saved.created_at
    )
  );
end
$$;

/* ------------------------------------------------------------------ */
/* Cleanup and health                                                  */
/* ------------------------------------------------------------------ */

-- Deletes reports past their 3 hours; the map never shows them anyway. Returns how many went.
create or replace function public.delete_old_crowd_reports()
returns integer
language sql
volatile
set search_path = ''
as $$
  with gone as (
    delete from public.crowd_reports r where r.created_at < now() - public.crowd_report_ttl() returning 1
  )
  select count(*)::integer from gone
$$;

-- For /api/health: live reports, and the oldest row (a row much older than 3 hours means the cleanup stopped).
create or replace function public.crowd_reports_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'live', (select count(*) from public.crowd_reports r where r.created_at > now() - public.crowd_report_ttl()),
    'oldest', (select min(r.created_at) from public.crowd_reports r)
  )
$$;

-- Every 10 minutes. Scheduling the same name again updates the job instead of adding one.
select cron.schedule('doofah-delete-old-reports', '*/10 * * * *', 'select public.delete_old_crowd_reports()');

/* ------------------------------------------------------------------ */
/* Who may call what                                                   */
/* ------------------------------------------------------------------ */

-- Postgres lets everyone run a new function, and Supabase's API would offer these to the browser's keys:
-- only the server's secret key (service_role) may.
revoke execute on function
  public.crowd_reports_in_box(double precision, double precision, double precision, double precision, integer, double precision),
  public.submit_crowd_report(text, public.report_kind, double precision, double precision),
  public.delete_old_crowd_reports(),
  public.crowd_reports_status()
from public, anon, authenticated;

grant execute on function
  public.crowd_reports_in_box(double precision, double precision, double precision, double precision, integer, double precision),
  public.submit_crowd_report(text, public.report_kind, double precision, double precision),
  public.delete_old_crowd_reports(),
  public.crowd_reports_status()
to service_role;
