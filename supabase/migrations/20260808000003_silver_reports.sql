-- The reports themselves, at full fidelity. Nothing in this file is ever served
-- over HTTP; gold projects a filtered view of it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Reference generator
-- ---------------------------------------------------------------------------
-- Byte-for-byte the alphabet in prototype/lib/schema.ts, so a reference minted
-- by the database is indistinguishable from one minted by the app. It omits
-- 0/1/B/I/O/S/Z: a reference gets read out over a handheld radio, which is how
-- a hub actually passes one on, and 'B' and '8' sound identical over VHF.

create or replace function silver.generate_reference()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '23456789ACDEFGHJKLMNPQRTUVWXY';
  candidate text;
  i integer;
begin
  loop
    candidate := 'WCC-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from silver.report where reference = candidate);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Column names follow the Report interface in prototype/lib/types.ts, which is
-- itself a superset of the payload WCC's existing public reporting tool posts
-- (faultType, faultDesc, loc*, contact*, externalSystemName, sourceType).
-- Keeping those names means a report from this channel could be handed to the
-- same downstream Council queue with no translation layer — which is the whole
-- argument for this being a real channel rather than a parallel one.

create table silver.report (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,

  -- What happened
  subject             text not null default 'Community report',
  service             text not null references silver.service (code),
  fault_type          text not null references silver.fault_type (code),
  severity            text not null check (severity in ('info', 'disruption', 'urgent')),
  fault_desc          text not null,

  -- Where. `geom` is exactly as submitted and never leaves this schema.
  geom                geometry(Point, 4326) not null,
  loc_address         text,
  -- Derived on the client from the pin against WCC's own suburb boundaries, so
  -- it is never a resident's spelling of a suburb name.
  loc_suburb          text,
  -- Overrides the fault type's default when a specific report needs to be
  -- coarser than its category normally is.
  precision_override  silver.location_precision,

  -- Who. These five columns are the entire reason silver is private.
  reporter_kind       silver.reporter_kind not null default 'resident',
  contact_first_name  text,
  contact_last_name   text,
  contact_email       text,
  contact_phone       text,
  device_hash         text,
  hub_id              smallint references silver.hub (id),

  -- Downstream queue compatibility
  external_system_name text not null default 'community-channel',
  source_type         integer not null default 1005,
  attachment_upload_keys text[] not null default '{}',
  -- The prototype carries a downscaled inline copy so the Council console can
  -- show a photo without a storage bucket. Inline images can carry EXIF GPS, so
  -- these never reach gold.
  attachment_previews text[] not null default '{}',

  -- When
  observed_at         timestamptz not null,
  submitted_at        timestamptz not null default now(),

  -- Trust and provenance
  verification_level  silver.verification_level not null default 'unverified',
  is_synthetic        boolean not null default false,
  source_channel      text not null default 'web'
                        check (source_channel in ('web', 'sms', 'phone', 'hub_radio', 'social', 'seed')),
  raw_payload         jsonb,

  -- Free text can contain anything a member of the public typed, including
  -- their neighbour's name. Nothing reaches gold until it has been cleared.
  description_public  text,
  pii_reviewed        boolean not null default false,

  photo_count         integer not null default 0 check (photo_count >= 0),

  -- Maintained by trigger from the append-only event log below. Denormalised so
  -- the gold views stay cheap.
  current_status      silver.report_status not null default 'received',
  current_status_note text,
  assigned_agency_id  smallint references silver.agency (id),
  status_updated_at   timestamptz not null default now(),

  created_at          timestamptz not null default now()
);

create index report_geom_idx on silver.report using gist (geom);
create index report_observed_at_idx on silver.report (observed_at desc);
create index report_fault_type_idx on silver.report (fault_type);
create index report_current_status_idx on silver.report (current_status);

comment on table silver.report is
  'Community reports at full fidelity, including reporter identity and exact coordinates. Private.';
comment on column silver.report.description_public is
  'PII-cleared text. Gold publishes this; where it is null gold reports the description as withheld.';
comment on column silver.report.is_synthetic is
  'True for seeded demo data. Travels all the way into gold so nobody can mistake it for a real report.';

-- ---------------------------------------------------------------------------
-- Status lifecycle
-- ---------------------------------------------------------------------------
-- Append-only. This log is the answer to the half of the problem statement
-- about communities seeing that their information has been received — a
-- resident with a reference can watch it move, and see who has it.

create table silver.report_status_event (
  id                  bigint generated always as identity primary key,
  report_id           uuid not null references silver.report (id) on delete cascade,
  status              silver.report_status not null,
  note                text,
  actor_role          silver.actor_role not null default 'system',
  actor_agency_id     smallint references silver.agency (id),
  -- Free-text attribution shown to the resident, matching TimelineEntry.by in
  -- prototype/lib/types.ts. A team name, never an individual: who in the
  -- Council touched a report is not the resident's business and not ours to
  -- publish.
  actor_label         text,
  -- The assigned agency's own job number, so a resident can be told "Tiaki Wai
  -- have it, their reference is X" rather than "it has been passed on".
  external_ticket_ref text,
  at                  timestamptz not null default now()
);

create index report_status_event_report_idx on silver.report_status_event (report_id, at);

