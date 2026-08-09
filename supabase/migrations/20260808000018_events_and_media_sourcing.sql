-- Real incidents, from published journalism.
--
-- Everything in the database so far was either community-submitted or invented
-- for the demo. This is neither: twelve incidents from the 20 April 2026
-- Wellington floods, each traceable to a named publication and a URL.
--
-- That distinction has to survive into the API, because all three are true in
-- different ways and a consumer who cannot tell them apart will use them
-- wrongly:
--
--   is_synthetic = true      invented. Did not happen.
--   media_reported           happened, reported by journalists, not confirmed
--                            by WCC. Attributable to a source.
--   community-submitted      someone says it is happening. Unverified until
--                            corroborated or checked.
--
-- A media-reported incident is NOT a community report and must not be counted
-- as one. It is the record of an event, assembled after the fact from what was
-- published — which is exactly the "we only found out from the news" gap this
-- problem statement is about closing.
--
-- Four additions:
--
--   silver.event          a named emergency these incidents belong to
--   source provenance     publication, article URL, image URL, per report
--   silver.public_advice  the official NEMA / Civil Defence advice for a hazard
--                         type. This is the other direction of the two-way
--                         channel, and it is the half nobody usually builds.
--   many-to-many agencies a slip that collapses a house is Roads AND Building
--                         Control AND FENZ. One column could not say that.

set search_path = public, extensions;

-- `provenance` is a separate axis from `verification_level`, and conflating them
-- was the first attempt at this. Where a report came from and how confirmed it
-- is are different facts: a media-reported incident is well-sourced but not
-- Council-confirmed, and a community report can be field-confirmed. One column
-- cannot carry both without lying about one of them.
--
-- (It also avoids extending an enum, which Postgres will not let you use in the
-- transaction that adds it — the error that prompted the rethink.)
create type silver.provenance as enum ('community', 'media', 'synthetic', 'council');

comment on type silver.provenance is
  'Where a report came from. Orthogonal to verification_level, which is how confirmed it is.';

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table if not exists silver.event (
  code                 text primary key,
  name                 text not null,
  started_at           timestamptz,
  ended_at             timestamptz,
  description          text,
  state_of_emergency   boolean not null default false,
  created_at           timestamptz not null default now()
);

alter table silver.event enable row level security;
revoke all on silver.event from anon, authenticated, public;

alter table silver.report
  add column if not exists event_code        text references silver.event (code),
  add column if not exists sub_event_code    text,
  add column if not exists source_url        text,
  add column if not exists source_publication text,
  add column if not exists image_source_url  text,
  -- A slip that undercuts a house is a slip and a structural failure. The
  -- primary type routes it; the rest are recorded rather than discarded.
  add column if not exists additional_fault_types text[] not null default '{}',
  add column if not exists provenance silver.provenance not null default 'community';

-- 'media' is a real intake channel here: WCC found out from the news. Recording
-- it as anything else would hide the exact gap this project is about.
alter table silver.report drop constraint if exists report_source_channel_check;
alter table silver.report add constraint report_source_channel_check
  check (source_channel in ('web', 'sms', 'phone', 'hub_radio', 'social', 'seed', 'media'));

create index if not exists report_event_idx on silver.report (event_code);

comment on column silver.report.source_publication is
  'Who published this, when the report came from media rather than a resident. Never null for media_reported.';

-- ---------------------------------------------------------------------------
-- Assigned agencies, plural
-- ---------------------------------------------------------------------------

create table if not exists silver.report_agency (
  report_id   uuid not null references silver.report (id) on delete cascade,
  agency_code text not null references silver.agency (code),
  role        text not null default 'assigned'
                check (role in ('lead', 'assigned', 'supporting', 'life_safety')),
  primary key (report_id, agency_code)
);

alter table silver.report_agency enable row level security;
revoke all on silver.report_agency from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Public advice
-- ---------------------------------------------------------------------------
-- WCC sends information out and communities send it in; the problem statement
-- asks for both. This is the outbound half: the official advice for a hazard,
-- attributed to NEMA / Civil Defence with the URL it came from, so a map popup
-- about a slip can carry "what to do about a slip" without anyone inventing
-- safety guidance.
--
-- Never write advice into this table that did not come from an official source.
-- Plausible-sounding safety advice from a hackathon prototype is worse than
-- none.

create table if not exists silver.public_advice (
  id           bigint generated always as identity primary key,
  fault_type   text references silver.fault_type (code),
  advice       text not null,
  publisher    text not null default 'National Emergency Management Agency (Civil Defence)',
  source_url   text not null,
  created_at   timestamptz not null default now(),
  unique (fault_type, source_url)
);

