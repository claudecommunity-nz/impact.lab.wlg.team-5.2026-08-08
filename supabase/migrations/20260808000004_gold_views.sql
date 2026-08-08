-- The public layer. Everything here is safe to serve to anyone, and is the
-- contract the map, the prototype app and the other nine teams build against.
--
-- Property names match the GeoJSON already emitted by prototype/app/api/feed so
-- an existing consumer needs no changes. Six columns are added to every report:
-- descriptionStatus, verificationLevel, locationPrecision, isSynthetic,
-- legacyStatus and disclaimer.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Status labels
-- ---------------------------------------------------------------------------
-- "Assigned" on its own tells a resident nothing. "Assigned to Tiaki Wai" tells
-- them who has it and who to expect to hear from.

create or replace function gold.status_label(
  s silver.report_status,
  agency_name text
)
returns text
language sql
immutable
parallel safe
as $$
  select case s
    when 'received'            then 'Received'
    when 'under_review'        then 'Under review'
    when 'responding'          then 'Responding'
    when 'assigned'            then coalesce('Assigned to ' || agency_name, 'Assigned')
    when 'fixed'               then coalesce('Fixed by ' || agency_name, 'Fixed')
    when 'completed_confirmed' then 'Completed & confirmed'
    when 'reassessing'         then 'Reassessing'
    when 'no_action'           then 'No action needed'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy status mapping
-- ---------------------------------------------------------------------------
-- prototype/lib/types.ts knows five statuses. The database tracks eight, because
-- "an agency has it" and "the agency says it is done" are different facts and a
-- resident deserves to be told which one applies. Rather than force the app to
-- change, gold publishes both: `status` is the real one, `legacyStatus` is the
-- nearest of the app's five.
--
-- The mapping is deliberately lossy in the safe direction. 'fixed' maps to
-- 'acting', not 'resolved', because the agency saying it is done is not the
-- same as anyone having checked — and a resident reading "Resolved" about a
-- slip still blocking their street is exactly the failure this project exists
-- to prevent.

create or replace function gold.legacy_status(s silver.report_status)
returns text
language sql
immutable
parallel safe
as $$
  select case s
    when 'received'            then 'received'
    when 'under_review'        then 'checking'
    when 'responding'          then 'acting'
    when 'assigned'            then 'acting'
    when 'fixed'               then 'acting'
    when 'completed_confirmed' then 'resolved'
    when 'reassessing'         then 'checking'
    when 'no_action'           then 'no-action'
  end;
$$;

comment on function gold.legacy_status is
  'Maps the eight-state lifecycle onto the five StatusIds in prototype/lib/types.ts. Lossy towards caution.';

-- ---------------------------------------------------------------------------
-- Disclaimer
-- ---------------------------------------------------------------------------
-- Rides on every single report row. A consumer that renders our data without
-- reading the docs still cannot present it as confirmed fact. The 'unverified'
-- wording is the exact string prototype/app/api/feed already emits.

create or replace function gold.disclaimer_for(v silver.verification_level, synthetic boolean)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when synthetic then
      'Synthetic demonstration data generated for a hackathon prototype. Not a real report. '
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

-- ---------------------------------------------------------------------------
-- Reference data views
-- ---------------------------------------------------------------------------

create or replace view gold.agency as
select
  a.code        as "code",
  a.name        as "name",
  a.kind        as "kind",
  a.public_url  as "publicUrl"
from silver.agency a
where a.is_active;

create or replace view gold.service as
select
  s.code          as "code",
  s.label         as "label",
  s.blurb         as "blurb",
  s.is_emergency  as "isEmergency",
  s.sort_order    as "sortOrder"
from silver.service s;

-- Published so a client can build its own report form, and so anyone can see
-- exactly which categories get their location coarsened and by how much. The
-- coarsening rules being public is the point: a resident should be able to
-- check what we do with their pin before they drop it.
create or replace view gold.fault_type as
select
  f.code                  as "code",
  f.label                 as "label",
  f.service               as "service",
  f.default_precision     as "locationPrecision",
  f.default_agency_code   as "defaultAgencyCode",
  f.intake_blocked        as "intakeBlocked",
  f.intake_block_reason   as "intakeBlockReason",
  f.sort_order            as "sortOrder"
from silver.fault_type f
where f.is_active;

-- Hub locations are published exactly. These are places the public is meant to
-- be able to find.
create or replace view gold.hub as
select
  h.id                     as "id",
  h.name                   as "name",
  h.address                as "address",
  h.suburb                 as "suburb",
  extensions.st_y(h.geom)  as "lat",
  extensions.st_x(h.geom)  as "lng",
  h.source                 as "source",
  h.source_url             as "sourceUrl"
from silver.hub h
where h.is_active;

-- ---------------------------------------------------------------------------
-- gold.report
-- ---------------------------------------------------------------------------
-- The filter, in one place.
--
-- contact_first_name, contact_last_name, contact_email, contact_phone,
-- device_hash and attachment_previews are simply not selected. They have no
-- path into this view, and this view is the only path into the API.
--
-- Coordinates come out of fuzz_point. The street address is dropped for
-- anything coarser than street precision, because "Rawhiti Terrace" plus a 100m
-- cell reassembles the exact address the fuzzing was meant to protect.

