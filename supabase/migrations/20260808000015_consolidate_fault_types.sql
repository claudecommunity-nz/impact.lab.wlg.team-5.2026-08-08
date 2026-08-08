-- Consolidate three pairs of fault types that were splitting one thing a
-- reporter experiences into two boxes they had to choose between.
--
--   flooding    + coastal    -> surface-flood
--   road-blocked + access-cut -> road-closure
--   power-out   + water-out  -> service-outage
--
-- Someone standing in front of water coming over a sea wall onto a road should
-- not have to decide whether that is "flooding" or "coastal inundation" before
-- they can tell anyone. Fewer, clearer categories mean more reports and fewer
-- miscategorised ones.
--
-- Three things are lost in the merge if nobody looks. Each is handled below
-- rather than absorbed:
--
--   1. access-cut was published at zone_100m and road-blocked at street.
--      Merging naively would republish two already-filed reports about
--      households with no vehicle access at street precision. Privacy is never
--      relaxed retroactively, so those reports keep zone_100m as an override.
--
--   2. power-out routed to Wellington Electricity and water-out to Tiaki Wai.
--      One merged category cannot route to both from the category alone, so it
--      routes to neither and says so, rather than confidently sending every
--      water fault to the power company.
--
--   3. flooding was classified wcc_lead; coastal was deliberately left
--      unclassified because responsibility splits between WCC seawalls and
--      GWRC's regional coastal role. The merged row keeps wcc_lead, which is
--      right for the common case, and carries the split in its ownership note.
--
-- Old codes are kept as inactive aliases rather than deleted. prototype/lib/
-- taxonomy.ts still offers them, anything already integrated still sends them,
-- and gold.submit_report resolves them — so this is not a breaking change for
-- any existing client.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Aliasing
-- ---------------------------------------------------------------------------

alter table silver.fault_type
  add column if not exists superseded_by text references silver.fault_type (code);

comment on column silver.fault_type.superseded_by is
  'Set when a category was merged into another. Intake still accepts the old code and stores the new one.';

-- ---------------------------------------------------------------------------
-- The merged categories
-- ---------------------------------------------------------------------------

insert into silver.fault_type (
  code, label, service, default_precision, default_agency_code,
  ownership, partner_agency_code, ownership_note, default_priority, sort_order
) values

  ('surface-flood', 'Surface flooding', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for flooding on Council land, roads and assets. Where the water is '
   || 'coming over a sea wall or off the coast, responsibility splits between WCC '
   || '(seawalls, roads, reserves) and GWRC (regional coastal) depending on the '
   || 'asset. Flooding confined to private property is the owner''s responsibility.',
   2, 10),

  ('road-closure', 'Road closed or impassable', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for road hazards on the local network. State highways are NZTA. '
   || 'Where the blockage is on a private access way rather than a Council road, '
   || 'it is the owner''s responsibility — and where it cuts off dwellings, the '
   || 'report is published at reduced precision.',
   2, 12),

  -- Deliberately unclassified. Power is Wellington Electricity's network and
  -- WCC only records it; water is a WCC asset that Tiaki Wai repairs. One
  -- category cannot carry both, and guessing would put a confident owner on the
  -- map for a job nobody has accepted.
  ('service-outage', 'Power or water outage', 'emergency', 'street', null,
   null, null,
   'Not yet classified, because it depends which service is out. Power: '
   || 'Wellington Electricity owns and restores the network, WCC records outages '
   || 'for awareness only. Water: WCC owns the asset and Tiaki Wai dispatches the '
   || 'repair crew. Triage sets the owner per report.',
   2, 18)

on conflict (code) do update
  set label               = excluded.label,
      service             = excluded.service,
      default_precision   = excluded.default_precision,
      default_agency_code = excluded.default_agency_code,
      ownership           = excluded.ownership,
      partner_agency_code = excluded.partner_agency_code,
      ownership_note      = excluded.ownership_note,
      default_priority    = excluded.default_priority,
      sort_order          = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Preserve the protection the merge would otherwise drop
-- ---------------------------------------------------------------------------
-- Runs BEFORE the remap, while these reports can still be identified by their
-- original category. "Six houses up the lane have no vehicle access" stays a
-- 100m cell.

update silver.report
   set precision_override = 'zone_100m'
 where fault_type = 'access-cut'
   and precision_override is null;

-- ---------------------------------------------------------------------------
-- Remap
-- ---------------------------------------------------------------------------

update silver.report        set fault_type = 'surface-flood'  where fault_type in ('flooding', 'coastal');
update silver.report        set fault_type = 'road-closure'   where fault_type in ('road-blocked', 'access-cut');
update silver.report        set fault_type = 'service-outage' where fault_type in ('power-out', 'water-out');

update silver.report_cluster set fault_type = 'surface-flood'  where fault_type in ('flooding', 'coastal');
update silver.report_cluster set fault_type = 'road-closure'   where fault_type in ('road-blocked', 'access-cut');
update silver.report_cluster set fault_type = 'service-outage' where fault_type in ('power-out', 'water-out');

-- ---------------------------------------------------------------------------
-- Retire the old codes without breaking anyone
-- ---------------------------------------------------------------------------

update silver.fault_type set superseded_by = 'surface-flood',  is_active = false where code in ('flooding', 'coastal');
update silver.fault_type set superseded_by = 'road-closure',   is_active = false where code in ('road-blocked', 'access-cut');
update silver.fault_type set superseded_by = 'service-outage', is_active = false where code in ('power-out', 'water-out');

