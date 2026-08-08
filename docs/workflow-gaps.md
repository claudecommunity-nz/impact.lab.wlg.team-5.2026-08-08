# What the workflow still needs

> Living doc — see [README.md](README.md). Tick things off here as they land,
> and delete the entry once it is true in the code.

The "what works" table below was **run**, not reasoned about: migration chain
`0001`–`0009` plus `seed.sql` applied to a clean
`public.ecr.aws/supabase/postgres:17.6.1.158`, then exercised as the `anon` and
`service_role` roles.

**Migrations `0012`–`0017` have not been through that.** They are read and
reviewed but not applied to a clean database, which is itself gap 4 below.

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
dependency. Re-checked 8 August 2026: `grep -rn supabase prototype/lib
prototype/app prototype/package.json` returns nothing.

So there are currently two parallel systems: the app the demo will show, and the
database the API contract describes. Neither knows about the other.

There is a second cost now that the database has moved on. Everything migrations
`0015`–`0017` added — merged categories, `helpText`, `alsoCovers`, the triage
endpoint — exists only in the database. The app cannot show any of it.

**Decide, explicitly, which one demos.** Either:

- **Wire the app to Supabase** — three route handlers (`api/feed`,
  `api/reports`, `api/reports/[reference]`) forwarding to `reports_geojson`,
  `submit_report` and `report_receipt`. The parameter names already match the
  POST body on purpose, so this is a thin change; or
- **Demo the database directly** as the composable module (a MapLibre page
  pointed at `reports_geojson`) and present the app as the front end it feeds.

What does not work is leaving it ambiguous until 16:00.

## 2. The form offers six retired categories and none of the three merged ones

`prototype/lib/taxonomy.ts` still lists `flooding`, `coastal`, `road-blocked`,
`access-cut`, `power-out` and `water-out`. It does not list `surface-flood`,
`road-closure` or `service-outage`.

**Nothing is broken** — `0015` retired the old codes as aliases precisely so this
would keep working, and `gold.submit_report` resolves them and reports
`faultTypeRemapped: true`. But the merge existed to stop making someone choose
between "flooding" and "coastal inundation" while standing in front of water
coming over a sea wall, and the form still shows both boxes. The benefit is
entirely unrealised until the form changes.

`help_text` and `alsoCovers` were added in `0017` to carry exactly this
explanation to a reporter, and nothing reads them yet.

Separately, and pre-dating the merge: `animal-control`, `illegal-dumping`,
`sewage-overflow` and `storm-damage` are in `silver.fault_type` because WCC's
ownership classification needed them, and are absent from the form. Nobody can
report them through the UI.

The same drift in reverse is what `silver.service` was created to prevent — the
comment on that table says it mirrors `SERVICES` "one for one, so the report form
and the database cannot drift apart". They have drifted.

## 3. A stray constraint duplicates the `service` foreign key

`20260808000008` lines 94–95 drop this constraint and then immediately **re-add**
it, so it is still live:

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

**Fix:** drop it, in a new migration. The foreign key is the constraint.

## 4. Six migrations have never been applied to a clean database

`0012`–`0017` add the GIS catalogue, `layer_geojson`, hazard context, the
category merge, `gold.triage_report`, `gold.scope_audit`, `gold.report_category`
and the `help_text` columns. All of it is documented in [api.md](api.md) from the
migration source.

None of it has been run start-to-finish on an empty database, and `0015` is the
kind of migration where that matters most: it does data repair (a
`precision_override` backfill that must run *before* its own remap) and calls
`silver.rebuild_clusters()` at the end.

**Fix:** `supabase db reset` against a clean container, then
`npm run check -- <url> "$NEXT_PUBLIC_SUPABASE_ANON_KEY"`. Until then
[api.md](api.md)'s verification line says plainly which half is unverified.

## 5. `20260808000017_category_help_text.sql` is not committed

It is untracked in `git status`. Anyone pulling the branch gets a database
without `help_text`, `alsoCovers` or `gold.report_category`, and
[api.md](api.md) will describe views they do not have.

---

## Closed since this list was written

Deleted from the numbered list above, recorded here so they are not re-reported:

- **Life-safety intake blocking was off** — fixed in `20260808000011`.
  `assistance` and `building-damage` now refuse at intake.
- **`report_receipt` dropped keys the app reads** — fixed in `20260808000010`.
  `timeline` is back in the `TimelineEntry` shape, `history` retained.
- **No API path to triage a report** — fixed in `20260808000016`.
  `gold.triage_report` sets priority, ownership, land and lifecycle, service role
  only.
- **The service role could not reach `gold`** — fixed in `20260808000010`.

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

**Consequence:** the `security definer` markers and the
`grant execute ... to anon, authenticated` block at the end of `0008` are **not
optional tidying**. Remove either and the entire public feed stops working for
anonymous readers. `0008` also happens to fix this for `effective_precision`,
which `0006` revoked while `gold.report` was calling it — so migrations
`0001`–`0007` on their own were broken for `anon`.

---

**Verified against:** run on `supabase/postgres:17.6.1.158` for
`20260808000001`–`20260808000009` + `seed.sql`. Read but not run for
`20260808000010`–`20260808000017`. Source-checked 8 August 2026:
`prototype/lib/store.ts`, `prototype/lib/taxonomy.ts`,
`prototype/app/api/reports/route.ts`, `prototype/package.json`,
`supabase/seed.sql`, `supabase/migrations/20260808000008` (lines 94–95).
