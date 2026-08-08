-- Two-tier (medallion) layout for the Team 5 community reporting database.
--
--   silver  full fidelity. Reporter identity, exact coordinates, raw text.
--           PRIVATE. Never listed in config.toml [api] schemas, so PostgREST
--           cannot serve it at all. Containment is structural, not policy.
--
--   gold    the filtered projection. Public, documented, consumable by the map,
--           the team's app, and the other nine teams' modules.
--
-- The only write path from the outside world is gold.submit_report(), a
-- SECURITY DEFINER function that inserts downward into silver.

create extension if not exists postgis with schema extensions;

-- PostGIS lives in `extensions` per Supabase convention, so every migration and
-- every function below needs it on the search path to resolve the geometry type.
set search_path = public, extensions;

create schema if not exists silver;
create schema if not exists gold;

comment on schema silver is
  'Private full-fidelity layer. Contains PII and exact coordinates. Never exposed over HTTP.';
comment on schema gold is
  'Public filtered layer. PII removed, locations fuzzed, verification and licence state explicit.';

-- Nothing in silver is reachable by the API roles, belt and braces alongside
-- leaving the schema off the PostgREST exposure list.
revoke all on schema silver from anon, authenticated;

grant usage on schema gold to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

-- Lifecycle only. Which agency is handling a report is a separate column, so
-- the map can filter by agency independently of progress, and 'reassessing'
-- can loop back without losing history.
--
-- This is a refinement of the five statuses in prototype/lib/schema.ts, not a
-- replacement: 'assigned' and 'fixed' distinguish "an agency has it" from "the
-- agency says it is done", which the app currently collapses into 'acting'.
-- gold.report publishes both this and a legacyStatus mapped back to the app's
-- five, so prototype/app/api/feed keeps working untouched.
create type silver.report_status as enum (
  'received',
  'under_review',
  'responding',
  'assigned',
  'fixed',
  'completed_confirmed',
  'reassessing',
  'no_action'
);

-- Matches ReporterKindId in prototype/lib/types.ts, plus two internal kinds for
-- reports that originate inside Council or an agency rather than the public.
create type silver.reporter_kind as enum (
  'resident',
  'community-group',
  'hub',
  'council',
  'agency'
);

create type silver.actor_role as enum (
  'system',
  'resident',
  'hub',
  'wcc_duty_officer',
  'agency'
);

-- Published on every gold report. An unverified report is shown AS unverified
-- rather than hidden: surfacing something unconfirmed as fact is the failure
-- mode these problem statements are most wary of.
create type silver.verification_level as enum (
  'unverified',
  'corroborated',
  'field_confirmed',
  'official'
);

-- How much locational detail survives the trip into gold.
create type silver.location_precision as enum (
  'exact',
  'street',
  'zone_100m',
  'suburb'
);
