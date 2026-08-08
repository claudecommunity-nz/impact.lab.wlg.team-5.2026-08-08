-- Two corrections found by driving the API end to end.
--
-- 1. service_role had no privileges on gold at all. The Council console's PATCH
--    route runs server-side and calls gold.advance_status with the service key,
--    which failed with "permission denied for schema gold". anon deliberately
--    cannot advance a report; service_role must be able to, or the whole
--    acknowledgement loop is read-only.
--
-- 2. gold.report_receipt returned its trail under `history`, with no
--    legacyStatus and no `by`. prototype/lib/types.ts calls that array
--    `timeline` and each entry carries `by`. Returning a shape the app cannot
--    consume makes the receipt useless to the one screen that exists to show it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- service_role
-- ---------------------------------------------------------------------------

grant usage on schema gold to service_role;
grant select on all tables in schema gold to service_role;
grant execute on all functions in schema gold to service_role;

alter default privileges in schema gold grant select on tables to service_role;
alter default privileges in schema gold grant execute on functions to service_role;

-- Still not anon. Moving a report to "Completed & confirmed" is a Council
-- statement about the world, and a public key must not be able to make it.
revoke all on function gold.advance_status(text, text, text, text, text, text)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- gold.advance_status, with the actor_role cast it was missing
-- ---------------------------------------------------------------------------
-- A bare CASE yields text, and the column is silver.actor_role. Postgres will
-- not coerce it implicitly, so every call failed at insert time.

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

  -- Accepts the eight-state vocabulary or the five StatusIds the app knows.
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
    (case when agency_id is not null then 'agency' else 'wcc_duty_officer' end)::silver.actor_role,
    agency_id, "by", "externalTicketRef"
  );

  return gold.report_receipt(advance_status.reference);
end;
$$;

comment on function gold.advance_status is
  'Move a report to a new status. Accepts the eight-state vocabulary or the app''s five. Append-only.';

revoke all on function gold.advance_status(text, text, text, text, text, text)
  from anon, authenticated, public;
grant execute on function gold.advance_status(text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- gold.report_receipt, in the app's shape
-- ---------------------------------------------------------------------------
-- References get read back over a radio and typed in by hand, so the lookup is
-- case-insensitive — the same thing getReport() in prototype/lib/store.ts does.
--
-- The trail is returned twice, as `timeline` and as `history`. They are the same
-- array. `timeline` matches TimelineEntry in the app; `history` was the shape an
-- earlier migration published, and something may already be reading it.

create or replace function gold.report_receipt(reference text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with found as (
    select * from gold.report r
    where upper(r."reference") = upper(report_receipt.reference)
  ),
  trail as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'at', h."at",
          'status', h."status",
          'legacyStatus', h."legacyStatus",
          'statusLabel', h."statusLabel",
          'note', h."note",
          'by', h."by",
          'agency', h."agency",
          'externalTicketRef', h."externalTicketRef"
        ) order by h."at"
      ),
      '[]'::jsonb
    ) as entries
    from gold.report_status_history h
    where exists (select 1 from found f where f."reference" = h."reference")
  )
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
        'ownership', r."ownership",
        'ownershipLabel', r."ownershipLabel",
        'ownershipNote', r."ownershipNote",
        'partnerAgency', r."partnerAgency",
        'priority', r."priority",
        'priorityLabel', r."priorityLabel",
        'priorityBasis', r."priorityBasis",
        'priorityBasisLabel', r."priorityBasisLabel",
        'faultType', r."faultType",
        'faultLabel', r."faultLabel",
        'severity', r."severity",
        'suburb', r."suburb",
        'submittedAt', r."submittedAt",
        'statusUpdatedAt', r."statusUpdatedAt",
        'verificationLevel', r."verificationLevel",
        'isSynthetic', r."isSynthetic",
        'disclaimer', r."disclaimer",
        'timeline', (select entries from trail),
        'history', (select entries from trail)
      )
      from found r
    ),
    jsonb_build_object('found', false, 'reference', report_receipt.reference)
  );
$$;

comment on function gold.report_receipt is
  'Look up a report and its full status trail by the reference given at submission. Case-insensitive, no auth required.';

grant execute on function gold.report_receipt(text) to anon, authenticated, service_role;
