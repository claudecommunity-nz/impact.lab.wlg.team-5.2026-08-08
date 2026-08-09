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
| `20260808000008`, `20260808000009` | Ownership and priority — see [classification.md](classification.md) |
| `20260808000010_service_role_and_receipt.sql` | `service_role` reaches `gold`; `report_receipt` regains `timeline` |
| `20260808000011_block_life_safety_intake.sql` | `assistance` and `building-damage` refuse at intake |
| `20260808000012_gis_datasets.sql` | The 74-dataset catalogue and the mirrored layers |
| `20260808000013_layer_geojson_definer.sql` | `layer_geojson` as `security definer`, with the licence refusal |
| `20260808000014_hazard_context.sql` | Reports × mapped hazard areas, computed on the exact point inside `silver` |
| `20260808000015_consolidate_fault_types.sql` | Three category pairs merged; old codes retired as aliases |
| `20260808000016_triage_endpoint_and_scope.sql` | `gold.triage_report`; `silver.wcc_scope` and `gold.scope_audit` |
| `20260808000017_category_help_text.sql` | `help_text` on categories; `alsoCovers`; `gold.report_category` |

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

**`fault_type`** — the busiest table in the schema. It carries the label and
`help_text` a reporter sees, the agency a report routes to
(`default_agency_code`), how coarsely its location may be published
(`default_precision`), whether this channel accepts it at all (`intake_blocked`,
`intake_block_reason`), who owns the job (`ownership`, `partner_agency_code`,
`ownership_note`, `default_priority` — see
[classification.md](classification.md)), and whether the category is still live
(`is_active`, `superseded_by`).

**`superseded_by`** is what makes a category merge non-breaking. A retired code
keeps its row, goes `is_active = false`, and points at what it became.
`gold.submit_report` resolves the pointer, so a client built against the old list
still files successfully and is told the code moved. Deleting the row instead
would have broken every integration on the day.

**`help_text`** is one line under the label, written in a reporter's words. It
became necessary the moment categories merged: "Surface flooding" does not read
as covering waves over a sea wall, and someone at Island Bay who scans the list
without seeing their situation either picks the wrong box or gives up. Both cost
WCC the report.

**`hub`** — 36 real Community Emergency Hubs from GWRC Open Data, filtered to
Wellington City. A report's hub is a foreign key, so "Newtown Community
Emergency Hub" always means the same place. Source and source URL are columns,
not comments, so attribution travels with the data.

**`wcc_scope`** — what WCC said it owns, recorded as data on 8 August 2026, one
row per category with the wording Council used (`as_stated`) and a `source`.
This is the reference `gold.scope_audit` compares the live classification
against, so that a category quietly acquiring `wcc_lead` shows up instead of
putting Council's name on a job Council never accepted. Where a row is *our*
reading rather than WCC's — `hub-status` — the `source` column says so outright.
No anon access: it is the yardstick, and the audit view is the published half.

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
| `gold.report_category` | Active categories flattened against their service, for building a form in one request |
| `gold.scope_audit` | Live emergency categories against `silver.wcc_scope`, so classification drift is visible rather than blocked |

Two things every `gold.report` row carries that a careless consumer cannot strip
by accident: `isSynthetic` and `disclaimer`.

## Seed data

`supabase/seed.sql` is **generated** — edit `scripts/build-seed.mjs` and
regenerate. It loads 36 real hubs and 28 invented reports describing a
hypothetical southerly. No real person is named and every seeded report carries
`is_synthetic = true`, which travels all the way into gold.

**Reference data belongs in a migration, not the seed.** This reversed once and
the reversal is the point: the seed used to truncate `fault_type`, `service` and
`agency`, so a migration's rows were wiped by the seed that ran after it. That
was fixed by narrowing the truncate — `seed.sql` now clears **reports, clusters,
status events, photos and hubs only**, and says so in its own header. WCC's
ownership and priority classification lives in
`20260808000009_reference_seed.sql` and must survive a `db reset`; a Council
judgement should not be discarded by reseeding demo data.

So: a new category, a label change, an ownership call or a `help_text` edit is a
**migration**. Migrations `0015`, `0016` and `0017` all write reference rows
directly, which is now correct. See [decisions.md](decisions.md) entries 10 and
10a for the round trip.

---

**Verified against:** `supabase/migrations/20260808000001`–`20260808000017`,
`supabase/seed.sql` (header and truncate list) — 8 August 2026. Migrations
`0015`–`0017` were read from source, not applied; `0017` is not yet committed.