comment on table silver.report_status_event is
  'Append-only lifecycle trail. Never updated or deleted; reassessing is a new row, not a rollback.';

-- Keep the denormalised columns on silver.report in step with the log.
create or replace function silver.apply_status_event()
returns trigger
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
begin
  update silver.report
     set current_status      = new.status,
         current_status_note = new.note,
         status_updated_at   = new.at,
         assigned_agency_id  = coalesce(new.actor_agency_id, assigned_agency_id)
   where id = new.report_id;
  return new;
end;
$$;

create trigger report_status_event_applied
  after insert on silver.report_status_event
  for each row execute function silver.apply_status_event();

-- Every report enters the system acknowledged. The receipt is not a courtesy,
-- it is the deliverable.
create or replace function silver.acknowledge_new_report()
returns trigger
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
begin
  insert into silver.report_status_event (report_id, status, note, actor_role, at)
  values (new.id, 'received', 'Report received by Wellington City Council.', 'system', new.submitted_at);
  return new;
end;
$$;

create trigger report_acknowledged
  after insert on silver.report
  for each row execute function silver.acknowledge_new_report();

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

create table silver.report_photo (
  id                  bigint generated always as identity primary key,
  report_id           uuid not null references silver.report (id) on delete cascade,
  storage_path        text not null,
  exif_stripped       boolean not null default false,
  pii_reviewed        boolean not null default false,
  created_at          timestamptz not null default now()
);

create index report_photo_report_idx on silver.report_photo (report_id);

comment on column silver.report_photo.exif_stripped is
  'Phone photos carry GPS in EXIF. An unstripped image defeats location fuzzing, so gold serves none until this is true.';

create or replace function silver.sync_photo_count()
returns trigger
language plpgsql
security definer
set search_path = silver, public, extensions
as $$
begin
  update silver.report r
     set photo_count = (select count(*) from silver.report_photo p where p.report_id = r.id)
   where r.id = coalesce(new.report_id, old.report_id);
  return coalesce(new, old);
end;
$$;

create trigger report_photo_counted
  after insert or delete on silver.report_photo
  for each row execute function silver.sync_photo_count();

-- ---------------------------------------------------------------------------
-- Clusters
-- ---------------------------------------------------------------------------
-- Five people reporting the same flooded stretch of Evans Bay Parade is one
-- incident with five witnesses, not five incidents. Grouping them is what lets
-- WCC see signal strength, and it is also how a report earns 'corroborated'.

create table silver.report_cluster (
  id                  uuid primary key default gen_random_uuid(),
  fault_type          text not null references silver.fault_type (code),
  centroid_geom       geometry(Point, 4326) not null,
  suburb              text,
  member_count        integer not null default 0,
  -- Published alongside the count, because a cluster is a proximity heuristic
  -- and the radius is what makes that claim checkable rather than magic.
  radius_m            integer not null default 250,
  first_seen_at       timestamptz not null,
  last_seen_at        timestamptz not null,
  created_at          timestamptz not null default now()
);

create index report_cluster_geom_idx on silver.report_cluster using gist (centroid_geom);

create table silver.report_cluster_member (
  cluster_id          uuid not null references silver.report_cluster (id) on delete cascade,
  report_id           uuid not null references silver.report (id) on delete cascade,
  primary key (cluster_id, report_id)
);

-- ---------------------------------------------------------------------------
-- Location fuzzing
-- ---------------------------------------------------------------------------
-- Snapping happens in EPSG:2193 (NZTM2000), which is metric, so a 100m cell is
-- exactly 100m — and it is the projection every WCC source dataset is already
-- published in. Hexagons would have been nicer, but the h3 extension is not
-- available on Supabase, and a square grid is honest and exact.
--
-- Returns the centre of the containing cell, not its corner, so a pin sits
-- where the zone actually is.

create or replace function silver.fuzz_point(p geometry, prec silver.location_precision)
returns geometry
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  with cfg as (
    select case prec
             when 'street'    then 20.0     -- keeps the road, loses the house
             when 'zone_100m' then 100.0
             when 'suburb'    then 1000.0
             else null
           end as size
  ),
  proj as (
    select extensions.st_transform(p, 2193) as g, cfg.size from cfg
  )
  select case
           when proj.size is null then p
           else extensions.st_transform(
                  extensions.st_setsrid(
                    extensions.st_makepoint(
                      floor(extensions.st_x(proj.g) / proj.size) * proj.size + proj.size / 2.0,
                      floor(extensions.st_y(proj.g) / proj.size) * proj.size + proj.size / 2.0
                    ),
                    2193
                  ),
                  4326
                )
         end
  from proj;
$$;

comment on function silver.fuzz_point is
  'Snaps a point to the centre of an NZTM2000 grid cell sized by precision level. Deterministic and irreversible.';

-- The precision that actually applies to a report: its own override if set,
-- otherwise its fault type's default.
create or replace function silver.effective_precision(
  fault_type_code text,
  override silver.location_precision
)
returns silver.location_precision
language sql
stable
parallel safe
set search_path = silver, public, extensions
as $$
  select coalesce(
    override,
    (select ft.default_precision from silver.fault_type ft where ft.code = fault_type_code),
    'zone_100m'::silver.location_precision
  );
$$;
