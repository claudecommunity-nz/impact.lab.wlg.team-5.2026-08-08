# Trust and privacy

> Living doc — see [README.md](README.md). If you change what gets published,
> withheld, coarsened or disclaimed, change this file with it.

The problem statement is partly about making limitations visible. Everything
here exists so the prototype cannot accidentally present an unverified public
post as confirmed fact.

## What never leaves silver

Not filtered out downstream — **never selected into `gold.report` in the first
place**:

`contact_first_name`, `contact_last_name`, `contact_email`, `contact_phone`,
`device_hash`, `attachment_previews`, and the exact `geom`.

`gold.report` is the only path into the API, so there is no route by which these
reach a client. Attachment previews are inline images that can carry EXIF GPS,
which would defeat the location fuzzing entirely; `report_photo.exif_stripped`
exists so nothing is served until it is true.

## Free text is withheld until read

A resident typing a description can put anything in it, including their
neighbour's name and their own phone number. So:

- submitted text goes to `fault_desc` with `pii_reviewed = false`;
- `gold.report.description` is null until `pii_reviewed` is true;
- `descriptionStatus` publishes `withheld_pending_review` rather than leaving
  the field silently empty.

A withheld description with an explicit status is honest. A leaked one cannot be
taken back.

## Location is coarsened by category

How coarse is a per-fault-type editorial judgement stored as **data, not code**,
because it will change:

| Precision | Cell | Used for | Reasoning |
|---|---|---|---|
| `exact` | — | Hubs | Places people are meant to find |
| `street` | 20m | Roads, flooding, trees | Useful at street level and identifies nobody |
| `zone_100m` | 100m | Access cut off, building damage | "Six houses up the lane have no vehicle access" identifies a household |
| `suburb` | 1000m | Welfare and assistance | Nobody needs the address to know a suburb needs help |

Two supporting rules:

- **`address` is dropped for anything coarser than `street`.** A street name plus
  a 100m cell reassembles the exact address the fuzzing was meant to protect.
- **Cluster centroids are always `zone_100m`**, regardless of the fault type
  underneath. An aggregate of urgent reports should not be more locatable than
  the reports it aggregates.
- **Precision is never relaxed retroactively.** When `20260808000015` merged
  `access-cut` (published at `zone_100m`) into `road-closure` (`street`), a naive
  remap would have republished already-filed reports about households with no
  vehicle access at street precision — a privacy downgrade applied to people who
  had already reported and could not consent to it. The migration backfills
  `precision_override = 'zone_100m'` on those rows *before* its own remap, and
  `gold.submit_report` does the same for a report arriving under the old code. A
  merged category inherits the **stricter** of the two precisions.

Fuzzing snaps to the **centre** of an NZTM2000 grid cell — deterministic and
irreversible. See [data-model.md](data-model.md#location-fuzzing).

The coarsening rules are published on `gold.fault_type` on purpose: a resident
should be able to check what we do with their pin *before* they drop it.

## Verification is published, not enforced

An unverified report is shown **as** unverified rather than hidden. Hiding it
loses the signal; showing it without the label is the failure mode this whole
project is wary of.

| Level | Means |
|---|---|
| `unverified` | One report. Nobody has checked it. The default |
| `corroborated` | 3+ independent reports of the same fault type within 250m. Automatic |
| `field_confirmed` | Someone looked |
| `official` | WCC or the responding agency says so |

`corroborated` is the only automatic trust change in the system, and it is
deliberately conservative — corroborated is not confirmed, and the disclaimer
says so. It never downgrades anything a human has already confirmed.

## Disclaimers ride on the row

`gold.disclaimer_for(verification_level, is_synthetic)` puts a `disclaimer`
string on **every single report**, worded for its actual state. A consumer who
renders our data without reading these docs still cannot present it as confirmed
fact. Every variant ends with "In an emergency call 111."

`isSynthetic` travels the same way, from the seed generator all the way into
gold, so nobody downstream can mistake demo data for a real report.

For ArcGIS consumers the disclaimer is duplicated into each feature, because
ArcGIS Online drops file-level GeoJSON metadata — see [api.md](api.md).

## Some things are refused, not absorbed

> **Fixed in `20260808000011`.** This section briefly described something that
> was not true: `intake_blocked` was `false` for every category, because
> reference data moved from `seed.sql` into migration `0009`, which did not carry
> the column — so submitting `assistance` as `anon` returned a reference and "it
> is in the queue to be looked at". The guard in `submit_report()` was intact and
> had nothing to fire on. `0011` sets the flag on `assistance` and
> `building-damage` with reasons that tell the reporter to call 111.
>
> Recorded rather than deleted because it is the sharpest example of why these
> docs distinguish read from run: the guard was written, reviewed and documented,
> and was off in the database for as long as nobody executed it.

`fault_type.intake_blocked` mirrors `CALL_111` and `CALL_CONTACT_CENTRE` in
`prototype/lib/taxonomy.ts`, and `gold.submit_report()` raises rather than
writing. The database refuses these rather than trusting the form to have done
it.

Meant to be blocked: `building-damage` and `assistance` — "This needs a phone
call, not a form. If someone is in danger or a building is unsafe, call 111."

## The acknowledgement has to be real

`report_acknowledged` fires on insert and writes a `received` event before
anything else happens, so there is no state in which a report exists without an
acknowledgement. The event log is append-only and `gold.advance_status()` can
only append to it — there is no API that rewrites history.

`actor_label` on a status event is a team name, never an individual. Who in the
Council touched a report is not the resident's business and not ours to publish.

## Repo hygiene

This repo is public. No participant names, no contact details, nothing from the
application process. The 28 seeded reports are invented and name no real person.

Data belongs to its publishers and licences vary per dataset — the hub table
carries `source` and `source_url` as columns so attribution travels with the
rows rather than living in a comment.

---

**Verified against:** `supabase/migrations/20260808000003`–`20260808000017`,
`supabase/seed.sql` header, `prototype/lib/taxonomy.ts` — 8 August 2026.
Migrations `0015`–`0017` read from source, not applied.
