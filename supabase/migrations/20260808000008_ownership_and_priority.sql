-- Who owns the job, and how fast it needs to move.
--
-- Two additions, both of which the existing schema had no place for:
--
--   ownership   whether WCC is the lead agency, shares the job with someone who
--               actually executes it, or is simply recording something another
--               agency owns. A report WCC cannot action is still worth having,
--               but a map that implies WCC is fixing it is worse than useless.
--
--   priority    the 1-4 triage scale (Critical / Urgent / Standard / Low).
--               Called `priority` rather than `status` because `status` already
--               means lifecycle here, and a report can be Critical *and*
--               Completed.
--
-- Both follow the pattern already set by location precision: a default on the
-- fault type, an optional override on the individual report. The category
-- default is the honest starting point — "flooding is usually urgent" — and the
-- override is where a duty officer's judgement about a specific report lives.
-- Ownership needs the override more than anything else does: flooding on a
-- Council road is WCC's, the same flooding inside someone's garage is not.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
-- Deliberately nullable everywhere it appears. Null means "not yet classified",
-- which is a real and common state, and gold says so rather than guessing.

create type silver.ownership as enum (
  'wcc_lead',   -- WCC is the lead agency and executes
  'shared',     -- WCC triages; another party executes or co-leads
  'not_wcc'     -- another agency owns it; WCC records it for awareness
);

comment on type silver.ownership is
  'Who owns the job. Null is a valid state meaning not yet classified — gold publishes that rather than assuming WCC.';

-- ---------------------------------------------------------------------------
-- Priority levels
-- ---------------------------------------------------------------------------
-- A table, not an enum, so the definitions are published to gold alongside the
-- number. "Priority 2" on a map means nothing to a resident; "Urgent —
-- significant safety risk on WCC assets, not immediately life-threatening"
-- does.

create table silver.priority_level (
  level        smallint primary key check (level between 1 and 4),
  code         text not null unique,
  label        text not null,
  definition   text not null
);

insert into silver.priority_level (level, code, label, definition) values
  (1, 'critical', 'Critical / immediate',
      'Imminent threat to life or safety on WCC assets or land, or major infrastructure '
      || 'failure. Requires immediate cordon or mobilisation.'),
  (2, 'urgent', 'Urgent',
      'Significant safety risk or serious service disruption on WCC assets, but not '
      || 'immediately life-threatening.'),
  (3, 'standard', 'Standard',
      'Moderate impact on WCC assets. Needs timely resolution but is not urgent.'),
  (4, 'low', 'Low',
      'Minor issue on WCC assets. No immediate risk; cosmetic or low impact.');

comment on table silver.priority_level is
  'The 1-4 WCC triage scale. Reference data, published to gold in full — the definitions matter as much as the numbers.';

alter table silver.priority_level enable row level security;
revoke all on table silver.priority_level from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Fault type: category-level defaults
-- ---------------------------------------------------------------------------

alter table silver.fault_type
  add column ownership           silver.ownership,
  add column partner_agency_code text references silver.agency (code),
  add column ownership_note      text,
  add column default_priority    smallint references silver.priority_level (level);

comment on column silver.fault_type.ownership is
  'Default ownership for this category. Null means not yet classified.';
comment on column silver.fault_type.partner_agency_code is
  'For shared ownership, the party that executes. WCC still triages; default_agency_code is where the report routes first.';
comment on column silver.fault_type.ownership_note is
  'Plain-English split of responsibility, shown to reporters. Editorial text, deliberately data not code.';
comment on column silver.fault_type.default_priority is
  'Starting triage priority for this category, before a duty officer looks at the individual report.';

-- The service list was written when only the emergency branch existed. Animal
-- control and illegal dumping are business-as-usual services that WCC leads
-- outright, so the constraint has to admit the rest of the reporting taxonomy.
alter table silver.fault_type drop constraint if exists fault_type_service_check;
alter table silver.fault_type add constraint fault_type_service_check check (
  service in (
    'emergency', 'roads', 'water', 'parks', 'animals',
    'street-cleaning', 'street-lights', 'street-furniture',
    'traffic-signs', 'parking', 'graffiti'
  )
);

