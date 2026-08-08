-- Reference data: who reports get routed to, what can be reported, and where
-- the Community Emergency Hubs are.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Agencies
-- ---------------------------------------------------------------------------
-- The organisations a report can be assigned to. Kept as a table rather than an
-- enum because routing changes: Wellington Water was replaced by Tiaki Wai on
-- 1 July 2026, and that should be a row edit, not a migration.

create table silver.agency (
  id                 smallint generated always as identity primary key,
  code               text not null unique,
  name               text not null,
  kind               text not null check (kind in (
                       'council', 'utility', 'lifeline', 'emergency_service', 'regional'
                     )),
  public_url         text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

comment on table silver.agency is
  'Organisations a report can be assigned to. Published to gold in full: there is nothing private here.';

-- ---------------------------------------------------------------------------
-- Fault types
-- ---------------------------------------------------------------------------
-- Drives three things at once: the label shown to a reporter, the agency a
-- report routes to by default, and how precisely its location may be published.
--
-- Location precision is data, not code, because the judgement is editorial and
-- will change. A blocked road is useful at street level and identifies nobody.
-- "Six houses up the lane have no vehicle access" identifies a household, so it
-- is published as a 100m zone. Welfare and medical needs go to suburb only.

-- Services mirror SERVICES in prototype/lib/taxonomy.ts one for one, so the
-- report form and the database cannot drift apart.
create table silver.service (
  code               text primary key,
  label              text not null,
  blurb              text,
  is_emergency       boolean not null default false,
  sort_order         smallint not null default 100
);

create table silver.fault_type (
  code               text primary key,
  label              text not null,
  service            text not null references silver.service (code),
  default_precision  silver.location_precision not null,
  default_agency_code text references silver.agency (code),
  -- Mirrors CALL_111 and CALL_CONTACT_CENTRE in taxonomy.ts. A prototype that
  -- quietly absorbs a life-safety report would be worse than no prototype, so
  -- the database refuses these rather than trusting the form to have done it.
  intake_blocked     boolean not null default false,
  intake_block_reason text,
  sort_order         smallint not null default 100,
  is_active          boolean not null default true
);

comment on column silver.fault_type.default_precision is
  'How coarse this fault type''s location becomes in gold. Editorial judgement, deliberately data not code.';

-- ---------------------------------------------------------------------------
-- Community Emergency Hubs
-- ---------------------------------------------------------------------------
-- 36 real hubs, from Greater Wellington Regional Council Open Data filtered to
-- TA_NAME = 'Wellington City'. A report's hub is a foreign key to this table,
-- not a free-text string, so "Newtown Community Emergency Hub" always means the
-- same place.

create table silver.hub (
  id                 smallint generated always as identity primary key,
  name               text not null,
  address            text,
  suburb             text,
  geom               geometry(Point, 4326) not null,
  source             text not null default 'GWRC Open Data — Community Emergency Hubs in the Wellington Region',
  source_url         text not null default 'https://data-gwrc.opendata.arcgis.com/datasets/0c865aef23ec4bbca358d335e5c307cb',
  source_objectid    integer unique,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index hub_geom_idx on silver.hub using gist (geom);
create index hub_suburb_idx on silver.hub (suburb);

comment on table silver.hub is
  'Community Emergency Hubs. Public locations, published to gold unchanged — these are places people are meant to find.';
