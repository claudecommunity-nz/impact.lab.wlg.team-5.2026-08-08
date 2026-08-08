# Putting it online

The database is identical locally and hosted — same migrations, same seed. The
only difference is who can reach it.

## Once, to create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
   Region **Southeast Asia (Singapore)** is the closest free-tier region to NZ.
   Keep the database password; the CLI asks for it.
2. The **project ref** is in the dashboard URL: `dashboard/project/<ref>`.

## Once, to link this repo to it

Both of these are interactive — a browser popup and a password prompt — so they
have to be run by a person, not a script.

```bash
npx supabase login
npx supabase link --project-ref <ref>
```

## Every time, to publish

```bash
npx supabase db push --include-seed
```

`--include-seed` matters. Without it you get the schema and an empty database:
`db push` runs migrations only, and both `seed.sql` and `gis-ingest.sql` are
seed files listed under `[db.seed] sql_paths` in `supabase/config.toml`.

## Then check it, don't assume it

The contract suite takes a URL and a key, so point it at the hosted project and
watch the same fifteen guarantees hold there:

```bash
npm run check -- https://<ref>.supabase.co <anon key>
```

If `silver is unreachable over HTTP` fails on the hosted instance, stop and fix
that before sharing the URL with anyone. It is the check the whole design rests
on.

## What being online actually means

- **`gold` becomes world-readable.** That is the intent. It is also why the PII
  filtering is structural — `silver` is not on the exposed schema list, so there
  is no URL that reaches it — rather than a policy that has to be correct.
- **Anyone can file a report.** `submit_report` is granted to `anon`, because a
  public reporting channel that needs an account is not a public reporting
  channel. There is no rate limiting. If the URL is being shared widely, that is
  a known gap, not an oversight.
- **Nobody can move a report's status.** `advance_status` is granted to
  `service_role` only. "Completed & confirmed" is a Council statement about the
  world, and a public key must not be able to make it.
- **The seeded reports are synthetic and say so.** Every one carries
  `isSynthetic: true` through to the API. No real person appears in this data.

## The anon key is not a secret

It is designed to be shipped in a browser. It identifies the project and
nothing else, and every permission it has is one we granted on purpose. The
**service role key** is a different matter: it bypasses everything, belongs only
in server-side environment variables, and must never reach the repo — `.env` is
in `.gitignore` for that reason.
