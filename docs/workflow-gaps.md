# What the workflow still needs

> Living doc — see [README.md](README.md). Tick things off here as they land,
> and delete the entry once it is true in the code.

Everything below was **run**, not reasoned about: full migration chain
(`0001`–`0009`) plus `seed.sql` applied to a clean
`public.ecr.aws/supabase/postgres:17.6.1.158`, then exercised as the `anon` and
`service_role` roles. Where something is inferred rather than observed it says
so.

## What works today

| | Verified |
|---|---|
| Migrations `0001`–`0009` + `seed.sql` apply clean to an empty database | 11 agencies, 9 services, 50 fault types, 36 hubs, 28 reports |
| `anon` can read `gold.report` | 28 rows, no privilege on silver |
| `anon` can read the feed | `reports_geojson()` → 28 features |
| `anon` can submit | `submit_report()` returned `WCC-9GUPP` |
| `anon` can read a receipt back | status, priority label, ownership label all populated |
| `anon` **cannot** call `advance_status` | `permission denied for function advance_status` |
| `anon` **cannot** touch silver | `permission denied for schema silver` |
| Clustering runs | `rebuild_clusters()` → 2 clusters |
| Ownership and priority publish | 22 `wcc_lead`, 2 `shared`, 1 `not_wcc`, 4 unclassified |

The containment story holds up. The gaps below are all about the workflow
*around* it.

---

## 1. The prototype does not talk to the database at all

**Blocking for the demo if the database is meant to be in it.**

`prototype/lib/store.ts` is a JSON file store (`.data/reports.json`), and
`prototype/app/api/reports/route.ts` calls `createReport`/`listReports` from it.
There is no Supabase client anywhere in `prototype/` — no import, no env var, no
dependency.

So there are currently two parallel systems: the app the demo will show, and the
database the API contract describes. Neither knows about the other.

**Decide, explicitly, which one demos.** Either:

- **Wire the app to Supabase** — three route handlers (`api/feed`,
  `api/reports`, `api/reports/[reference]`) forwarding to `reports_geojson`,
  `submit_report` and `report_receipt`. The parameter names already match the
  POST body on purpose, so this is a thin change; or
- **Demo the database directly** as the composable module (a MapLibre page
  pointed at `reports_geojson`) and present the app as the front end it feeds.

What does not work is leaving it ambiguous until 16:00.

## 2. Life-safety intake blocking is currently OFF — regression

**Verified:** submitting `assistance` (a call-111 category) as `anon` succeeded
and returned reference `WCC-QT4CH`. It should have raised.

```
select code, intake_blocked from silver.fault_type
 where code in ('assistance','building-damage');
 building-damage | f
 assistance      | f
```

**Cause:** `intake_blocked` used to be set by `seed.sql`. Reference data moved
into migration `20260808000009_reference_seed.sql`, which does not carry the
`intake_blocked` / `intake_block_reason` columns, so every category now defaults
to `false`. `gold.submit_report()`'s guard is intact — it simply has nothing to
fire on.

**Fix:** add both columns to the `insert ... on conflict do update` in `0009`,
set `true` for `building-damage` and `assistance` with the existing reason
string. This is the claim [trust-and-privacy.md](trust-and-privacy.md) makes
loudest, and right now it is false.

## 3. `report_receipt` dropped keys the app reads — contract break

`20260808000008` recreates `gold.report_receipt()` and renames `timeline` to
`history`, and drops `legacyStatus`, `statusNote`, `faultType` and `severity`.

`prototype/components/Tracker.tsx:115` maps over `report.timeline`, and
`:102` renders `report.statusNote`. Verified receipt keys today:

```
found, status, statusLabel, assignedAgency, ownership, ownershipLabel,
ownershipNote, partnerAgency, priority, priorityLabel, priorityBasis,
priorityBasisLabel, faultLabel, suburb, submittedAt, statusUpdatedAt,
verificationLevel, isSynthetic, disclaimer, history
```

**Fix:** keep `0005`'s key set and *add* the ownership and priority keys, rather
than replacing it. `timeline`, not `history`.

## 4. There is no API path to triage a report

`silver.triage_report()` exists, but `silver` is not an exposed schema, so
nothing outside the database can call it. The `gold` schema has no function that
sets `priority_override` or `ownership_override`:

