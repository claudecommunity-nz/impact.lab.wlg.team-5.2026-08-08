-- Reference data: the agencies a report can route to, and every category that
-- can be reported, classified by who owns it and how urgently WCC treats it.
--
-- This is reference data rather than seed data — the tables it fills are the
-- contract gold publishes, and an empty fault_type table means no report can be
-- submitted at all. Written idempotently so re-running it is a no-op.
--
-- The categories mirror prototype/lib/taxonomy.ts, which in turn mirrors the
-- Council's existing public reporting tool (FIXiT). Four are new here because
-- the ownership classification needed somewhere to land: storm damage, sewage
-- overflow, animal control emergencies and illegal dumping.
--
-- The ownership and priority values are WCC's classification where it was given
-- to us, and our proposal everywhere else. Both are rows, not code: correcting
-- one is an update, not a migration.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Agencies
-- ---------------------------------------------------------------------------
-- Wellington Water is kept as an inactive row rather than deleted. Reports
-- assigned to it before 1 July 2026 still point at it, and a receipt that says
-- "Wellington Water have it" should stay readable after the name changed.

insert into silver.agency (code, name, kind, public_url, is_active) values
  ('WCC',      'Wellington City Council',                'council',           'https://wellington.govt.nz', true),
  ('WREMO',    'Wellington Region Emergency Management Office', 'regional',   'https://wremo.nz', true),
  ('GWRC',     'Greater Wellington Regional Council',    'regional',          'https://gw.govt.nz', true),
  ('TIAKI-WAI','Tiaki Wai',                              'utility',           null, true),
  ('WELLINGTON-WATER', 'Wellington Water',               'utility',           null, false),
  ('WELLINGTON-ELECTRICITY', 'Wellington Electricity',   'lifeline',          'https://welectricity.co.nz', true),
  ('NZTA',     'NZ Transport Agency Waka Kotahi',        'lifeline',          'https://nzta.govt.nz', true),
  ('METLINK',  'Metlink',                                'regional',          'https://metlink.org.nz', true),
  ('FENZ',     'Fire and Emergency New Zealand',         'emergency_service', 'https://fireandemergency.nz', true),
  ('POLICE',   'New Zealand Police',                     'emergency_service', 'https://police.govt.nz', true),
  ('WFA',      'Wellington Free Ambulance',              'emergency_service', 'https://wfa.org.nz', true)
on conflict (code) do update
  set name       = excluded.name,
      kind       = excluded.kind,
      public_url = excluded.public_url,
      is_active  = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
-- Mirrors SERVICES in prototype/lib/taxonomy.ts, plus 'animals', which the
-- taxonomy has no branch for yet but the ownership classification needed: an
-- animal control emergency is WCC's job and had nowhere to sit.

insert into silver.service (code, label, blurb, is_emergency, sort_order) values
  ('emergency', 'Emergency or storm impact',
   'Local conditions during or after an event — flooding, slips, blocked roads, services out.', true, 10),
  ('animals', 'Animals',
   'Animal control emergencies and welfare concerns.', false, 15),
  ('roads', 'Roads, traffic or footpaths',
   'Potholes, damaged surfaces, footpath faults.', false, 20),
  ('street-cleaning', 'Street cleaning or vegetation removal',
   'Rubbish, glass, dead animals, overgrown vegetation.', false, 30),
  ('street-lights', 'Street lights',
   'Outages and faults.', false, 40),
  ('street-furniture', 'Street furniture',
   'Bus stops, hydrants, toilets, ramps.', false, 50),
  ('traffic-signs', 'Traffic signs',
   'Damaged, missing or obscured signage.', false, 60),
  ('parking', 'Parking',
   'Inconsiderate parking and abandoned vehicles.', false, 70),
  ('graffiti', 'Graffiti or vandalism',
   'Graffiti on Council property and eligible private property.', false, 80)
on conflict (code) do update
  set label        = excluded.label,
      blurb        = excluded.blurb,
      is_emergency = excluded.is_emergency,
      sort_order   = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Fault types
-- ---------------------------------------------------------------------------
-- Five things are decided per row:
--
--   default_precision   how coarse the published location becomes
--   default_agency_code where the report routes first
--   ownership           WCC lead, shared, or another agency's job
--   partner_agency_code for shared rows, who actually executes
--   default_priority    the 1-4 starting point before anyone triages it
--
-- Two emergency categories are deliberately left unclassified. Coastal
-- inundation splits between WCC seawalls and roads and GWRC's regional coastal
-- role depending on the asset, and access-cut depends on whether the blockage
-- is on a Council road or a private driveway. Guessing either would put a
-- confident owner on the map for a job nobody has accepted, so gold publishes
-- them as "Not yet classified" until WCC says otherwise.