-- ---------------------------------------------------------------------------
-- Report: per-report overrides
-- ---------------------------------------------------------------------------

alter table silver.report
  add column ownership_override silver.ownership,
  add column priority_override  smallint references silver.priority_level (level),
  add column on_council_land    boolean,
  add column triage_note        text;

comment on column silver.report.ownership_override is
  'Set by triage when this report does not match its category default — e.g. flooding wholly on private land.';
comment on column silver.report.priority_override is
  'Triaged priority. Where null, the category default applies and gold says the priority is a category default, not an assessment.';
comment on column silver.report.on_council_land is
  'Whether the issue is on WCC land or assets, once someone has checked. Null means nobody has. Drives ownership more than the category does.';

create index report_priority_override_idx on silver.report (priority_override);

-- ---------------------------------------------------------------------------
-- Deriving the effective values
-- ---------------------------------------------------------------------------
-- These read silver.fault_type, so they are SECURITY DEFINER: gold's views are
-- readable by anon, but anon has no privilege on silver and must not gain one
-- just because a view calls a helper. The definer owns silver, the caller still
-- cannot reach it, and neither function returns anything not already in gold.

create or replace function silver.effective_ownership(
  fault_type_code text,
  override silver.ownership
)
returns silver.ownership
language sql
stable
security definer
set search_path = silver, public, extensions
as $$
  select coalesce(
    override,
    (select ft.ownership from silver.fault_type ft where ft.code = fault_type_code)
  );
$$;

comment on function silver.effective_ownership is
  'Report override if set, otherwise the fault type default. Returns null when neither is classified.';

-- Priority and the reason for it travel together. A number on its own invites
-- the reader to assume a human set it; most of the time nobody has yet.
create type silver.priority_assessment as (
  priority smallint,
  basis    text
);

create or replace function silver.assess_priority(
  fault_type_code text,
  severity text,
  override smallint
)
returns silver.priority_assessment
language sql
stable
security definer
set search_path = silver, public, extensions
as $$
  with base as (
    select coalesce(
             (select ft.default_priority from silver.fault_type ft where ft.code = fault_type_code),
             3::smallint
           ) as p
  )
  select case
    when override is not null then
      row(override, 'triaged')::silver.priority_assessment
    -- A reporter saying "urgent" is evidence, not an assessment, so it lifts the
    -- category default by one step and no further. Priority 1 commits WCC to an
    -- immediate cordon or mobilisation and is never reached automatically.
    when severity = 'urgent' and base.p > 2 then
      row((base.p - 1)::smallint, 'raised_by_reported_severity')::silver.priority_assessment
    else
      row(base.p, 'category_default')::silver.priority_assessment
  end
  from base;
$$;

comment on function silver.assess_priority is
  'Effective priority and how it was arrived at. Never returns priority 1 unless a human triaged it.';

-- Same treatment for the two helpers gold already depended on. effective_precision
-- reads silver.fault_type and fuzz_point is called by every gold view; without
-- these, anon selecting from gold.report fails on a permission check against
-- silver rather than returning the filtered projection it is entitled to.
create or replace function silver.effective_precision(
  fault_type_code text,
  override silver.location_precision
)
returns silver.location_precision
language sql
stable
security definer
set search_path = silver, public, extensions
as $$
  select coalesce(
    override,
    (select ft.default_precision from silver.fault_type ft where ft.code = fault_type_code),
    'zone_100m'::silver.location_precision
  );
$$;

-- ---------------------------------------------------------------------------
-- gold labels
-- ---------------------------------------------------------------------------

create or replace function gold.ownership_label(o silver.ownership)
returns text
language sql
immutable
parallel safe
as $$
  select case o
    when 'wcc_lead' then 'Wellington City Council leads'
    when 'shared'   then 'Shared — WCC triages, a partner agency delivers'
    when 'not_wcc'  then 'Another agency leads; WCC is recording it'
    else 'Not yet classified'
  end;
$$;

