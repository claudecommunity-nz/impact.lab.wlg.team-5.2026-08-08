-- The WCC hazard and infrastructure layers.
--
-- Community reports are the signal; these are the context that makes a report
-- mean something. A pin saying "water over the road" is a fact. The same pin
-- inside a mapped flood hazard area is a fact WCC already had a reason to
-- expect, and one outside every mapped area is the more interesting of the two.
--
-- Two tiers, matching how much we can honestly carry on the day:
--
--   metadata   every dataset in the catalogue gets a row: publisher, licence,
--              endpoint, whether it is queryable. Nothing is lost, and a
--              consumer can always follow the link to the publisher.
--   geometry   the response-critical layers are mirrored feature by feature so
--              the map still works when council servers are slow, throttled,
--              or down — which is exactly when an emergency map is wanted.
--
-- Licence is the gate on republishing. Data belongs to its publisher, terms
-- vary per dataset, and this repo is public. `redistributable` decides whether
-- gold serves the geometry or only points at where to get it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table silver.dataset (
  id                  text primary key,
  name                text,
  display_name        text not null,
  theme               text,
  publisher           text,
  licence             text,
  licence_url         text,
  -- Null means nobody has checked. gold treats null as "not redistributable",
  -- because assuming permission is how a licence gets breached.
  redistributable     boolean,
  attribution         text,
  layer_kind          text not null default 'feature'
                        check (layer_kind in ('feature', 'raster', 'other')),
  geometry_type       text,
  queryable           boolean not null default true,
  endpoint_url        text,
  source_page_url     text,
  feature_count       integer,
  ingest_tier         text not null default 'metadata'
                        check (ingest_tier in ('metadata', 'geometry', 'image')),
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now()
);

comment on table silver.dataset is
  'One row per WCC-published dataset. Metadata for all of them; geometry mirrored only where ingest_tier = geometry.';
comment on column silver.dataset.redistributable is
  'Whether the licence permits us to republish the geometry. Null means unchecked, and is treated as no.';

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------
-- Every fetch is recorded, including the ones that failed. "The hubs layer was
-- last refreshed at 11:42 and returned 36 of 36 features" is a sentence a duty
-- officer can act on; a map that silently shows stale data is not.
--
-- `exceeded_transfer_limit` is the specific trap in these services: a request
-- for a large layer returns 2,000 features and a quiet flag rather than an
-- error. Recording it means a truncated layer can never be mistaken for a
-- complete one.

create table silver.source_snapshot (
  id                      bigint generated always as identity primary key,
  dataset_id              text not null references silver.dataset (id) on delete cascade,
  request_url             text not null,
  http_status             integer,
  feature_count           integer,
  exceeded_transfer_limit boolean not null default false,
  complete                boolean not null default true,
  error                   text,
  fetched_at              timestamptz not null default now()
);

