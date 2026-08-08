-- Privileges. The interesting property here is what is NOT granted.
--
-- gold views are owned by postgres and are not security_invoker, so they run
-- with the owner's rights. anon can therefore read gold.report without holding
-- any privilege at all on silver.report. That is the containment: the filtered
-- projection is reachable, the source is not, and no policy has to be correct
-- for that to hold.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- silver: sealed
-- ---------------------------------------------------------------------------

revoke all on schema silver from anon, authenticated, public;
revoke all on all tables in schema silver from anon, authenticated, public;
revoke all on all sequences in schema silver from anon, authenticated, public;
revoke all on all functions in schema silver from anon, authenticated, public;

alter default privileges in schema silver
  revoke all on tables from anon, authenticated;
alter default privileges in schema silver
  revoke all on functions from anon, authenticated;

-- Defence in depth. If a silver table were ever mistakenly exposed, RLS with no
-- policy denies everything rather than serving it.
alter table silver.report                enable row level security;
alter table silver.report_status_event   enable row level security;
alter table silver.report_photo          enable row level security;
alter table silver.report_cluster        enable row level security;
alter table silver.report_cluster_member enable row level security;
alter table silver.agency                enable row level security;
alter table silver.service               enable row level security;
alter table silver.fault_type            enable row level security;
alter table silver.hub                   enable row level security;

-- ---------------------------------------------------------------------------
-- gold: readable by anyone
-- ---------------------------------------------------------------------------

grant usage on schema gold to anon, authenticated;

grant select on gold.report                to anon, authenticated;
grant select on gold.report_status_history to anon, authenticated;
grant select on gold.report_cluster        to anon, authenticated;
grant select on gold.hub                   to anon, authenticated;
grant select on gold.agency                to anon, authenticated;
grant select on gold.service               to anon, authenticated;
grant select on gold.fault_type            to anon, authenticated;

grant execute on function gold.reports_geojson(
  double precision[], timestamptz, text[], text[], text, boolean, boolean, integer
) to anon, authenticated;
grant execute on function gold.hubs_geojson() to anon, authenticated;
grant execute on function gold.clusters_geojson(integer) to anon, authenticated;
grant execute on function gold.report_receipt(text) to anon, authenticated;

-- Anyone may submit a report. That is the entire point of the channel, and the
-- function validates hard before it writes.
grant execute on function gold.submit_report(
  text, text, text, double precision, double precision, text, text, text,
  text, text, text, text, text, text, text[], timestamptz, text
) to anon, authenticated;

-- Deliberately NOT granted to anon: moving a report to "Completed & confirmed"
-- is a Council statement about the world, and a public key must not be able to
-- make it. The console's PATCH route runs server-side, so it calls this with
-- the service role key. If this is ever granted to anon, the acknowledgement
-- trail stops meaning anything.
revoke all on function gold.advance_status(text, text, text, text, text, text)
  from anon, authenticated, public;

-- Anything added to gold later is readable by default; anything added to silver
-- is not. The safe default is the one that matches each schema's purpose.
alter default privileges in schema gold grant select on tables to anon, authenticated;

-- silver's helpers must not become callable just because gold's are.
revoke all on function silver.fuzz_point(geometry, silver.location_precision)
  from anon, authenticated, public;
revoke all on function silver.generate_reference() from anon, authenticated, public;
revoke all on function silver.effective_precision(text, silver.location_precision)
  from anon, authenticated, public;