create or replace function gold.priority_label(p smallint)
returns text
language sql
stable
security definer
set search_path = silver, public, extensions
as $$
  select pl.label from silver.priority_level pl where pl.level = p;
$$;

create or replace function gold.priority_basis_label(b text)
returns text
language sql
immutable
parallel safe
as $$
  select case b
    when 'triaged'                     then 'Assessed by WCC'
    when 'raised_by_reported_severity' then 'Category default, raised one step because the reporter marked it urgent'
    when 'category_default'            then 'Category default — not yet assessed by WCC'
  end;
$$;

comment on function gold.priority_basis_label is
  'Published next to every priority. If the number was inferred rather than assessed, the interface has to say so.';

-- ---------------------------------------------------------------------------
-- gold.priority_level
-- ---------------------------------------------------------------------------

create or replace view gold.priority_level as
select
  pl.level      as "level",
  pl.code       as "code",
  pl.label      as "label",
  pl.definition as "definition"
from silver.priority_level pl
order by pl.level;

-- ---------------------------------------------------------------------------
-- gold.fault_type, rebuilt
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced so the ownership columns sit next to the routing
-- they explain instead of trailing off the end.

drop view if exists gold.fault_type;

create view gold.fault_type as
select
  f.code                                 as "code",
  f.label                                as "label",
  f.service                              as "service",
  f.default_precision                    as "locationPrecision",
  f.default_agency_code                  as "defaultAgencyCode",
  f.ownership                            as "ownership",
  gold.ownership_label(f.ownership)      as "ownershipLabel",
  f.partner_agency_code                  as "partnerAgencyCode",
  f.ownership_note                       as "ownershipNote",
  f.default_priority                     as "defaultPriority",
  gold.priority_label(f.default_priority) as "defaultPriorityLabel",
  f.sort_order                           as "sortOrder"
from silver.fault_type f
where f.is_active;

comment on view gold.fault_type is
  'The reportable categories, with who owns each one and how urgently it is normally treated.';

-- ---------------------------------------------------------------------------
-- gold.report, rebuilt
-- ---------------------------------------------------------------------------
-- Same filter as before — reporter name, contact and device hash still have no
-- path here — plus the ownership and priority block.

drop view if exists gold.report;

create view gold.report as
with resolved as (
  select
    r.*,
    silver.effective_precision(r.fault_type, r.precision_override) as prec,
    silver.effective_ownership(r.fault_type, r.ownership_override) as own,
    pa.priority                                                    as priority,
    pa.basis                                                       as priority_basis,
    ft.label            as fault_label,
    ft.ownership_note   as ownership_note,
    ag.name             as agency_name,
    ag.code             as agency_code,
    pag.name            as partner_agency_name,
    pag.code            as partner_agency_code,
    h.name              as hub_name
  from silver.report r
  join silver.fault_type ft on ft.code = r.fault_type
  left join silver.agency ag on ag.id = r.assigned_agency_id
  left join silver.agency pag on pag.code = ft.partner_agency_code
  left join silver.hub h on h.id = r.hub_id
  cross join lateral silver.assess_priority(r.fault_type, r.severity, r.priority_override) pa
)
select
  'report'::text                                  as "kind",
  r.reference                                     as "reference",
  r.service                                       as "service",
  r.fault_type                                    as "faultType",
  r.fault_label                                   as "faultLabel",

  case when r.pii_reviewed then coalesce(r.description_public, r.fault_desc) end
                                                  as "description",
  case when r.pii_reviewed then 'published' else 'withheld_pending_review' end
                                                  as "descriptionStatus",

  case when r.prec = 'street' then r.loc_address end
                                                  as "address",
  r.loc_suburb                                    as "suburb",
  r.severity                                      as "severity",
  r.reporter_kind                                 as "reporterKind",
  r.hub_name                                      as "hubName",

  r.current_status                                as "status",
  -- The nearest of the five StatusIds in prototype/lib/types.ts, so the app and
  -- its GeoJSON feed keep working against the eight-state lifecycle.
  gold.legacy_status(r.current_status)            as "legacyStatus",
  gold.status_label(r.current_status, r.agency_name) as "statusLabel",
  r.current_status_note                           as "statusNote",
  r.agency_code                                   as "assignedAgencyCode",
  r.agency_name                                   as "assignedAgency",
  r.status_updated_at                             as "statusUpdatedAt",

  -- Who owns it. `ownershipSource` matters: a category default is a guess about
  -- this report, and only a triaged override is a statement about it.
  r.own                                           as "ownership",
  gold.ownership_label(r.own)                     as "ownershipLabel",
  case when r.ownership_override is not null then 'triaged' else 'category_default' end
                                                  as "ownershipSource",
  r.ownership_note                                as "ownershipNote",
  r.partner_agency_code                           as "partnerAgencyCode",
  r.partner_agency_name                           as "partnerAgency",
  r.on_council_land                               as "onCouncilLand",

  -- How urgent WCC considers it, and whether anyone has actually decided.
  r.priority                                      as "priority",
  gold.priority_label(r.priority)                 as "priorityLabel",
  r.priority_basis                                as "priorityBasis",
  gold.priority_basis_label(r.priority_basis)     as "priorityBasisLabel",

  r.observed_at                                   as "observedAt",
  r.submitted_at                                  as "submittedAt",
  r.photo_count                                   as "photoCount",

  r.verification_level                            as "verificationLevel",
  r.prec                                          as "locationPrecision",
  r.is_synthetic                                  as "isSynthetic",
  gold.disclaimer_for(r.verification_level, r.is_synthetic) as "disclaimer",

  extensions.st_y(silver.fuzz_point(r.geom, r.prec)) as "lat",
  extensions.st_x(silver.fuzz_point(r.geom, r.prec)) as "lng"
