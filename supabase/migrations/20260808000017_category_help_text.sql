-- Display text for the categories.
--
-- A category had a `label` and nothing else. That was survivable while the
-- labels matched what a reporter would say, and stopped being survivable the
-- moment three pairs were merged: "Surface flooding" does not read as covering
-- waves over a sea wall, and "Power or water outage" does not read as covering
-- a burst main.
--
-- Someone standing at Island Bay watching the sea come over the wall scans the
-- list, does not see their situation, and either picks the wrong box or gives
-- up. Both outcomes cost WCC the report. A merged category has to say what it
-- absorbed.
--
-- Two additions:
--
--   help_text    one line under the label, in the words a reporter would use
--   alsoCovers   derived, not typed — the labels of the retired categories that
--                now resolve here. Nothing to keep in sync, because it comes
--                from superseded_by.

set search_path = public, extensions;

alter table silver.fault_type
  add column if not exists help_text text;

comment on column silver.fault_type.help_text is
  'One line shown under the label. Written in the words a reporter would use, not Council''s.';

-- ---------------------------------------------------------------------------
-- The merged three, where the need is sharpest
-- ---------------------------------------------------------------------------

update silver.fault_type set help_text =
  'Water across a road, footpath or property — including the sea coming over a wall '
  || 'or waves overtopping at high tide.'
 where code = 'surface-flood';

update silver.fault_type set help_text =
  'A road blocked or impassable, including where it is the only way in or out of '
  || 'houses.'
 where code = 'road-closure';

update silver.fault_type set help_text =
  'No power, or no water — including a burst main. Tell us which, so we can send it '
  || 'to the right people.'
 where code = 'service-outage';

-- ---------------------------------------------------------------------------
-- The rest of the emergency categories
-- ---------------------------------------------------------------------------

update silver.fault_type set help_text = 'Earth, mud or rock that has come down, or a bank that is still moving.'
 where code = 'slip';
update silver.fault_type set help_text = 'A tree, branch or large debris down across a road, path or property.'
 where code = 'tree-down';
update silver.fault_type set help_text = 'Damage to Council property or assets after a storm.'
 where code = 'storm-damage';
update silver.fault_type set help_text = 'A building or structure that looks unsafe. If anyone is trapped or hurt, call 111.'
 where code = 'building-damage';
update silver.fault_type set help_text = 'Wastewater overflowing from a manhole, pipe or gully trap.'
 where code = 'sewage-overflow';
update silver.fault_type set help_text = 'Someone needs help. This form cannot dispatch anyone — call 111.'
 where code = 'assistance';
update silver.fault_type set help_text = 'Your hub is open, closed, or needs something. Hub teams only.'
 where code = 'hub-status';
update silver.fault_type set help_text = 'An animal that is a danger to people, or in distress after an event.'
 where code = 'animal-control';
update silver.fault_type set help_text = 'Rubbish or material dumped on Council land, a road or a reserve.'
 where code = 'illegal-dumping';

-- ---------------------------------------------------------------------------
-- Publish it
-- ---------------------------------------------------------------------------
-- `alsoCovers` is derived from superseded_by, so a category merged tomorrow
-- appears here without anyone remembering to write it down.

drop view if exists gold.fault_type;

create view gold.fault_type as
select
  f.code                  as "code",
  f.label                 as "label",
  f.help_text             as "helpText",
  -- What this category absorbed, in the words the old ones used. A reporter
  -- looking for "coastal inundation" needs to see it here or they will not
  -- believe "Surface flooding" is the right box.
  coalesce(
    (select array_agg(o.label order by o.label)
       from silver.fault_type o
      where o.superseded_by = f.code
        -- One retired category kept the exact label the merged one took.
        -- "Also covers: Surface flooding" under "Surface flooding" is noise
        -- that makes a reporter distrust the rest of the list.
        and lower(o.label) is distinct from lower(f.label)),
    '{}'
  )                       as "alsoCovers",
  f.service               as "service",
  f.default_precision     as "locationPrecision",
  f.default_agency_code   as "defaultAgencyCode",
  f.intake_blocked        as "intakeBlocked",
  f.intake_block_reason   as "intakeBlockReason",
  f.ownership             as "ownership",
  f.ownership_note        as "ownershipNote",
  f.default_priority      as "defaultPriority",
  f.is_active             as "isActive",
  f.superseded_by         as "supersededBy",
  f.sort_order            as "sortOrder"
from silver.fault_type f;

comment on view gold.fault_type is
  'Every category, live and retired. Filter isActive for a form; helpText and alsoCovers are the display text; supersededBy tells an old client what its code became.';

grant select on gold.fault_type to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reports carry the help text too
-- ---------------------------------------------------------------------------
-- So a map popup can explain what a category means without a second request.

drop view if exists gold.report_category;

create view gold.report_category as
select
  f.code       as "code",
  f.label      as "label",
  f.help_text  as "helpText",
  s.label      as "serviceLabel",
  s.blurb      as "serviceBlurb",
  f.sort_order as "sortOrder"
from silver.fault_type f
join silver.service s on s.code = f.service
where f.is_active;

comment on view gold.report_category is
  'Flat category list with its service, for building a form in one request.';

grant select on gold.report_category to anon, authenticated, service_role;
