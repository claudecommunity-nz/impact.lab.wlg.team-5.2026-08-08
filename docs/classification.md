# Ownership and priority

> **Status: applied and verified.** Migrations
> `20260808000008_ownership_and_priority.sql` and
> `20260808000009_reference_seed.sql` apply clean and publish through gold —
> confirmed on a fresh database 8 August 2026.
>
> Three later migrations changed this picture and are **read but not run**:
> `0015` merged three category pairs, `0016` added the triage endpoint and the
> scope audit, `0017` added category help text. See
> [Still to do](#still-to-do).

> Living doc — see [README.md](README.md).

## What WCC gave us

Two classifications, from Wellington City Council on 8 August 2026.

### Ownership

**Full WCC ownership (WCC is lead agency):**

- Flooding — on Council land or assets
- Slips — affecting WCC roads or land
- Fallen trees
- Road hazards
- Animal control emergencies
- Illegal dumping

**Shared or partial (WCC triages; another party executes or co-leads):**

| Category | The split |
|---|---|
| Building collapse / structural | WCC Building Control leads assessment; FENZ leads rescue |
| Water main burst | WCC owns the asset; Wellington Water dispatches the repair crew |
| Sewage overflow | Same as above |
| Storm damage | WCC leads for Council assets and coordinates the CDEM response; **private property damage is out of scope** |

This list is a record of what Council said, so it is not edited. Since
`20260808000016` it is also held **as data** in `silver.wcc_scope`, one row per
category with Council's own wording in `as_stated` and a `source`, and
`gold.scope_audit` compares the live classification against it. A category
quietly acquiring `wcc_lead` now shows up as a finding instead of putting
Council's name against a job Council never accepted.

Two notes where the record and the schema no longer line up one-to-one:

- **Water main burst** was scoped as shared, but no longer has a category of its
  own — `0015` merged it into `service-outage` alongside power, which WCC does
  not own at all. It is therefore deliberately *absent* from `wcc_scope` rather
  than misrecorded in it, and triaged per report.
- **`hub-status`** is in `wcc_scope` but was never one of WCC's ten. Its `source`
  column says outright that it is our classification, not Council's.

### Priority — the 1–4 triage scale

WCC called this "classification of the job status". It is recorded as
**priority**, not status, because `status` already means lifecycle in this
schema and a report can be Critical *and* Completed.

| | Label | Definition |
|---|---|---|
| **1** | Critical / immediate | Imminent threat to life or safety on WCC assets or land; major infrastructure failure. Requires immediate cordon or mobilisation |
| **2** | Urgent | Significant safety risk or serious service disruption on WCC assets, but not immediately life-threatening |
| **3** | Standard | Moderate impact on WCC assets; needs timely resolution but not urgent |
| **4** | Low | Minor issue on WCC assets; no immediate risk, cosmetic or low impact |

Note what every definition has in common: **on WCC assets**. Priority is a
statement about a Council job, which is why it and ownership belong together.

## Model

Both follow the pattern location precision already set: a **default on the fault
type**, an optional **override on the individual report**.

```
  fault_type.ownership          ─┐
  fault_type.default_priority   ─┤   category default — the honest starting point
                                 │
  report.ownership_override     ─┤   triage — a judgement about *this* report
  report.priority_override      ─┘
```

Ownership needs the override more than anything else does, and the parentheses
in WCC's own list are why: flooding *on Council land* is WCC's, the same flooding
in a private garage is not. The category cannot know which one arrived.

- **`silver.ownership`** enum: `wcc_lead`, `shared`, `not_wcc`.
- **Null is a valid, meaningful value** — "not yet classified". Gold publishes
  that rather than guessing an owner. Putting a confident owner on the map for a
  job nobody has accepted is worse than an honest blank.

  Since `0015` the deliberately-null category is **`service-outage`**. Power is
  Wellington Electricity's network, which WCC records for awareness only; water
  is a WCC asset that Tiaki Wai repairs. One category cannot route to both, so it
  routes to neither and its `ownership_note` says why. `gold.triage_report` is
  what resolves it per report.

  The two categories previously listed here — `coastal` (split between WCC
  seawalls/roads and GWRC's regional coastal role) and `access-cut` (Council road
  or private driveway) — were retired by the same migration. `coastal` merged
  into `surface-flood`, which keeps `wcc_lead` as right for the common case and
  carries the split in its `ownership_note`; `access-cut` merged into
  `road-closure`.
- **`fault_type.partner_agency_code`** — for shared rows, who actually executes.
  `default_agency_code` stays what it is: where the report routes first.
- **`fault_type.ownership_note`** — the plain-English split, shown to reporters.
  Editorial text, deliberately data not code.

### Priority is published with its basis

A number on its own invites the reader to assume a human set it. Most of the
time nobody has. So gold publishes `priority` alongside `priorityBasis`:

| Basis | Means |
|---|---|
| `triaged` | A duty officer set it. A statement about this report |
| `raised_by_reported_severity` | The reporter marked it urgent, so the category default was lifted one step |
| `category_default` | Nobody has looked yet |

**Priority 1 is never reached automatically.** A reporter saying "urgent" is
evidence, not an assessment, and level 1 commits WCC to an immediate cordon or
mobilisation. The automatic lift stops at 2.

This is the same principle as `verificationLevel` and `descriptionStatus`: if the
prototype infers something, the interface says so.

## Where the classification data lives

**In migration `20260808000009_reference_seed.sql`**, alongside agencies and
services. `scripts/build-seed.mjs` was changed so `seed.sql` truncates only
reports and hubs and leaves the reference tables alone — a Council judgement
should not be discarded by a `db reset`. See
[decisions.md](decisions.md) entries 10 and 10a for why this went the other way
first.

- **Migration `0008`** — the enum, the `priority_level` table, the columns, the
  functions, the gold views. Structure.
- **Migration `0009`** — the per-category ownership and priority values. Data,
  but versioned.
- **Migration `0015`** — the three category merges, the `superseded_by` aliases,
  and the alias resolution in `gold.submit_report`.
- **Migration `0016`** — `gold.triage_report`, plus `silver.wcc_scope` and
  `gold.scope_audit`.
- **Migration `0017`** — `help_text` per category, and `alsoCovers` derived from
  `superseded_by`.
- **`scripts/build-seed.mjs` → `seed.sql`** — hubs and the 28 synthetic reports
  only. Never edit `seed.sql` directly.

### Privacy is not relaxed retroactively

Worth knowing because it constrains any future merge. `access-cut` published at
`zone_100m` and `road-blocked` at `street`. Merging them naively would have
republished already-filed reports about households with no vehicle access at
street precision — a privacy downgrade applied to people who had already
reported.

`0015` therefore backfills `precision_override = 'zone_100m'` on those reports
**before** its own remap runs, while they can still be identified by their
original category, and `gold.submit_report` gives the same treatment to a report
arriving under the old code. A merged category inherits the *stricter* of the two
precisions, never the looser.

## Verified as applied

Full chain on a clean database, 8 August 2026:

```
ownership       priority  reports
(unclassified)     2         4
not_wcc            2         1
shared             2         1
wcc_lead           2        14
shared             3         1
wcc_lead           3         7
```

50 fault types classified. A submitted report publishes `ownershipLabel`,
`priorityLabel` and `priorityBasis` on both `gold.report` and the receipt.

> **These counts predate `0015`.** That migration added three merged categories,
> retired six, and re-ran `rebuild_clusters()`, so both the fault-type total and
> the per-ownership report counts have moved. Re-measure before quoting them.

## Still to do

- [x] ~~Nothing can set a priority.~~ `gold.triage_report()` landed in
      `20260808000016`, granted to the service role only. It sets priority,
      ownership, agency, on-council-land and lifecycle in one call, with null
      meaning "leave alone".
- [x] ~~`0009` does not carry `intake_blocked`.~~ Fixed in `20260808000011`:
      `assistance` and `building-damage` refuse at intake.
- [ ] Drop the stray `fault_type_service_check` that `0008` adds — the foreign
      key to `silver.service` already does that job, and the check hardcodes a
      list containing two services that do not exist. **Still live:** `0008`
      lines 94–95 drop it and immediately re-add it.
- [ ] `animal-control`, `illegal-dumping`, `sewage-overflow` and `storm-damage`
      are in the database and **not** in `prototype/lib/taxonomy.ts`, so nobody
      can report them through the form. Since `0015` the form is also offering
      six retired codes and none of the three merged ones —
      [workflow-gaps.md](workflow-gaps.md#2-the-form-offers-six-retired-categories-and-none-of-the-three-merged-ones).
- [ ] Priority defaults for categories WCC did not classify are our proposal,
      not theirs. Worth saying so in the demo — and `gold.scope_audit` is now the
      thing that says it, per category, in public.
- [ ] Console UI: nothing in `prototype/app/wcc` renders priority or ownership
      yet, nothing calls `triage_report`, and the console does not read the
      database at all
      ([workflow-gaps.md](workflow-gaps.md#1-the-prototype-does-not-talk-to-the-database-at-all)).
      The triage endpoint has no caller.
- [ ] Run `0015`–`0017` against a clean database. The counts under
      [Verified as applied](#verified-as-applied) predate the merge and are now
      wrong.

---

**Verified against:** WCC classification as supplied 8 August 2026;
`supabase/migrations/20260808000008`–`20260808000009` as applied to a clean
database; `20260808000015`–`20260808000017` **read from source, not applied** —
8 August 2026.
