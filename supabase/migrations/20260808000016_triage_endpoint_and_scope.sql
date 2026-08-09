-- Two things the merged taxonomy made necessary.
--
-- 1. A triage endpoint. `service-outage` is deliberately unclassified, because
--    power is Wellington Electricity's network and a burst main is a WCC asset
--    Tiaki Wai repairs, and one category cannot route to both. That decision
--    only works if a duty officer can actually make the call — and
--    silver.triage_report lives in a schema with no URL, so until now nobody
--    could. Every burst main would have sat owned by nobody.
--
-- 2. A scope audit. WCC named six categories it leads and four it shares. A
--    seventh appearing later with `wcc_lead` on it would put Council's name
--    against a job Council never accepted, and nothing would have noticed.
--    Published as a view rather than enforced as a constraint: during a build
--    the classification is still moving, and a constraint that blocks a
--    legitimate edit gets dropped rather than obeyed. Visible beats blocked.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- gold.triage_report
-- ---------------------------------------------------------------------------
-- A thin wrapper over silver.triage_report so the Council console can reach it.
-- service_role only: triage is a Council judgement, and the public key must not
-- be able to decide who owns a job or how urgent it is.

create or replace function gold.triage_report(
  reference        text,
  priority         integer default null,
  ownership        text default null,
  "agencyCode"     text default null,
  "onCouncilLand"  boolean default null,
  status           text default null,
  note             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  mapped_status silver.report_status;
begin
  if priority is not null and priority not between 1 and 4 then
    raise exception 'priority must be 1 (critical) to 4 (low). See gold.priority_level.'
      using errcode = '22023';
  end if;

  if ownership is not null and ownership not in ('wcc_lead', 'shared', 'not_wcc') then
    raise exception 'ownership must be wcc_lead, shared or not_wcc.' using errcode = '22023';
  end if;

  -- Accepts the app's five StatusIds as well as the eight-state vocabulary, the
  -- same as gold.advance_status.
  mapped_status := case status
    when null        then null
    when 'checking'  then 'under_review'::silver.report_status
    when 'acting'    then 'responding'::silver.report_status
    when 'resolved'  then 'completed_confirmed'::silver.report_status
    when 'no-action' then 'no_action'::silver.report_status
    else status::silver.report_status
  end;

  return silver.triage_report(
    p_reference       => triage_report.reference,
    p_priority        => priority::smallint,
    p_ownership       => ownership::silver.ownership,
    p_on_council_land => "onCouncilLand",
    p_status          => mapped_status,
    p_agency_code     => "agencyCode",
    p_note            => note
  );
end;
$$;

comment on function gold.triage_report is
  'Council-side triage: set priority, ownership, land and lifecycle for one report. service_role only.';

revoke all on function gold.triage_report(text, integer, text, text, boolean, text, text)
  from anon, authenticated, public;
grant execute on function gold.triage_report(text, integer, text, text, boolean, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- What WCC actually said it owns
-- ---------------------------------------------------------------------------
-- Recorded as data, from WCC Emergency Management, 8 August 2026. This is the
-- reference the audit below compares against — not our opinion of what Council
-- ought to own.

create table if not exists silver.wcc_scope (
  fault_type   text primary key references silver.fault_type (code),
  ownership    silver.ownership not null,
  executed_by  text references silver.agency (code),
  as_stated    text not null,
  source       text not null default 'WCC Emergency Management, 8 August 2026'
);

alter table silver.wcc_scope enable row level security;
revoke all on silver.wcc_scope from anon, authenticated, public;

insert into silver.wcc_scope (fault_type, ownership, executed_by, as_stated) values
  ('surface-flood',   'wcc_lead', null,        'Flooding (on Council land/assets)'),
  ('slip',            'wcc_lead', null,        'Slips (affecting WCC roads/land)'),
  ('tree-down',       'wcc_lead', null,        'Fallen trees'),
  ('road-closure',    'wcc_lead', null,        'Road hazards'),
  ('animal-control',  'wcc_lead', null,        'Animal control emergencies'),
  ('illegal-dumping', 'wcc_lead', null,        'Illegal dumping'),
  ('building-damage', 'shared',   'FENZ',      'Building collapse/structural — WCC Building Control leads assessment; FENZ leads rescue'),
  ('sewage-overflow', 'shared',   'TIAKI-WAI', 'Sewage overflow — WCC owns asset; water entity dispatches repair crew'),
  ('storm-damage',    'shared',   'WREMO',     'Storm damage — WCC leads for Council assets; coordinates CDEM response; private property damage is out of scope')
on conflict (fault_type) do update
  set ownership   = excluded.ownership,
      executed_by = excluded.executed_by,
      as_stated   = excluded.as_stated;

-- Not one of WCC's ten. A hub status update is not an incident anyone owns; it
-- is the hub network reporting on itself, and WCC Emergency Management and
-- WREMO run that network jointly. Recorded so it stops appearing as unexplained
-- drift — with `source` saying plainly that this is our classification and not
-- something WCC stated.
insert into silver.wcc_scope (fault_type, ownership, executed_by, as_stated, source) values
  ('hub-status', 'wcc_lead', 'WREMO',
   'Community Emergency Hub status update — not an incident; WCC Emergency Management and WREMO run the hub network jointly',
   'Team 5 classification, 8 August 2026 — NOT stated by WCC')
on conflict (fault_type) do update
  set ownership = excluded.ownership, executed_by = excluded.executed_by,
      as_stated = excluded.as_stated, source = excluded.source;

-- Water main burst was scoped by WCC as shared (Council owns the asset, the
-- water entity repairs it), but it no longer has a category of its own: it was
-- merged into `service-outage` alongside power, which WCC does not own at all.
-- The merged category is intentionally unclassified and triaged per report, so
-- it is deliberately absent from the table above rather than misrecorded in it.

-- ---------------------------------------------------------------------------
-- gold.scope_audit
-- ---------------------------------------------------------------------------

create or replace view gold.scope_audit as
select
  f.code                                   as "faultType",
  f.label                                  as "label",
  f.ownership                              as "ownershipPublished",
  s.ownership                              as "ownershipScopedByWcc",
  s.as_stated                              as "asStatedByWcc",
  s.source                                 as "source",
  case
    when s.fault_type is null and f.ownership = 'wcc_lead'
      then 'claims WCC lead but is not in WCC''s stated scope'
    when s.fault_type is null
      then 'not in WCC''s stated scope'
    when f.ownership is distinct from s.ownership
      then 'published ownership differs from WCC''s stated scope'
    else 'matches'
  end                                      as "finding"
from silver.fault_type f
left join silver.wcc_scope s on s.fault_type = f.code
-- Emergency categories only. WCC's scoping conversation was about emergency
-- response; potholes, graffiti and parking are Council's routine work and were
-- never in question. Auditing them produces thirty rows of noise that trains
-- everyone to ignore the four that matter.
where f.is_active and f.service = 'emergency';

comment on view gold.scope_audit is
  'Every live category against the scope WCC stated. Published so drift is visible rather than enforced, which would hide it.';

grant select on gold.scope_audit to anon, authenticated, service_role;
