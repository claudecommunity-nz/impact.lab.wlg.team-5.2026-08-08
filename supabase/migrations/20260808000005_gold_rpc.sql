-- The API surface. PostgREST exposes each of these at /rest/v1/rpc/<name>.
--
-- The *_geojson functions return a finished FeatureCollection so a consumer can
-- point MapLibre straight at the response with no client-side assembly. That is
-- the point of publishing gold at all: another team's map should be able to
-- read this without knowing anything about our schema.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- gold.reports_geojson
-- ---------------------------------------------------------------------------
-- Every argument optional. bbox is [west, south, east, north] in WGS84, which
-- is MapLibre's getBounds().toArray() flattened.
--
-- `arcgis => true` returns a FeatureCollection with no foreign members and the
-- disclaimer pushed down into every feature. ArcGIS Online's GeoJSON importer
-- silently drops file-level metadata, which would strip the disclaimer off the
-- data on its way into the exact system WCC actually uses. Same reasoning as
-- the ?arcgis=1 branch in prototype/app/api/feed.

create or replace function gold.reports_geojson(
  bbox              double precision[] default null,
  since             timestamptz default null,
  statuses          text[] default null,
  fault_types       text[] default null,
  service           text default null,
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
      and (
        bbox is null
        or (r."lng" between bbox[1] and bbox[3] and r."lat" between bbox[2] and bbox[4])
      )
    order by r."submittedAt" desc
    limit greatest(1, least(coalesce(max_features, 2000), 10000))
  ),
  features as (
    select jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object(
          'type', 'Point',
          'coordinates', jsonb_build_array(f."lng", f."lat")
        ),
        'properties', to_jsonb(f) - 'lat' - 'lng'
      )
    ) as fc
    from filtered f
  )
  select case
    when arcgis then
      jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce((select fc from features), '[]'::jsonb)
      )
    else
      jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce((select fc from features), '[]'::jsonb),
        'metadata', jsonb_build_object(
          'source', 'Impact Lab Wellington 2026 — Team 5 community reporting prototype',
          'generatedAt', now(),
          'count', (select count(*) from filtered),
          'disclaimer', 'Community-submitted reports. Locations are deliberately coarsened; '
                        || 'see locationPrecision on each feature. Not an operational '
                        || 'emergency source. In an emergency call 111.'
        )
      )
  end;
$$;

comment on function gold.reports_geojson is
  'Community reports as a ready-to-render GeoJSON FeatureCollection. bbox is [west, south, east, north] in WGS84.';

-- ---------------------------------------------------------------------------
-- gold.hubs_geojson
-- ---------------------------------------------------------------------------

create or replace function gold.hubs_geojson()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', jsonb_build_object(
            'type', 'Point',
            'coordinates', jsonb_build_array(h."lng", h."lat")
          ),
          'properties', to_jsonb(h) - 'lat' - 'lng'
        )
      )
      from gold.hub h
    ), '[]'::jsonb),
    'metadata', jsonb_build_object(
      'source', 'Greater Wellington Regional Council Open Data — Community Emergency Hubs '
                || 'in the Wellington Region, filtered to Wellington City',
      'sourceUrl', 'https://data-gwrc.opendata.arcgis.com/datasets/0c865aef23ec4bbca358d335e5c307cb',
      'generatedAt', now()
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- gold.clusters_geojson
-- ---------------------------------------------------------------------------

create or replace function gold.clusters_geojson(
  min_reports integer default 2
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', jsonb_build_object(
            'type', 'Point',
            'coordinates', jsonb_build_array(c."lng", c."lat")
          ),
          'properties', to_jsonb(c) - 'lat' - 'lng' || jsonb_build_object('kind', 'group')
        )
      )
      from gold.report_cluster c
      where c."reportCount" >= min_reports
    ), '[]'::jsonb),
    'metadata', jsonb_build_object(
      'generatedAt', now(),
      'note', 'Reports grouped by fault type and proximity. Inferred, not confirmed: a cluster '
              || 'is a proximity heuristic, not a judgement that the reports describe the same thing.'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- gold.submit_report
-- ---------------------------------------------------------------------------
-- The only write path into the database from outside. SECURITY DEFINER so it
-- can insert into silver, which the caller cannot reach.
--
-- Parameter names are exactly the POST body prototype/app/api/reports accepts,
-- so the route can forward the validated body without remapping keys.
--
-- Returns the reference immediately. The acknowledgement is the product: the
-- problem statement asks for communities to "see that their information has
-- been received", and this is the moment that promise is either kept or not.

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
  new_id      uuid;
  new_ref     text;
  ft          silver.fault_type%rowtype;
  matched_hub smallint;
begin
  select * into ft
  from silver.fault_type f
  where f.code = submit_report."faultType" and f.is_active;

  if not found then
    raise exception 'Unknown fault type %. See gold.fault_type for the valid list.',
      submit_report."faultType" using errcode = '22023';
  end if;

  -- Life-safety categories are refused at the database, not just hidden in the
  -- form. A prototype that quietly absorbs one of these and files it in a queue
  -- would be worse than no prototype at all.
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

  -- Same bounds as validate() in prototype/lib/schema.ts: the Wellington
  -- region, not just the city, because Makara and Tawa are both in scope.
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
    reporter_kind, contact_first_name, contact_last_name, contact_email, contact_phone,
    hub_id, attachment_upload_keys, photo_count,
    observed_at, submitted_at,
    source_channel, is_synthetic,
    description_public, pii_reviewed
  ) values (
    new_ref, 'Community report', ft.service, ft.code, severity, "faultDesc",
    extensions.st_setsrid(extensions.st_makepoint("locLongitude", "locLatitude"), 4326),
    "locAddress", "locSuburb",
    "reporterKind"::silver.reporter_kind,
    "contactFirstName", "contactLastName", "contactEmail", "contactPhone",
    matched_hub, coalesce("attachmentUploadKeys", '{}'),
    coalesce(array_length("attachmentUploadKeys", 1), 0),
    coalesce("observedAt", now()), now(),
    "sourceChannel", false,
    -- Freshly submitted text has not been read by anyone. It is held out of
    -- gold until it has been, and descriptionStatus says so rather than the
    -- report simply appearing to have no description.
    null, false
  )
  returning id into new_id;

  return jsonb_build_object(
    'reference', new_ref,
    'status', 'received',
    'legacyStatus', 'received',
    'statusLabel', 'Received',
    'receivedAt', now(),
    'message', 'We have your report. It is in the queue to be looked at. Keep this reference '
               || 'to check progress: ' || new_ref,
    'disclaimer', 'This is a prototype, not an operational emergency service. '
                  || 'In an emergency call 111.'
  );