create or replace view gold.report as
with resolved as (
  select
    r.*,
    silver.effective_precision(r.fault_type, r.precision_override) as prec,
    ft.label as fault_label,
    ag.name  as agency_name,
    ag.code  as agency_code,
    h.name   as hub_name
  from silver.report r
  join silver.fault_type ft on ft.code = r.fault_type
  left join silver.agency ag on ag.id = r.assigned_agency_id
  left join silver.hub h on h.id = r.hub_id
)
select
  'report'::text                                     as "kind",
  r.reference                                        as "reference",
  r.service                                          as "service",
  r.fault_type                                       as "faultType",
  r.fault_label                                      as "faultLabel",

  -- Withheld rather than guessed at. A null description with an explicit status
  -- is honest; a leaked one cannot be taken back.
  case when r.pii_reviewed then coalesce(r.description_public, r.fault_desc) end
                                                     as "description",
  case when r.pii_reviewed then 'published' else 'withheld_pending_review' end
                                                     as "descriptionStatus",

  case when r.prec = 'street' then r.loc_address end as "address",
  r.loc_suburb                                       as "suburb",
  r.severity                                         as "severity",
  r.reporter_kind                                    as "reporterKind",
  r.hub_name                                         as "hubName",

  r.current_status                                   as "status",
  gold.legacy_status(r.current_status)               as "legacyStatus",
  gold.status_label(r.current_status, r.agency_name) as "statusLabel",
  r.current_status_note                              as "statusNote",
  r.agency_code                                      as "assignedAgencyCode",
  r.agency_name                                      as "assignedAgency",
  r.status_updated_at                                as "statusUpdatedAt",

  r.observed_at                                      as "observedAt",
  r.submitted_at                                     as "submittedAt",
  r.photo_count                                      as "photoCount",

  r.verification_level                               as "verificationLevel",
  r.prec                                             as "locationPrecision",
  r.is_synthetic                                     as "isSynthetic",
  gold.disclaimer_for(r.verification_level, r.is_synthetic) as "disclaimer",

  extensions.st_y(silver.fuzz_point(r.geom, r.prec)) as "lat",
  extensions.st_x(silver.fuzz_point(r.geom, r.prec)) as "lng"
from resolved r;

comment on view gold.report is
  'Public view of community reports. PII removed, coordinates fuzzed per fault type, verification and synthetic state explicit.';

-- ---------------------------------------------------------------------------
-- gold.report_status_history
-- ---------------------------------------------------------------------------
-- The trail, keyed by the reference a reporter was given. This is the "you can
-- see your report was received" half of the problem statement, and the reason
-- the event table is append-only.

create or replace view gold.report_status_history as
select
  r.reference                          as "reference",
  e.status                             as "status",
  gold.legacy_status(e.status)         as "legacyStatus",
  gold.status_label(e.status, ag.name) as "statusLabel",
  e.note                               as "note",
  e.actor_role                         as "actorRole",
  coalesce(e.actor_label, ag.name,
           case e.actor_role
             when 'system' then 'system'
             when 'wcc_duty_officer' then 'WCC Emergency Management'
             else e.actor_role::text
           end)                        as "by",
  ag.code                              as "agencyCode",
  ag.name                              as "agency",
  e.external_ticket_ref                as "externalTicketRef",
  e.at                                 as "at"
from silver.report_status_event e
join silver.report r on r.id = e.report_id
left join silver.agency ag on ag.id = e.actor_agency_id;

-- ---------------------------------------------------------------------------
-- gold.report_cluster
-- ---------------------------------------------------------------------------
-- Cluster centroids are published at zone precision regardless of the fault
-- type underneath, because an aggregate of urgent reports should not be more
-- locatable than the reports it aggregates.

create or replace view gold.report_cluster as
select
  c.id                                            as "id",
  c.fault_type                                    as "faultType",
  ft.label                                        as "faultLabel",
  c.suburb                                        as "suburb",
  c.member_count                                  as "reportCount",
  c.radius_m                                      as "radiusM",
  'same fault type within ' || c.radius_m || 'm — inferred, not confirmed'
                                                  as "groupedBy",
  c.first_seen_at                                 as "firstSeenAt",
  c.last_seen_at                                  as "lastSeenAt",
  extensions.st_y(silver.fuzz_point(c.centroid_geom, 'zone_100m')) as "lat",
  extensions.st_x(silver.fuzz_point(c.centroid_geom, 'zone_100m')) as "lng",
  bool_or(r.is_synthetic)                         as "isSynthetic",
  array_agg(distinct r.reference order by r.reference) as "references"
from silver.report_cluster c
join silver.fault_type ft on ft.code = c.fault_type
left join silver.report_cluster_member m on m.cluster_id = c.id
left join silver.report r on r.id = m.report_id
group by c.id, c.fault_type, ft.label, c.suburb, c.member_count, c.radius_m,
         c.first_seen_at, c.last_seen_at, c.centroid_geom;