-- ---------------------------------------------------------------------------
-- Intake resolves aliases
-- ---------------------------------------------------------------------------
-- A client sending 'flooding' gets a report stored as 'surface-flood' and is
-- told so in the response, rather than being rejected for using a code the form
-- it was built against still offers.

create or replace function gold.submit_report(
  service             text,
  "faultType"         text,
  "faultDesc"         text,
  "locLatitude"       double precision,
  "locLongitude"      double precision,
  severity            text default 'info',
  "locAddress"        text default null,
  "locSuburb"         text default null,
  "reporterKind"      text default 'resident',
  "hubName"           text default null,
  "contactFirstName"  text default null,
  "contactLastName"   text default null,
  "contactEmail"      text default null,
  "contactPhone"      text default null,
  "attachmentUploadKeys" text[] default '{}',
  "observedAt"        timestamptz default null,
  "sourceChannel"     text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  new_ref      text;
  requested    silver.fault_type%rowtype;
  ft           silver.fault_type%rowtype;
  matched_hub  smallint;
  was_remapped boolean := false;
begin
  select * into requested from silver.fault_type f where f.code = submit_report."faultType";
  if not found then
    raise exception 'Unknown fault type %. See gold.fault_type for the valid list.',
      submit_report."faultType" using errcode = '22023';
  end if;

  if requested.superseded_by is not null then
    select * into ft from silver.fault_type f where f.code = requested.superseded_by;
    was_remapped := true;
  else
    ft := requested;
  end if;

  if not ft.is_active then
    raise exception 'Fault type % is no longer accepted.', ft.code using errcode = '22023';
  end if;

  -- Life-safety categories are refused at the database, not just hidden in the
  -- form. A prototype that quietly absorbs one of these would be worse than no
  -- prototype at all.
  if ft.intake_blocked then
    raise exception '%', coalesce(
      ft.intake_block_reason,
      'This cannot be reported through this channel. In an emergency call 111.'
    ) using errcode = '22023';
  end if;

  if ft.service is distinct from submit_report.service then
    raise exception 'Fault type % belongs to service %, not %.',
      ft.code, ft.service, submit_report.service using errcode = '22023';
  end if;

  if "locLatitude" is null or "locLongitude" is null then
    raise exception 'A report needs a location.' using errcode = '22023';
  end if;

  if "locLatitude" not between -42.2 and -40.6
     or "locLongitude" not between 174.2 and 175.6 then
    raise exception 'Location %, % is outside the Wellington region.',
      "locLatitude", "locLongitude" using errcode = '22023';
  end if;

  if severity not in ('info', 'disruption', 'urgent') then
    raise exception 'severity must be one of info, disruption, urgent.' using errcode = '22023';
  end if;

  if "contactEmail" is not null and "contactEmail" !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Please provide a valid email address.' using errcode = '22023';
  end if;

  if "hubName" is not null then
    select h.id into matched_hub from silver.hub h where h.name = "hubName" limit 1;
  end if;

  new_ref := silver.generate_reference();

  insert into silver.report (
    reference, subject, service, fault_type, severity, fault_desc,
    geom, loc_address, loc_suburb,
    -- A merged category inherits the stricter of the two precisions it came
    -- from. 'access-cut' arriving under its old code still gets a 100m cell.
    precision_override,
    reporter_kind, contact_first_name, contact_last_name, contact_email, contact_phone,
    hub_id, attachment_upload_keys, photo_count,
    observed_at, submitted_at,
    source_channel, is_synthetic,
    description_public, pii_reviewed
  ) values (
    new_ref, 'Community report', ft.service, ft.code, severity, "faultDesc",
    extensions.st_setsrid(extensions.st_makepoint("locLongitude", "locLatitude"), 4326),
    "locAddress", "locSuburb",
    case when requested.default_precision = 'zone_100m'
          and ft.default_precision <> 'zone_100m'
         then 'zone_100m'::silver.location_precision end,
    "reporterKind"::silver.reporter_kind,
    "contactFirstName", "contactLastName", "contactEmail", "contactPhone",
    matched_hub, coalesce("attachmentUploadKeys", '{}'),
    coalesce(array_length("attachmentUploadKeys", 1), 0),
    coalesce("observedAt", now()), now(),
    "sourceChannel", false,
    null, false
  );

  return jsonb_build_object(
    'reference', new_ref,
    'status', 'received',
    'legacyStatus', 'received',
    'statusLabel', 'Received',
    'receivedAt', now(),
    'faultType', ft.code,
    'faultLabel', ft.label,
    'faultTypeRemapped', was_remapped,
    'message', 'We have your report. It is in the queue to be looked at. Keep this reference '
               || 'to check progress: ' || new_ref,
    'disclaimer', 'This is a prototype, not an operational emergency service. '
                  || 'In an emergency call 111.'
  );
end;
$$;

grant execute on function gold.submit_report(
  text, text, text, double precision, double precision, text, text, text,
  text, text, text, text, text, text, text[], timestamptz, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Publish the aliases
-- ---------------------------------------------------------------------------
-- A client building a form needs the live list; a client holding an old code
-- needs to know what it became. Both come from one view.

-- Dropped rather than replaced: `create or replace view` cannot add a column in
-- the middle of the list, and this adds ownership, priority and the alias.
drop view if exists gold.fault_type;

create view gold.fault_type as
select
  f.code                  as "code",
  f.label                 as "label",
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
  'Every category, live and retired. Filter on isActive for a form; supersededBy tells an old client what its code became.';

grant select on gold.fault_type to anon, authenticated, service_role;

-- Clusters were built from the pre-merge categories, so reports that were
-- 'flooding' and 'coastal' on the same stretch of coast were never grouped.
-- They are one incident and now group as one.
select silver.rebuild_clusters();