from resolved r;

comment on view gold.report is
  'Public view of community reports. PII removed, coordinates fuzzed per fault type, and ownership, priority, verification and synthetic state all explicit.';

-- ---------------------------------------------------------------------------
-- gold.report_cluster, rebuilt
-- ---------------------------------------------------------------------------
-- A cluster takes the priority of its most urgent member. Five Standard reports
-- of the same thing do not make an Urgent one, but one Urgent report inside a
-- cluster must not be buried by the four Standard ones around it.

drop view if exists gold.report_cluster;

create view gold.report_cluster as
select
  c.id                                            as "id",
  c.fault_type                                    as "faultType",
  ft.label                                        as "faultLabel",
  ft.ownership                                    as "ownership",
  gold.ownership_label(ft.ownership)              as "ownershipLabel",
  c.suburb                                        as "suburb",
  c.member_count                                  as "reportCount",
  c.first_seen_at                                 as "firstSeenAt",
  c.last_seen_at                                  as "lastSeenAt",
  min(case when r.id is null then null
           else (silver.assess_priority(r.fault_type, r.severity, r.priority_override)).priority
      end)                                        as "priority",
  gold.priority_label(
    min(case when r.id is null then null
             else (silver.assess_priority(r.fault_type, r.severity, r.priority_override)).priority
        end)
  )                                               as "priorityLabel",
  extensions.st_y(silver.fuzz_point(c.centroid_geom, 'zone_100m')) as "lat",
  extensions.st_x(silver.fuzz_point(c.centroid_geom, 'zone_100m')) as "lng",
  bool_or(r.is_synthetic)                         as "isSynthetic"
from silver.report_cluster c
join silver.fault_type ft on ft.code = c.fault_type
left join silver.report_cluster_member m on m.cluster_id = c.id
left join silver.report r on r.id = m.report_id
group by c.id, c.fault_type, ft.label, ft.ownership, c.suburb, c.member_count,
         c.first_seen_at, c.last_seen_at, c.centroid_geom;

-- ---------------------------------------------------------------------------
-- gold.reports_geojson, re-signed
-- ---------------------------------------------------------------------------
-- Two new filters. `max_priority` is the one an operations picture actually
-- wants: "show me 1s and 2s". Dropped and recreated rather than overloaded, so
-- PostgREST has exactly one candidate to resolve a call against.