alter table silver.public_advice enable row level security;
revoke all on silver.public_advice from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Published
-- ---------------------------------------------------------------------------

create or replace view gold.event as
select
  e.code                as "code",
  e.name                as "name",
  e.started_at          as "startedAt",
  e.ended_at            as "endedAt",
  e.description         as "description",
  e.state_of_emergency  as "stateOfEmergency",
  (select count(*) from silver.report r where r.event_code = e.code) as "reportCount"
from silver.event e;

grant select on gold.event to anon, authenticated, service_role;

create or replace view gold.public_advice as
select
  a.fault_type  as "faultType",
  f.label       as "faultLabel",
  a.advice      as "advice",
  a.publisher   as "publisher",
  a.source_url  as "sourceUrl"
from silver.public_advice a
left join silver.fault_type f on f.code = a.fault_type;

comment on view gold.public_advice is
  'Official NEMA / Civil Defence advice per hazard type, with its source. Never write anything here that did not come from an official publisher.';

grant select on gold.public_advice to anon, authenticated, service_role;

create or replace view gold.report_agency as
select
  r.reference   as "reference",
  a.code        as "agencyCode",
  a.name        as "agency",
  ra.role       as "role"
from silver.report_agency ra
join silver.report r on r.id = ra.report_id
join silver.agency a on a.code = ra.agency_code;

grant select on gold.report_agency to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The disclaimer has to cover the new case
-- ---------------------------------------------------------------------------
-- A media-reported incident is not an unverified rumour and it is not a Council
-- confirmation. Saying which, and naming who published it, is the whole point.

create or replace function gold.disclaimer_for(
  v silver.verification_level,
  synthetic boolean,
  prov silver.provenance default 'community'
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when synthetic then
      'Synthetic demonstration data generated for a hackathon prototype. Not a real report. '
      || 'Not an operational emergency source. In an emergency call 111.'
    when prov = 'media' then
      'Compiled from published news reporting of a real event, not from a community report '
      || 'and not confirmed by Wellington City Council. See sourcePublication and sourceUrl. '
      || 'Not an operational emergency source. In an emergency call 111.'
    when v = 'unverified' then
      'Unverified community reports submitted to a hackathon prototype. Not an operational '
      || 'emergency source, not confirmed by Wellington City Council. In an emergency call 111.'
    when v = 'corroborated' then
      'Community report corroborated by other nearby reports but not confirmed by Wellington '
      || 'City Council. Not an operational emergency source. In an emergency call 111.'
    when v = 'field_confirmed' then
      'Community report confirmed on the ground. Prototype data, not an operational emergency '
      || 'source. In an emergency call 111.'
    when v = 'official' then
      'Confirmed by Wellington City Council or the responding agency. Prototype data, not an '
      || 'operational emergency source. In an emergency call 111.'
  end;
$$;

update silver.report set provenance = 'synthetic' where is_synthetic;

-- gold.report has to carry the new facts, or none of this is reachable.
create or replace view gold.report as
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
  gold.disclaimer_for(r.verification_level, r.is_synthetic, r.provenance) as "disclaimer",

  extensions.st_y(silver.fuzz_point(r.geom, r.prec)) as "lat",
  extensions.st_x(silver.fuzz_point(r.geom, r.prec)) as "lng",
  -- Added by 20260808000018: which event this belongs to, where it came from,
  -- and who published it. Appended at the end so `create or replace view` can
  -- take it without dropping every dependent view.
  r.event_code                                    as "eventCode",
  r.sub_event_code                                as "subEventCode",
  r.provenance                                    as "provenance",
  r.source_url                                    as "sourceUrl",
  r.source_publication                            as "sourcePublication",
  r.additional_fault_types                        as "additionalFaultTypes"
from resolved r;

-- ---------------------------------------------------------------------------
-- Agencies named in the source material
-- ---------------------------------------------------------------------------
-- Wellington Water, not Tiaki Wai. This event is 20 April 2026 and the handover
-- was 1 July 2026, so Wellington Water is the historically correct owner — which
-- is exactly why it was kept as an inactive row rather than deleted.

insert into silver.agency (code, name, kind, public_url, is_active) values
  ('WCC-ROADS',    'Wellington City Council — Roads & Transport',  'council', 'https://wellington.govt.nz/roads-and-transport', true),
  ('WCC-BUILDING', 'Wellington City Council — Building Control',   'council', 'https://wellington.govt.nz/property-rates-and-building', true)
on conflict (code) do update
  set name = excluded.name, kind = excluded.kind, public_url = excluded.public_url;