```
gold: advance_status, clusters_geojson, disclaimer_for, hubs_geojson,
      legacy_status, ownership_label, priority_basis_label, priority_label,
      report_receipt, reports_geojson, status_label, submit_report
```

So WCC can move a report along the lifecycle but cannot record a priority or
correct an ownership call — which is the half of the classification that makes
it a triage tool rather than a category lookup. Every report currently publishes
`priorityBasis: category_default`, and nothing can change that.

**Fix:** a `gold.triage_report()` alongside `advance_status`, granted to the
service role only, following the same append-only pattern.

## 5. The service role cannot reach `gold`

**Verified:**

```
has_schema_privilege('service_role','gold','usage')  → false
has_function_privilege('service_role','gold.advance_status(...)','execute') → false
```

`20260808000006` grants `usage on schema gold` to `anon` and `authenticated`
only, and `advance_status` is revoked from `anon`/`authenticated`/`public`
without a matching grant to the service role. So the console's PATCH path — the
one thing that is *supposed* to use the service key — fails with `permission
denied for schema gold`.

**Fix:** `grant usage on schema gold to service_role;` and `grant execute on
function gold.advance_status(...) to service_role;`

*Caveat:* tested in a bare Postgres container, not the full Supabase stack. The
hosted stack may grant the service role more by default — worth re-checking
against `supabase start` before treating the fix as urgent, but the explicit
grant is correct either way.

## 6. Four fault types exist in the database and not in the form

`animal-control`, `illegal-dumping`, `sewage-overflow` and `storm-damage` are in
`silver.fault_type` (they are what WCC's ownership classification needed) and
are absent from `prototype/lib/taxonomy.ts`. Nobody can report them through the
UI.

The same drift in reverse is what `silver.service` was created to prevent — the
comment on that table says it mirrors `SERVICES` "one for one, so the report form
and the database cannot drift apart". They have drifted.

## 7. A stray constraint duplicates the `service` foreign key

`20260808000008` adds:

```sql
constraint fault_type_service_check
  check (service in ('emergency','roads','water','parks','animals',
                     'street-cleaning','street-lights','street-furniture',
                     'traffic-signs','parking','graffiti'))
```

`fault_type.service` is already a foreign key to `silver.service`. The check is
a second, hardcoded copy of the same list that will reject the next service
anyone adds, and it names two (`water`, `parks`) that do not exist as services.
It was written against the older schema where `service` was a `check` column.

**Fix:** drop it. The foreign key is the constraint.

---

## Settled: the `gold.report` permission question

[api.md](api.md) previously flagged this as unverified. It is now answered, and
the answer is load-bearing enough to state precisely.

**A function called inside an owner-rights view is permission-checked against
the caller, not the view owner — with one exception.**

| Helper | Behaviour |
|---|---|
| `silver.fuzz_point` — `immutable`, reads no tables | Inlined by the planner. `anon` reads `gold.report` fine with `execute` revoked. Verified |
| `silver.effective_precision`, `effective_ownership`, `assess_priority` — `stable`, read `silver.fault_type` | Not inlined. `anon` needs `execute`, **and** the function must be `security definer`, or its body fails with `permission denied for schema silver`. Verified both ways |

Demonstrated three times over: revoking `execute` from `anon` gives
`permission denied for function assess_priority`; granting `execute` but
dropping `security definer` gives `permission denied for schema silver` from
inside the function body; restoring both makes the read work.

**Consequence for the reconciliation in flight:** the `security definer` markers
and the `grant execute ... to anon, authenticated` block at the end of `0008`
are **not optional tidying**. Remove either and the entire public feed stops
working for anonymous readers. `0008` also happens to fix this for
`effective_precision`, which `0006` revoked while `gold.report` was calling it —
so migrations `0001`–`0007` on their own were broken for `anon`.

---

**Verified against:** full chain `20260808000001`–`20260808000009` + `seed.sql`
on `supabase/postgres:17.6.1.158`, `prototype/lib/store.ts`,
`prototype/app/api/reports/route.ts`, `prototype/components/Tracker.tsx`,
`prototype/lib/taxonomy.ts` — 8 August 2026.