-- Drop every overload, whatever its signature. An earlier migration in this
-- series has already re-signed this function once; naming one signature here
-- would leave the other behind, and PostgREST cannot resolve a call against two
-- candidates.
do $drop$
declare fn record;
begin
  for fn in
    select oid::regprocedure as sig
    from pg_proc
    where pronamespace = 'gold'::regnamespace and proname = 'reports_geojson'
  loop
    execute format('drop function %s', fn.sig);
  end loop;
end
$drop$;

create or replace function gold.reports_geojson(
  bbox              double precision[] default null,
  since             timestamptz default null,
  statuses          text[] default null,
  fault_types       text[] default null,
  service           text default null,
  ownerships        text[] default null,
  max_priority      integer default null,
  include_synthetic boolean default true,
  arcgis            boolean default false,
  max_features      integer default 2000
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with filtered as (
    select *
    from gold.report r
    where (since is null or r."observedAt" >= since)
      and (statuses is null or r."status"::text = any (statuses)
                            or r."legacyStatus" = any (statuses))
      and (fault_types is null or r."faultType" = any (fault_types))
      and (reports_geojson.service is null or r."service" = reports_geojson.service)
      and (include_synthetic or not r."isSynthetic")
      and (max_priority is null or r."priority" <= max_priority)
      -- 'unclassified' matches the rows nothing has been decided about, so a
      -- consumer can ask for them specifically rather than losing them.
      and (
        ownerships is null
        or coalesce(r."ownership"::text, 'unclassified') = any (ownerships)
      )
      and (
        bbox is null
        or (r."lng" between bbox[1] and bbox[3] and r."lat" between bbox[2] and bbox[4])
      )
    order by r."priority", r."observedAt" desc
    limit greatest(1, least(coalesce(max_features, 2000), 10000))
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'metadata', jsonb_build_object(
      'source', 'Impact Lab Wellington Team 5 — community reporting prototype',
      'generatedAt', now(),
      'featureCount', (select count(*) from filtered),
      'disclaimer', 'Community-submitted reports. Locations are deliberately coarsened; '
                    || 'see locationPrecision on each feature. Priority is WCC triage: where '
                    || 'priorityBasis is not "triaged" it is a category default, not an '
                    || 'assessment of this report. Not an operational emergency source. In an '
                    || 'emergency call 111.'
    ),
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', jsonb_build_object(
            'type', 'Point',
            'coordinates', jsonb_build_array(f."lng", f."lat")
          ),
          'properties', to_jsonb(f) - 'lat' - 'lng'
        )
      )
      from filtered f
    ), '[]'::jsonb)
  ) - (case when arcgis then 'metadata' else '' end);
$$;

comment on function gold.reports_geojson is
  'Community reports as a ready-to-render GeoJSON FeatureCollection. bbox is [west, south, east, north] in WGS84; max_priority filters to 1..n; ownerships accepts wcc_lead, shared, not_wcc, unclassified.';

-- ---------------------------------------------------------------------------
-- gold.report_receipt, extended
-- ---------------------------------------------------------------------------
-- The reporter-facing half. "Received" was always a thin acknowledgement; "WCC
-- leads this, priority Urgent" is the one that answers what a resident actually
-- wants to know.

create or replace function gold.report_receipt(reference text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select case
    when r."reference" is null then
      jsonb_build_object('found', false, 'reference', report_receipt.reference)
    else
      jsonb_build_object(
        'found', true,
        'reference', r."reference",
        'status', r."status",
        'statusLabel', r."statusLabel",
        'assignedAgency', r."assignedAgency",
        'ownership', r."ownership",
        'ownershipLabel', r."ownershipLabel",
        'ownershipNote', r."ownershipNote",
        'partnerAgency', r."partnerAgency",
        'priority', r."priority",
        'priorityLabel', r."priorityLabel",
        'priorityBasis', r."priorityBasis",
        'priorityBasisLabel', r."priorityBasisLabel",
        'faultLabel', r."faultLabel",
        'suburb', r."suburb",
        'submittedAt', r."submittedAt",
        'statusUpdatedAt', r."statusUpdatedAt",
        'verificationLevel', r."verificationLevel",
        'isSynthetic', r."isSynthetic",
        'disclaimer', r."disclaimer",
        'history', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'status', h."status",
              'statusLabel', h."statusLabel",
              'note', h."note",
              'agency', h."agency",
              'externalTicketRef', h."externalTicketRef",
              'at', h."at"
            ) order by h."at"
          )
          from gold.report_status_history h
          where h."reference" = r."reference"
        ), '[]'::jsonb)
      )
  end
  from (select * from gold.report where "reference" = report_receipt.reference) r
  right join (select 1) dummy on true;
