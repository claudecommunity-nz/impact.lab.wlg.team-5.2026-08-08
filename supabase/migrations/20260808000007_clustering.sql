-- Grouping similar reports, which the problem statement asks for directly:
-- "WCC could group similar reports".
--
-- Five people reporting the same flooded stretch of Evans Bay Parade is one
-- incident with five witnesses. Showing it as five pins overstates how much is
-- happening; showing it as one pin with a count of five is the useful answer.
--
-- Clustering also earns trust: a lone report stays 'unverified', but several
-- independent reports of the same thing in the same place within a few hours
-- corroborate each other. That promotion is the only automatic trust change in
-- the system, and it is deliberately conservative — corroborated is not
-- confirmed, and gold says so in the disclaimer.

set search_path = public, extensions;

-- 250m matches GROUP_RADIUS_M in prototype/lib/store.ts, so the database and
-- the app group reports identically. DBSCAN with minpoints = 2 is also the same
-- single-link behaviour: near *any* member, not just the first one added, which
-- is what stops four reports about one flooded street becoming two incidents
-- depending on the order they arrived in.

create or replace function silver.rebuild_clusters(
  eps_metres double precision default 250,
  min_points integer default 2
)
returns integer
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  grp record;
  new_cluster_id uuid;
  cluster_count integer := 0;
begin
  delete from silver.report_cluster_member;
  delete from silver.report_cluster;

  -- DBSCAN runs in EPSG:2193 so eps is honest metres. In 4326 it would be
  -- degrees, and a degree of longitude at Wellington's latitude is about 84km
  -- shorter than a degree of latitude — the cluster would be an ellipse.
  for grp in
    with clustered as (
      select
        r.id,
        r.fault_type,
        r.geom,
        r.loc_suburb as suburb,
        r.observed_at,
        extensions.st_clusterdbscan(
          extensions.st_transform(r.geom, 2193),
          eps := eps_metres,
          minpoints := min_points
        ) over (partition by r.fault_type) as cid
      from silver.report r
    )
    select
      c.fault_type,
      extensions.st_centroid(extensions.st_collect(c.geom))            as centroid,
      mode() within group (order by c.suburb)                          as suburb,
      count(*)::integer                                                as member_count,
      min(c.observed_at)                                               as first_seen_at,
      max(c.observed_at)                                               as last_seen_at,
      array_agg(c.id)                                                  as report_ids
    from clustered c
    where c.cid is not null
    group by c.fault_type, c.cid
  loop
    insert into silver.report_cluster (
      fault_type, centroid_geom, suburb, member_count, radius_m, first_seen_at, last_seen_at
    )
    values (
      grp.fault_type,
      extensions.st_setsrid(grp.centroid, 4326),
      grp.suburb,
      grp.member_count,
      eps_metres::integer,
      grp.first_seen_at,
      grp.last_seen_at
    )
    returning id into new_cluster_id;

    insert into silver.report_cluster_member (cluster_id, report_id)
    select new_cluster_id, unnest(grp.report_ids);

    -- Three or more independent reports of the same thing in the same place.
    -- Never downgrades anything a human has already confirmed.
    if grp.member_count >= 3 then
      update silver.report
         set verification_level = 'corroborated'
       where id = any (grp.report_ids)
         and verification_level = 'unverified';
    end if;

    cluster_count := cluster_count + 1;
  end loop;

  return cluster_count;
end;
$$;

comment on function silver.rebuild_clusters is
  'Rebuilds report clusters by fault type and proximity, and promotes members of 3+ clusters to corroborated.';

revoke all on function silver.rebuild_clusters(double precision, integer)
  from anon, authenticated, public;
