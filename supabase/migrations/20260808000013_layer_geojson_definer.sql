-- gold.layer_geojson has to run as its owner.
--
-- The gold views work for anon because a view is not security_invoker by
-- default: it runs with the view owner's rights, which is exactly the mechanism
-- that lets anon read a filtered projection of silver without touching silver.
--
-- A `security invoker` function gets no such help. Its body executed as anon,
-- which has no privilege on silver.dataset, so every call returned
-- "permission denied for schema silver" — including the licence refusal, which
-- is the one answer that most needed to come back cleanly.
--
-- SECURITY DEFINER is safe here precisely because the licence gate lives inside
-- the function. It reads silver, decides whether the dataset may be
-- republished, and returns either the geometry or an explanation of where to
-- get it. Elevating the function does not widen what a caller can see; the
-- decision is made after the read, not before it.

set search_path = public, extensions;

create or replace function gold.layer_geojson(
  dataset_id   text,
  bbox         double precision[] default null,
  max_features integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
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

  -- The licence gate. Null means nobody has checked, and unchecked is not
  -- permission: the data belongs to its publisher and this repo is public.
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
                 || 'Get it from the publisher at the endpoint above, and remember '
                 || 'to ask for outSR=4326.'
    );
  end if;

  if d.ingest_tier <> 'geometry' then
    return jsonb_build_object(
      'error', 'not_mirrored',
      'datasetId', d.id,
      'displayName', d.display_name,
      'endpointUrl', d.endpoint_url,
      'message', 'Catalogued but not mirrored. Query the publisher endpoint directly.'
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
      -- Said plainly, because someone will eventually try to measure something
      -- with this.
      'generalisation', 'Simplified to about 5m and rounded to 6 decimal places for '
                        || 'web display. Do not measure anything with this copy; go to '
                        || 'the publisher.',
      'disclaimer', 'Hazard-planning data mirrored from the publisher, not live '
                    || 'emergency information. In an emergency call 111.'
    )
  );
end;
$$;

grant execute on function gold.layer_geojson(text, double precision[], integer)
  to anon, authenticated, service_role;
