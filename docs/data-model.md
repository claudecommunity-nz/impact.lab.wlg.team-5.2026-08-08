# Data model

> Living doc — see [README.md](README.md). If you change a migration, change
> this file in the same commit.

Migrations apply in filename order:

| File | What it establishes |
|---|---|
| `20260808000001_extensions_and_schemas.sql` | PostGIS, the `silver` and `gold` schemas, the shared enums |
| `20260808000002_silver_reference.sql` | `agency`, `service`, `fault_type`, `hub` |
| `20260808000003_silver_reports.sql` | `report`, the status event log, photos, clusters, location fuzzing |
| `20260808000004_gold_views.sql` | The public projection |
| `20260808000005_gold_rpc.sql` | The API surface — see [api.md](api.md) |
| `20260808000006_grants.sql` | Privileges, and deliberately what is *not* granted |
| `20260808000007_clustering.sql` | DBSCAN grouping and the corroboration promotion |
| `20260808000008`, `20260808000009` | Ownership and priority — **in flight**, see [classification.md](classification.md) |

## Enums

All in `silver`, all published as-is on gold rows.

**`report_status`** — the lifecycle, eight states:
`received` → `under_review` → `responding` → `assigned` → `fixed` →
`completed_confirmed`, plus `reassessing` (loops back) and `no_action`.

Eight rather than the app's five because "an agency has it" and "the agency says
it is done" are different facts. `gold.legacy_status()` maps them back to the
five `StatusId`s in `prototype/lib/types.ts` so the app keeps working, and the
mapping is lossy in the safe direction: `fixed` maps to `acting`, not
`resolved`, because nobody has checked yet.

**`reporter_kind`** — `resident`, `community-group`, `hub`, `council`, `agency`.

**`actor_role`** — who moved a report: `system`, `resident`, `hub`,
`wcc_duty_officer`, `agency`.

**`verification_level`** — `unverified`, `corroborated`, `field_confirmed`,
`official`. Published on every report; see
[trust-and-privacy.md](trust-and-privacy.md).

**`location_precision`** — `exact`, `street`, `zone_100m`, `suburb`. How much
locational detail survives into gold.

## silver — private, full fidelity

### Reference tables

**`agency`** — organisations a report can be assigned to. A table rather than an
enum because routing changes: Wellington Water became Tiaki Wai on 1 July 2026,
and that should be a row edit.

**`service`** — mirrors `SERVICES` in `prototype/lib/taxonomy.ts` one for one so
the form and the database cannot drift.

**`fault_type`** — does four jobs at once: the label a reporter sees, the agency
a report routes to (`default_agency_code`), how coarsely its location may be
published (`default_precision`), and whether this channel accepts it at all
(`intake_blocked`, `intake_block_reason`).

**`hub`** — 36 real Community Emergency Hubs from GWRC Open Data, filtered to
Wellington City. A report's hub is a foreign key, so "Newtown Community
Emergency Hub" always means the same place. Source and source URL are columns,
not comments, so attribution travels with the data.

### `report`

Column names follow the `Report` interface in `prototype/lib/types.ts`, which is
itself a superset of the payload WCC's existing public reporting tool posts
(`faultType`, `faultDesc`, `loc*`, `contact*`, `externalSystemName`,
`sourceType`). A report from this channel could be handed to the same downstream
Council queue with no translation layer — which is the argument for this being a
real channel rather than a parallel one.

| Group | Columns | Notes |
|---|---|---|
| Identity | `id`, `reference` | Reference format `WCC-XXXXX`, alphabet `23456789ACDEFGHJKLMNPQRTUVWXY` — no 0/1/B/I/O/S/Z, because it gets read out over a handheld radio |
| What | `subject`, `service`, `fault_type`, `severity`, `fault_desc` | `severity` is the *reporter's* word: `info`, `disruption`, `urgent` |
| Where | `geom`, `loc_address`, `loc_suburb`, `precision_override` | `geom` is exactly as submitted and never leaves silver |
| Who | `reporter_kind`, `contact_first_name`, `contact_last_name`, `contact_email`, `contact_phone`, `device_hash`, `hub_id` | **These are the entire reason silver is private** |
| Downstream | `external_system_name`, `source_type`, `attachment_upload_keys`, `attachment_previews` | Previews are inline images that can carry EXIF GPS, so they never reach gold |
| When | `observed_at`, `submitted_at` | Observed and submitted are different facts and both matter |
| Trust | `verification_level`, `is_synthetic`, `source_channel`, `raw_payload` | |
| Publishable text | `description_public`, `pii_reviewed` | Nothing reaches gold until it has been read |
| Denormalised | `current_status`, `current_status_note`, `assigned_agency_id`, `status_updated_at` | Maintained by trigger from the event log, so gold views stay cheap |

