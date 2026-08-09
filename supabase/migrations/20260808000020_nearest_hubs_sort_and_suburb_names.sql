-- Two fixes found by looking at the output instead of trusting it.
--
-- 1. gold.nearest_hubs returned the hubs in the wrong order: 1409m, then 613m,
--    then 622m. `order by x ->> 'distanceM'` sorts the jsonb value as TEXT, and
--    '1409' sorts before '613'. The nearest hub is the entire question the
--    function exists to answer, and it was answering it wrong — while looking
--    completely plausible, which is worse.
--
-- 2. Four of the twelve April 2026 incidents sit in a different suburb than the
--    news reporting said:
--
--      Vogeltown    -> Brooklyn        Mornington   -> Berhampore
--      Kingston     -> Berhampore      South Karori -> Makara
--
--    Neither is wrong. Journalists use the name people who live there use;
--    WCC's boundary layer uses the official one. Overwriting the reported name
--    would destroy what the source actually said, and ignoring the boundary
--    would put reports in the wrong bucket when counted. So both are kept and
--    the disagreement is published.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Sort on a number, not on its text
-- ---------------------------------------------------------------------------

create or replace function gold.nearest_hubs(
  lat      double precision,
  lng      double precision,
  limit_to integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', ranked.name,
      'address', ranked.address,
      'suburb', ranked.suburb,
      'lat', ranked.lat,
      'lng', ranked.lng,
      'distanceM', ranked.distance_m
    ) order by ranked.distance_m
  ), '[]'::jsonb)
  from (
    select
      h.name,
      h.address,
      h.suburb,
      extensions.st_y(h.geom) as lat,
      extensions.st_x(h.geom) as lng,
      -- Metres on the spheroid, not degrees. A degree of longitude at
      -- Wellington's latitude is about 84km shorter than a degree of latitude,
      -- so a planar distance here would be quietly wrong in one axis.
      round(extensions.st_distance(
        h.geom::geography,
        extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::geography
      )::numeric) as distance_m
    from silver.hub h
    where h.is_active
    order by h.geom <-> extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
    limit greatest(1, least(coalesce(limit_to, 3), 36))
  ) ranked;
$$;

comment on function gold.nearest_hubs is
  'The closest Community Emergency Hubs to a point, nearest first, with distance in metres on the spheroid.';

grant execute on function gold.nearest_hubs(double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Where the reported suburb and the official boundary disagree
-- ---------------------------------------------------------------------------
-- Published rather than resolved. A resident saying "Vogeltown" is not making
-- an error, and neither is WCC's boundary layer saying Brooklyn — they are
-- answering different questions. A console that shows the reported name while
-- counting by the official one needs both, and needs to know when they differ.

create or replace view gold.report_suburb as
select
  r.reference                          as "reference",
  r.loc_suburb                         as "suburbAsReported",
  s.props ->> 'suburb'                 as "suburbOfficial",
  (s.props ->> 'suburb') is distinct from r.loc_suburb
                                       as "differs",
  'Reported name is what the reporter or the source said. Official name is WCC''s '
  || 'suburb boundary layer, tested against the exact location. Both are kept; '
  || 'counts use the official one.'    as "basis"
from silver.report r
left join silver.dataset_feature s
  on s.dataset_id = 'wcc-suburbs'
 and extensions.st_intersects(s.geom, r.geom);

comment on view gold.report_suburb is
  'Reported suburb name against WCC''s official boundary, and whether they disagree.';

grant select on gold.report_suburb to anon, authenticated, service_role;
