-- Suburb boundaries, served from here instead of fetched from WCC per page load.
--
-- prototype/lib/layers.ts fetches all 57 polygons from WCC's ArcGIS server
-- every time the console loads, and ends with:
--
--     .catch(() => emptyCollection())
--
-- So when WCC does not answer, the map draws no boundaries at all and says
-- nothing. It looks like a map with nothing on it. Council servers are exactly
-- what gets slow during an emergency, which is the moment the boundaries matter
-- most — the failure is silent and it is timed to arrive at the worst moment.
--
-- Mirrored, it is one query against our own database. The polygons are WCC's
-- own public boundary layer, already fetched and drawn in the browser today, so
-- serving them discloses nothing new. Generalised to about 9m on ingest, the
-- same as the app already asks WCC for.
--
-- The second half is the more interesting one. layers.ts also derives which
-- suburb a report is in by ray-casting in the browser, which works — but it
-- runs against whatever coordinates the client holds, and gold's coordinates
-- are deliberately fuzzed. A client counting from the public API gets boundary
-- cases wrong, and gets them wrong invisibly. PostGIS can do the same test
-- against the exact location inside silver and publish only the count.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- gold.suburbs_geojson
-- ---------------------------------------------------------------------------

create or replace function gold.suburbs_geojson()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', f.source_feature_id,
          'geometry', extensions.st_asgeojson(f.geom)::jsonb,
          'properties', jsonb_build_object('suburb', f.props ->> 'suburb')
        )
      )
      from silver.dataset_feature f
      where f.dataset_id = 'wcc-suburbs'
    ), '[]'::jsonb),
    'metadata', jsonb_build_object(
      'source', 'Wellington City Council — Suburb Boundaries',
      'sourceUrl', 'https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries/Boundaries/MapServer/4',
      'generalisation', 'Simplified to about 5m for web display. Do not measure anything with '
                        || 'this copy; go to the publisher.',
      'generatedAt', now()
    )
  );
$$;

comment on function gold.suburbs_geojson is
  'Wellington suburb boundaries, mirrored from WCC. Removes the live per-page-load dependency on a council server.';

grant execute on function gold.suburbs_geojson() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- gold.suburb_report_counts
-- ---------------------------------------------------------------------------
-- A choropleth without shipping any geometry to the client, and without the
-- client needing coordinates accurate enough to do the test itself.
--
-- Counted against silver's exact locations. A report whose published point was
-- moved 400m for privacy is still counted in the suburb it actually happened
-- in — which is the whole argument for computing this here rather than letting
-- a consumer do it from the fuzzed points.

create or replace view gold.suburb_report_counts as
with suburbs as (
  select f.props ->> 'suburb' as suburb, f.geom
  from silver.dataset_feature f
  where f.dataset_id = 'wcc-suburbs' and f.props ->> 'suburb' is not null
)
select
  s.suburb                                                     as "suburb",
  count(r.id)                                                  as "reportCount",
  count(r.id) filter (where r.provenance = 'community')        as "communityReports",
  count(r.id) filter (where r.provenance = 'media')            as "mediaReports",
  count(r.id) filter (where r.severity = 'urgent')             as "urgentReports",
  count(r.id) filter (where r.current_status not in
        ('completed_confirmed', 'no_action'))                  as "openReports",
  max(r.observed_at)                                           as "latestReportAt"
from suburbs s
left join silver.report r on extensions.st_intersects(s.geom, r.geom)
group by s.suburb;

comment on view gold.suburb_report_counts is
  'Reports per suburb, counted against exact locations inside silver. No geometry and no coordinates leave this view.';

grant select on gold.suburb_report_counts to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- gold.nearest_hubs
-- ---------------------------------------------------------------------------
-- "Which hub do I go to" is the question a resident actually has during an
-- emergency, and the one the hub layer exists to answer. Distance is computed
-- on the spheroid, so it is metres rather than degrees.

create or replace function gold.nearest_hubs(
  lat   double precision,
  lng   double precision,
  limit_to integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x ->> 'distanceM'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'name', h.name,
      'address', h.address,
      'suburb', h.suburb,
      'lat', extensions.st_y(h.geom),
      'lng', extensions.st_x(h.geom),
      'distanceM', round(extensions.st_distance(
        h.geom::geography,
        extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::geography
      )::numeric)
    ) as x
    from silver.hub h
    where h.is_active
    order by h.geom <-> extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
    limit greatest(1, least(coalesce(limit_to, 3), 36))
  ) ranked;
$$;

comment on function gold.nearest_hubs is
  'The closest Community Emergency Hubs to a point, with distance in metres.';

grant execute on function gold.nearest_hubs(double precision, double precision, integer)
  to anon, authenticated, service_role;
