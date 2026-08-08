-- Confirming a report on the ground.
--
-- Renumbered from 20260808000015 to 21. That version was already recorded
-- against a different migration on the deployed database, so `db push` would
-- have seen this file's version as applied, skipped it, and reported success —
-- leaving gold.confirm_report nonexistent on the live API while every log said
-- the deploy worked.
--
-- `silver.verification_level` has existed since the first migration and
-- `gold.disclaimer_for` already writes the right public wording for every value
-- of it, but nothing could ever set it above 'corroborated'. The clustering
-- trigger bumps unverified → corroborated when three independent reports agree,
-- and that is all. 'field_confirmed' and 'official' were unreachable.
--
-- This is the missing half. A first responder or a Council crew has actually
-- looked at the thing, and the feed should say so — that is the difference
-- between a public post and a dataset another team can act on.
--
-- Deliberately NOT granted to anon, for the same reason as gold.advance_status:
-- "Fire have confirmed this" is a statement about the world, and a key that
-- ships in a browser bundle must not be able to make it. If this is ever
-- granted to anon, `verificationLevel` on the feed stops meaning anything and
-- every consumer downstream inherits the lie.

set search_path = public, extensions;

create or replace function gold.confirm_report(
  reference      text,
  "agencyCode"   text,
  level          text default 'field_confirmed',
  note           text default null,
  "by"           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
declare
  target      silver.report%rowtype;
  mapped      silver.verification_level;
  verifier    silver.agency%rowtype;
  actor_name  text;
begin
  select r.* into target
  from silver.report r
  where upper(r.reference) = upper(confirm_report.reference);

  if not found then
    raise exception 'No report with reference %.', confirm_report.reference
      using errcode = 'no_data_found';
  end if;

  -- Who is vouching for it. Required, and it has to be an agency we know:
  -- a confirmation from nobody in particular is not a confirmation, and the
  -- name is the only part of this a reader can weigh.
  select a.* into verifier
  from silver.agency a
  where a.code = confirm_report."agencyCode" and a.is_active;

  if not found then
    raise exception 'Unknown or inactive agency code %. See gold.agency.',
      confirm_report."agencyCode" using errcode = '22023';
  end if;

  begin
    mapped := confirm_report.level::silver.verification_level;
  exception when invalid_text_representation then
    raise exception 'level must be one of unverified, corroborated, field_confirmed, official.'
      using errcode = '22023';
  end;

  -- Never downgrade. Same rule the clustering pass follows: a human standing in
  -- the street outranks anything inferred, and nothing here should be able to
  -- quietly walk that back. Re-confirming at the same level is fine.
  if mapped < target.verification_level then
    raise exception 'Report % is already %; refusing to downgrade it to %.',
      target.reference, target.verification_level, mapped using errcode = '22023';
  end if;

  update silver.report
     set verification_level = mapped
   where id = target.id;

  actor_name := coalesce(confirm_report."by", verifier.name);

  -- The trail records who confirmed it, at the status the report is already in.
  -- Verification is not a step along the status chain — a confirmed hazard is
  -- still unresolved — so this re-asserts current_status rather than moving it.
  --
  -- actor_agency_id is left null on purpose. The trigger on this table copies it
  -- into report.assigned_agency_id, and Fire confirming that a road is blocked
  -- does not mean Fire have been given the job of clearing it. The agency name
  -- travels in actor_label, where it is attribution and nothing else.
  insert into silver.report_status_event (
    report_id, status, note, actor_role, actor_agency_id, actor_label
  ) values (
    target.id,
    target.current_status,
    coalesce(
      confirm_report.note,
      'Confirmed on the ground by ' || actor_name || '.'
    ),
    case when verifier.kind = 'emergency_service' then 'agency' else 'wcc_duty_officer' end
      ::silver.actor_role,
    null,
    actor_name
  );

  return gold.report_receipt(confirm_report.reference);
end;
$$;

comment on function gold.confirm_report is
  'Record that a named agency has confirmed a report on the ground. Raises verification_level and appends an attributed event without moving the status. Service role only.';

revoke all on function gold.confirm_report(text, text, text, text, text)
  from anon, authenticated, public;
grant execute on function gold.confirm_report(text, text, text, text, text)
  to service_role;
