# Ownership and priority

> **Status: applied and verified.** Migrations
> `20260808000008_ownership_and_priority.sql` and
> `20260808000009_reference_seed.sql` apply clean and publish through gold —
> confirmed on a fresh database 8 August 2026. Four follow-ups remain open under
> [Still to do](#still-to-do), one of them serious.

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
  that rather than guessing an owner. Two categories are deliberately left null:
  `coastal` (splits between WCC seawalls/roads and GWRC's regional coastal role
  depending on the asset) and `access-cut` (Council road or private driveway).
  Putting a confident owner on the map for a job nobody has accepted is worse
  than an honest blank.
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
- **`scripts/build-seed.mjs` → `seed.sql`** — hubs and the 28 synthetic reports
  only. Never edit `seed.sql` directly.

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

## Still to do

- [ ] **Nothing can set a priority.** `silver.triage_report()` exists but silver
      is not an exposed schema, and no `gold` function writes
      `priority_override` or `ownership_override`. Every report therefore
      publishes `priorityBasis: category_default` forever. Needs a
      `gold.triage_report()` granted to the service role —
      [workflow-gaps.md](workflow-gaps.md#4-there-is-no-api-path-to-triage-a-report).
- [ ] `0009` does not carry `intake_blocked`, which silently turned off
      life-safety intake blocking when reference data moved into it. Highest
      priority fix in the repo.
- [ ] Drop the stray `fault_type_service_check` that `0008` adds — the foreign
      key to `silver.service` already does that job, and the check hardcodes a
      list containing two services that do not exist.
- [ ] `animal-control`, `illegal-dumping`, `sewage-overflow` and `storm-damage`
      are in the database and **not** in `prototype/lib/taxonomy.ts`, so nobody
      can report them through the form.
- [ ] Priority defaults for categories WCC did not classify are our proposal,
      not theirs. Worth saying so in the demo.
- [ ] Console UI: nothing in `prototype/app/wcc` renders priority or ownership
      yet — and the console does not read the database at all
      ([workflow-gaps.md](workflow-gaps.md#1-the-prototype-does-not-talk-to-the-database-at-all)).

---

**Verified against:** WCC classification as supplied 8 August 2026;
`supabase/migrations/20260808000008`–`20260808000009` **as drafted, not as
applied**.