### `report_status_event`

Append-only. Never updated, never deleted — reassessing is a new row, not a
rollback. This log is the half of the problem statement about communities seeing
that their information has been received.

`actor_label` is free text shown to the resident: a team name, never an
individual. Who in the Council touched a report is not the resident's business
and not ours to publish. `external_ticket_ref` carries the assigned agency's own
job number, so a resident can be told "Tiaki Wai have it, their reference is X"
rather than "it has been passed on".

Two triggers keep this honest:

- `report_acknowledged` — every report gets a `received` event on insert. The
  receipt is not a courtesy, it is the deliverable.
- `report_status_event_applied` — syncs the denormalised columns on `report`.

### Clusters

`report_cluster` and `report_cluster_member`, rebuilt by
`silver.rebuild_clusters(eps_metres => 250, min_points => 2)`.

DBSCAN runs in EPSG:2193 so `eps` is honest metres — in 4326 it would be degrees,
and a degree of longitude at Wellington's latitude is about 84km shorter than a
degree of latitude, so the cluster would be an ellipse. 250m matches
`GROUP_RADIUS_M` in `prototype/lib/store.ts`, so the app and the database group
identically.

`radius_m` is stored and published, because a cluster is a proximity heuristic
and the radius is what makes that claim checkable rather than magic.

Clusters of 3+ promote their `unverified` members to `corroborated`. That is the
only automatic trust change in the system, and it never downgrades anything a
human has confirmed.

### Location fuzzing

`silver.fuzz_point(geom, precision)` snaps a point to the **centre** of an
NZTM2000 (EPSG:2193) grid cell — metric, so a 100m cell is exactly 100m, and it
is the projection every WCC source dataset is already published in.

| Precision | Cell | Keeps |
|---|---|---|
| `exact` | — | The point unchanged |
| `street` | 20m | The road, loses the house |
| `zone_100m` | 100m | The block |
| `suburb` | 1000m | The suburb |

Deterministic and irreversible. Centre rather than corner, so a pin sits where
the zone actually is. Hexagons would have been nicer but the `h3` extension is
not available on Supabase, and a square grid is honest and exact.

`silver.effective_precision(fault_type, override)` resolves the report's own
override first, then the fault type default, then `zone_100m`.

## gold — the public projection

Views, not tables. See [api.md](api.md) for the full published shape.

| View | Is |
|---|---|
| `gold.report` | The filter, in one place. Contact columns, `device_hash` and `attachment_previews` are simply not selected — they have no path into this view, and this view is the only path into the API |
| `gold.report_status_history` | The trail, keyed by reference |
| `gold.report_cluster` | Grouped reports, centroid always at `zone_100m` regardless of the fault type underneath |
| `gold.agency`, `gold.service`, `gold.fault_type`, `gold.hub` | Reference data, so a client can build its own form and anyone can check the coarsening rules before dropping a pin |

Two things every `gold.report` row carries that a careless consumer cannot strip
by accident: `isSynthetic` and `disclaimer`.

## Seed data

`supabase/seed.sql` is **generated** — edit `scripts/build-seed.mjs` and
regenerate. It truncates the reference and report tables and reloads them:
agencies, services, fault types, 36 real hubs, and 28 invented reports
describing a hypothetical southerly. No real person is named and every seeded
report carries `is_synthetic = true`, which travels all the way into gold.

Because the seed truncates `fault_type`, `service` and `agency` on every
`supabase db reset`, **reference data must be seeded through the generator, not
inserted by a migration** — a migration's rows would be wiped by the seed that
runs after it.

---

**Verified against:** `supabase/migrations/20260808000001`–`20260808000007`,
`supabase/seed.sql` (header and reference sections) — 8 August 2026.