end;
$$;

comment on function gold.submit_report is
  'Public intake. The only write path into silver. Returns the reference a reporter uses to track their report.';

-- ---------------------------------------------------------------------------
-- gold.report_receipt
-- ---------------------------------------------------------------------------
-- A resident with a reference sees the whole trail without an account. No
-- reference, no data: the reference is the capability, which is why it is
-- random rather than sequential.

create or replace function gold.report_receipt(reference text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'found', true,
        'reference', r."reference",
        'status', r."status",
        'legacyStatus', r."legacyStatus",
        'statusLabel', r."statusLabel",
        'statusNote', r."statusNote",
        'assignedAgency', r."assignedAgency",
        'faultType', r."faultType",
        'faultLabel', r."faultLabel",
        'suburb', r."suburb",
        'severity', r."severity",
        'submittedAt', r."submittedAt",
        'statusUpdatedAt', r."statusUpdatedAt",
        'verificationLevel', r."verificationLevel",
        'isSynthetic', r."isSynthetic",
        'disclaimer', r."disclaimer",
        'timeline', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'at', h."at",
              'status', h."status",
              'legacyStatus', h."legacyStatus",
              'statusLabel', h."statusLabel",
              'note', h."note",
              'by', h."by",
              'externalTicketRef', h."externalTicketRef"
            ) order by h."at"
          )
          from gold.report_status_history h
          where h."reference" = r."reference"
        ), '[]'::jsonb)
      )
      from gold.report r
      where upper(r."reference") = upper(report_receipt.reference)
    ),
    jsonb_build_object('found', false, 'reference', report_receipt.reference)
  );
$$;

comment on function gold.report_receipt is
  'Look up a report and its full status trail by the reference given at submission. No auth required.';

-- ---------------------------------------------------------------------------
-- gold.advance_status
-- ---------------------------------------------------------------------------
-- What the Council console calls to move a report along. Accepts either the
-- eight-state vocabulary or the app's five, so prototype/app/api/reports/
-- [reference] PATCH keeps working while the console catches up.
--
-- Append-only: this writes an event and lets the trigger update the report.
-- There is no way to rewrite history through this API, which is the property
-- that makes the resident-facing trail worth anything.

create or replace function gold.advance_status(
  reference           text,
  status              text,
  note                text default null,
  "agencyCode"        text default null,
  "externalTicketRef" text default null,
  "by"                text default 'WCC Emergency Management'
)
returns jsonb
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  target_id  uuid;
  mapped     silver.report_status;
  agency_id  smallint;
begin
  select r.id into target_id
  from silver.report r
  where upper(r.reference) = upper(advance_status.reference);

  if not found then
    raise exception 'No report with reference %.', advance_status.reference
      using errcode = 'no_data_found';
  end if;

  mapped := case advance_status.status
    when 'checking'  then 'under_review'::silver.report_status
    when 'acting'    then 'responding'::silver.report_status
    when 'resolved'  then 'completed_confirmed'::silver.report_status
    when 'no-action' then 'no_action'::silver.report_status
    else advance_status.status::silver.report_status
  end;

  if "agencyCode" is not null then
    select a.id into agency_id from silver.agency a where a.code = "agencyCode";
    if not found then
      raise exception 'Unknown agency code %. See gold.agency.', "agencyCode"
        using errcode = '22023';
    end if;
  end if;

  insert into silver.report_status_event (
    report_id, status, note, actor_role, actor_agency_id, actor_label, external_ticket_ref
  ) values (
    target_id, mapped, note,
    case when agency_id is not null then 'agency' else 'wcc_duty_officer' end,
    agency_id, "by", "externalTicketRef"
  );

  return gold.report_receipt(advance_status.reference);
end;
$$;

comment on function gold.advance_status is
  'Move a report to a new status. Accepts the eight-state vocabulary or the app''s five. Append-only.';