$$;

-- ---------------------------------------------------------------------------
-- silver.triage_report
-- ---------------------------------------------------------------------------
-- The WCC-side write path. Not in gold and not granted to anon or
-- authenticated: triage is a Council judgement and the public cannot set it.
-- Every call that changes the lifecycle also writes to the append-only log, so
-- the resident's receipt reflects it immediately.

create or replace function silver.triage_report(
  p_reference       text,
  p_priority        smallint default null,
  p_ownership       silver.ownership default null,
  p_on_council_land boolean default null,
  p_status          silver.report_status default null,
  p_agency_code     text default null,
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  r         silver.report%rowtype;
  agency_id smallint;
begin
  select * into r from silver.report where reference = p_reference;
  if not found then
    raise exception 'No report with reference %.', p_reference using errcode = '22023';
  end if;

  if p_agency_code is not null then
    select a.id into agency_id from silver.agency a where a.code = p_agency_code;
    if agency_id is null then
      raise exception 'Unknown agency code %.', p_agency_code using errcode = '22023';
    end if;
  end if;

  update silver.report
     set priority_override  = coalesce(p_priority, priority_override),
         ownership_override = coalesce(p_ownership, ownership_override),
         on_council_land    = coalesce(p_on_council_land, on_council_land),
         triage_note        = coalesce(p_note, triage_note)
   where id = r.id;

  -- A status change is an event, not an edit. Priority-only triage leaves the
  -- lifecycle where it was.
  if p_status is not null then
    insert into silver.report_status_event (report_id, status, note, actor_role, actor_agency_id)
    values (r.id, p_status, p_note, 'wcc_duty_officer', agency_id);
  end if;

  return (select gold.report_receipt(p_reference));
end;
$$;

comment on function silver.triage_report is
  'WCC-side triage: set priority, ownership and lifecycle for a report. Never reachable by anon — silver is not an exposed schema.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

grant select on gold.priority_level to anon, authenticated;
grant select on gold.report         to anon, authenticated;
grant select on gold.report_cluster to anon, authenticated;
grant select on gold.fault_type     to anon, authenticated;

grant execute on function gold.reports_geojson(
  double precision[], timestamptz, text[], text[], text, text[], integer,
  boolean, boolean, integer
) to anon, authenticated;

-- The gold views call these at execution time as the querying role, so anon
-- needs EXECUTE on them or gold.report fails outright. Granting costs nothing:
-- silver is absent from config.toml's exposed schemas, so none of them is
-- reachable over HTTP, and each returns only values gold already publishes.
grant execute on function silver.fuzz_point(geometry, silver.location_precision)
  to anon, authenticated;
grant execute on function silver.effective_precision(text, silver.location_precision)
  to anon, authenticated;
grant execute on function silver.effective_ownership(text, silver.ownership)
  to anon, authenticated;
grant execute on function silver.assess_priority(text, text, smallint)
  to anon, authenticated;
grant execute on function gold.priority_label(smallint) to anon, authenticated;
grant execute on function gold.ownership_label(silver.ownership) to anon, authenticated;
grant execute on function gold.priority_basis_label(text) to anon, authenticated;

-- Triage is not public in either direction.
revoke all on function silver.triage_report(
  text, smallint, silver.ownership, boolean, silver.report_status, text, text
) from anon, authenticated, public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function silver.triage_report(
               text, smallint, silver.ownership, boolean, silver.report_status, text, text
             ) to service_role';
  end if;
end;
$$;