create index source_snapshot_dataset_idx on silver.source_snapshot (dataset_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Mirrored features
-- ---------------------------------------------------------------------------

create table silver.dataset_feature (
  id                  bigint generated always as identity primary key,
  dataset_id          text not null references silver.dataset (id) on delete cascade,
  source_feature_id   text,
  -- Mixed geometry: these layers are points (hubs, tanks), lines (routes,
  -- faults) and polygons (hazard zones) depending on the dataset.
  geom                geometry(Geometry, 4326) not null,
  props               jsonb not null default '{}',
  snapshot_id         bigint references silver.source_snapshot (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index dataset_feature_geom_idx on silver.dataset_feature using gist (geom);
create index dataset_feature_dataset_idx on silver.dataset_feature (dataset_id);

-- ---------------------------------------------------------------------------
-- gold.dataset_catalogue
-- ---------------------------------------------------------------------------
-- The whole catalogue is published, including the datasets we cannot
-- redistribute. Knowing a layer exists, who owns it and where to ask for it is
-- useful even when we cannot hand over the geometry — and it is the honest way
-- to represent a licence we have not cleared.

create or replace view gold.dataset_catalogue as
select
  d.id                                    as "id",
  d.display_name                          as "displayName",
  d.theme                                 as "theme",
  d.publisher                             as "publisher",
  d.licence                               as "licence",
  d.licence_url                           as "licenceUrl",
  coalesce(d.redistributable, false)      as "redistributable",
  d.attribution                           as "attribution",
  d.layer_kind                            as "layerKind",
  d.geometry_type                         as "geometryType",
  d.queryable                             as "queryable",
  d.source_page_url                       as "sourcePageUrl",
  d.endpoint_url                          as "endpointUrl",
  d.ingest_tier                           as "ingestTier",
  -- What a consumer actually needs to know: can I get this from our API, or do
  -- I have to go to the publisher?
  case
    when d.ingest_tier = 'geometry' and coalesce(d.redistributable, false)
      then 'gold.layer_geojson'
    when d.layer_kind = 'raster' then 'publisher_image_service'
    else 'publisher_endpoint'
  end                                     as "availableVia",
  s.fetched_at                            as "lastFetchedAt",
  s.feature_count                         as "lastFeatureCount",
  s.complete                              as "lastFetchComplete",
  s.error                                 as "lastFetchError"
from silver.dataset d
left join lateral (
  select * from silver.source_snapshot ss
  where ss.dataset_id = d.id
  order by ss.fetched_at desc
  limit 1
) s on true;

comment on view gold.dataset_catalogue is
  'Every WCC dataset we know about, with its licence, publisher and whether our API can serve the geometry.';

-- ---------------------------------------------------------------------------
-- gold.layer_geojson
-- ---------------------------------------------------------------------------
-- Refuses rather than serves when the licence has not been cleared, and says
-- where to get the data instead. A 200 with an explanation beats an empty
-- FeatureCollection that looks like "there is nothing there".

create or replace function gold.layer_geojson(
  dataset_id   text,
  bbox         double precision[] default null,
  max_features integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  d silver.dataset%rowtype;
  snap silver.source_snapshot%rowtype;
  result jsonb;
begin
  select * into d from silver.dataset ds where ds.id = layer_geojson.dataset_id;
  if not found then
    return jsonb_build_object(
      'error', 'unknown_dataset',
      'datasetId', layer_geojson.dataset_id,
      'hint', 'See gold.dataset_catalogue for the list.'
    );
  end if;

  if not coalesce(d.redistributable, false) then
    return jsonb_build_object(
      'error', 'not_redistributable',
      'datasetId', d.id,
      'displayName', d.display_name,
      'publisher', d.publisher,
      'licence', coalesce(d.licence, 'not stated'),
      'sourcePageUrl', d.source_page_url,
      'endpointUrl', d.endpoint_url,
      'message', 'This dataset''s licence does not clear us to republish it. '
                 || 'Get it from the publisher at the endpoint above.'
    );
  end if;

  if d.ingest_tier <> 'geometry' then
    return jsonb_build_object(
      'error', 'not_mirrored',
      'datasetId', d.id,
      'displayName', d.display_name,
      'endpointUrl', d.endpoint_url,
      'message', 'Catalogued but not mirrored. Query the publisher endpoint directly, '
                 || 'and remember to ask for outSR=4326.'
    );
  end if;

  select * into snap from silver.source_snapshot ss
  where ss.dataset_id = d.id order by ss.fetched_at desc limit 1;

  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'id', f.source_feature_id,
        'geometry', extensions.st_asgeojson(f.geom)::jsonb,
        'properties', f.props
      )
    ), '[]'::jsonb)
  ) into result
  from (
    select * from silver.dataset_feature df
    where df.dataset_id = d.id
      and (
        bbox is null
        or extensions.st_intersects(
             df.geom,
             extensions.st_makeenvelope(bbox[1], bbox[2], bbox[3], bbox[4], 4326)
           )
      )
    limit greatest(1, least(coalesce(max_features, 5000), 20000))
  ) f;

  return result || jsonb_build_object(
    'metadata', jsonb_build_object(
      'datasetId', d.id,
      'displayName', d.display_name,
      'publisher', d.publisher,
      'licence', d.licence,
      'attribution', d.attribution,
      'sourcePageUrl', d.source_page_url,
      'fetchedAt', snap.fetched_at,
      'complete', coalesce(snap.complete, false),
      'truncated', coalesce(snap.exceeded_transfer_limit, false),
      'disclaimer', 'Hazard-planning data mirrored from the publisher, not live '
                    || 'emergency information. In an emergency call 111.'
    )
  );
end;
$$;

comment on function gold.layer_geojson is
  'A mirrored WCC layer as GeoJSON, with provenance. Refuses and explains where to go when the licence is not cleared.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table silver.dataset         enable row level security;
alter table silver.dataset_feature enable row level security;
alter table silver.source_snapshot enable row level security;

revoke all on silver.dataset, silver.dataset_feature, silver.source_snapshot
  from anon, authenticated, public;

grant select on gold.dataset_catalogue to anon, authenticated, service_role;
grant execute on function gold.layer_geojson(text, double precision[], integer)
  to anon, authenticated, service_role;