insert into silver.fault_type (
  code, label, service, default_precision, default_agency_code,
  ownership, partner_agency_code, ownership_note, default_priority, sort_order
) values

  -- Emergency and storm impact -------------------------------------------
  ('flooding', 'Surface flooding', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for flooding on Council land, roads and assets. Flooding confined to private property is the owner''s responsibility.',
   2, 10),

  ('slip', 'Slip or landslide', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads where a slip affects Council roads or land. A slip wholly on private land is the owner''s responsibility.',
   2, 11),

  ('road-blocked', 'Road blocked or impassable', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for road hazards on the local network. State highways are NZTA.',
   2, 12),

  ('tree-down', 'Tree or large debris down', 'emergency', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for trees and debris on Council roads, land and reserves.',
   3, 13),

  ('storm-damage', 'Storm damage', 'emergency', 'street', 'WCC',
   'shared', 'WREMO',
   'WCC leads for damage to Council assets and coordinates the CDEM response with WREMO. Damage to private property is out of scope.',
   2, 14),

  ('building-damage', 'Damage to a building or structure', 'emergency', 'zone_100m', 'WCC',
   'shared', 'FENZ',
   'WCC Building Control leads the structural assessment; FENZ leads rescue. If anyone is trapped or hurt, call 111 first.',
   1, 15),

  ('water-out', 'No water, or water main burst', 'emergency', 'street', 'WCC',
   'shared', 'TIAKI-WAI',
   'WCC owns the asset; Tiaki Wai (formerly Wellington Water) dispatches the repair crew.',
   2, 16),

  ('sewage-overflow', 'Sewage overflow', 'emergency', 'street', 'WCC',
   'shared', 'TIAKI-WAI',
   'WCC owns the asset; Tiaki Wai (formerly Wellington Water) dispatches the repair crew. GWRC is notified where the overflow reaches water.',
   2, 17),

  ('power-out', 'Power out', 'emergency', 'street', 'WELLINGTON-ELECTRICITY',
   'not_wcc', null,
   'Wellington Electricity owns and restores the network. WCC records outages for situational awareness only.',
   2, 18),

  ('coastal', 'Coastal inundation or wave overtopping', 'emergency', 'street', 'WCC',
   null, null,
   'Not yet classified. Responsibility splits between WCC (seawalls, roads, reserves) and GWRC (regional coastal) depending on the asset affected.',
   2, 19),

  ('access-cut', 'Properties cut off / no access', 'emergency', 'zone_100m', 'WCC',
   null, null,
   'Not yet classified. Depends on whether the blockage is on a Council road or a private access way.',
   2, 20),

  ('assistance', 'People needing assistance', 'emergency', 'suburb', null,
   'not_wcc', null,
   'Emergency services lead. In an emergency call 111. WCC and WREMO coordinate welfare support afterwards.',
   1, 21),

  ('hub-status', 'Community Emergency Hub status update', 'emergency', 'exact', 'WREMO',
   'wcc_lead', null,
   'WCC Emergency Management and WREMO run the hub network together.',
   3, 22),

  -- Animal control --------------------------------------------------------
  ('animal-control', 'Animal control emergency', 'animals', 'street', 'WCC',
   'wcc_lead', null,
   'WCC Animal Services leads. Police assist where there is an immediate threat to a person.',
   2, 30),

  -- Roads, traffic and footpaths -----------------------------------------
  ('pothole', 'Pothole', 'roads', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads on the local road network. State highways are NZTA.', 3, 40),
  ('road-damage', 'Damage to a road', 'roads', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads on the local road network. State highways are NZTA.', 3, 41),
  ('uneven-surface', 'Uneven or slippery surface', 'roads', 'street', 'WCC',
   'wcc_lead', null, null, 3, 42),
  ('footpath', 'Footpath fault', 'roads', 'street', 'WCC',
   'wcc_lead', null, null, 3, 43),
  ('drain', 'Slot or strip drain', 'roads', 'street', 'WCC',
   'shared', 'TIAKI-WAI',
   'WCC owns the road drainage asset; Tiaki Wai maintains the stormwater network it drains into.',
   3, 44),
  ('speed-hump', 'Speed hump', 'roads', 'street', 'WCC',
   'wcc_lead', null, null, 4, 45),

  -- Street cleaning and vegetation ---------------------------------------
  ('illegal-dumping', 'Illegal dumping', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null,
   'WCC leads for dumping on Council land, roads and reserves.', 4, 50),
  ('rubbish', 'General rubbish on the road, footpath or access path', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 4, 51),
  ('broken-glass', 'Broken glass or bottles', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 3, 52),
  ('dead-animal', 'Dead animal', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 3, 53),
  ('biohazard', 'Biohazardous material (e.g. vomit, blood)', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 2, 54),
  ('vegetation', 'Clear weeds, plant growth or vegetation', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 4, 55),
  ('moss', 'Moss or lichen on the footpath or road cleared', 'street-cleaning', 'street', 'WCC',
   'wcc_lead', null, null, 4, 56),

  -- Street lights ---------------------------------------------------------
  ('light-single', 'Single street light out', 'street-lights', 'street', 'WCC',
   'wcc_lead', null, null, 4, 60),
  ('light-group', 'Entire suburb or CBD street out', 'street-lights', 'street', 'WCC',
   'wcc_lead', null,
   'WCC owns the street lighting network. A whole street or suburb out is often a supply fault, which is Wellington Electricity''s.',
   3, 61),
  ('light-other', 'General street light enquiry', 'street-lights', 'street', 'WCC',
   'wcc_lead', null, null, 4, 62),

  -- Street furniture ------------------------------------------------------
  ('bus-stop', 'Bus stop', 'street-furniture', 'street', 'WCC',
   'shared', 'METLINK',
   'Stops and shelters are Metlink (GWRC); the road and footpath around them are WCC.',
   4, 70),
  ('fire-hydrant', 'Fire hydrant', 'street-furniture', 'street', 'WCC',
   'shared', 'TIAKI-WAI',
   'The hydrant is part of the water network Tiaki Wai maintains; FENZ depends on it and is notified of faults.',
   3, 71),
  ('public-toilet', 'Public toilet', 'street-furniture', 'street', 'WCC',
   'wcc_lead', null, null, 3, 72),
  ('pedestrian-ramp', 'Pedestrian ramp', 'street-furniture', 'street', 'WCC',
   'wcc_lead', null, null, 3, 73),
  ('other-council-property', 'Other Council property', 'street-furniture', 'street', 'WCC',
   'wcc_lead', null, null, 4, 74),

  -- Traffic signs ---------------------------------------------------------
  ('stop-give-way', 'Stop or Give Way sign', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null,
   'Safety-critical signage on the local road network.', 2, 80),
  ('street-name-sign', 'Street name sign', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null, null, 4, 81),
  ('parking-sign', 'Parking sign (e.g. coupon parking, P60 sign)', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null, null, 4, 82),
  ('electronic-sign', 'Electronic sign (e.g. digital traffic sign)', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null, null, 3, 83),
  ('temporary-roadworks-sign', 'Temporary roadworks sign', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null, null, 3, 84),
  ('other-traffic-sign', 'Other traffic sign', 'traffic-signs', 'street', 'WCC',
   'wcc_lead', null, null, 4, 85),

  -- Parking ---------------------------------------------------------------
  ('abandoned-vehicle', 'Abandoned and derelict vehicles', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 4, 90),
  ('blocking-footpath', 'Blocking footpath', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 3, 91),
  ('blocking-entrance', 'Blocking vehicle entrance', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 3, 92),
  ('overstaying', 'Overstaying time restriction', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 4, 93),
  ('mobility-space', 'Mobility space', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 3, 94),
  ('other-parking', 'Other inconsiderate parking', 'parking', 'street', 'WCC',
   'wcc_lead', null, null, 4, 95),

  -- Graffiti --------------------------------------------------------------
  ('graffiti-council', 'Graffiti on Council property', 'graffiti', 'street', 'WCC',
   'wcc_lead', null, null, 4, 100),
  ('graffiti-private', 'Graffiti on private property', 'graffiti', 'zone_100m', 'WCC',
   'shared', null,
   'WCC removes graffiti from eligible private property with the owner''s consent. Otherwise it is the owner''s responsibility.',
   4, 101),
  ('graffiti-enquiry', 'General graffiti enquiry', 'graffiti', 'street', 'WCC',
   'wcc_lead', null, null, 4, 102)

on conflict (code) do update
  set label               = excluded.label,
      service             = excluded.service,
      default_precision   = excluded.default_precision,
      default_agency_code = excluded.default_agency_code,
      ownership           = excluded.ownership,
      partner_agency_code = excluded.partner_agency_code,
      ownership_note      = excluded.ownership_note,
      default_priority    = excluded.default_priority,
      sort_order          = excluded.sort_order;
