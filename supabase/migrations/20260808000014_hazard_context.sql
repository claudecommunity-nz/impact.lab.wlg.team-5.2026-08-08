-- Does this report sit inside somewhere WCC already knew was a hazard?
--
-- This is the join the two halves of the database exist for. On its own, a
-- report reading "water over the road" is a fact about one street. The same
-- report inside a mapped ponding area is a fact WCC had a modelled reason to
-- expect — and one *outside* every mapped area is the more interesting of the
-- two, because it is the city behaving in a way the planning layers did not
-- predict. That second case is the whole argument for collecting community
-- reports at all.
--
-- Three things this is careful about:
--
-- 1. It is an inference, not a finding. A point falling inside a polygon does
--    not mean the polygon caused it. The view says `basis` out loud and gold
--    never upgrades a report's verification level because of it.
--
-- 2. It joins on the EXACT geometry in silver, not the fuzzed public one. A
--    100m cell straddles a hazard boundary and would produce both false
--    positives and false negatives. The answer is computed privately and only
--    the yes/no is published — which is also why this must be a view over
--    silver rather than something a consumer could reconstruct from gold.
--
-- 3. It publishes a derived fact, not the publisher's geometry, so it is not
--    republishing a dataset we have not cleared. Attribution travels with it
--    anyway, because the finding is only meaningful if you know whose model
--    produced it.

set search_path = public, extensions;

create or replace view gold.report_hazard_context as
select
  r.reference                          as "reference",
  d.id                                 as "datasetId",
  d.display_name                       as "datasetName",
  d.theme                              as "theme",
  d.publisher                          as "publisher",
  d.attribution                        as "attribution",
  d.source_page_url                    as "sourcePageUrl",
  'point-in-polygon against the exact submitted location, computed privately; '
  || 'an inference, not a confirmation that this hazard caused the report'
                                       as "basis"
from silver.report r
join silver.dataset_feature f
  on extensions.st_intersects(f.geom, r.geom)
join silver.dataset d
  on d.id = f.dataset_id
-- Points and lines cannot contain anything. Only area hazards answer this
-- question meaningfully.
where extensions.st_dimension(f.geom) = 2
group by r.reference, d.id, d.display_name, d.theme, d.publisher,
         d.attribution, d.source_page_url;

comment on view gold.report_hazard_context is
  'Which mapped hazard areas a report falls inside. Inferred from the exact location, which never leaves silver.';

grant select on gold.report_hazard_context to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- gold.hazard_context_summary
-- ---------------------------------------------------------------------------
-- The operational read: how much of what is being reported was already
-- expected. A rising share of reports outside every mapped hazard is a signal
-- worth someone's attention.

create or replace view gold.hazard_context_summary as
with matched as (
  select distinct "reference" from gold.report_hazard_context
)
select
  count(*)                                                     as "reportCount",
  count(*) filter (where m."reference" is not null)            as "insideMappedHazard",
  count(*) filter (where m."reference" is null)                as "outsideMappedHazard",
  'Inferred by point-in-polygon against mirrored WCC hazard layers. Layers are '
  || 'planning models, not a record of what is happening now.'  as "basis"
from gold.report r
left join matched m on m."reference" = r."reference";

grant select on gold.hazard_context_summary to anon, authenticated, service_role;
