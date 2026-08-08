# Team 5 — design docs

Problem 02: a two-way information channel between communities and WCC.

## These are living docs — update them as you go

**If you change the design, change the doc in the same commit.** Not afterwards,
not at the end of the day. A doc that describes yesterday's schema is worse than
no doc, because someone will build against it.

The rule, concretely:

| If you change… | Update… |
|---|---|
| a migration in `supabase/migrations/` | [data-model.md](data-model.md) |
| anything on the gap list, once it's fixed | [workflow-gaps.md](workflow-gaps.md) — delete the entry |
| a `gold.*` view, RPC signature or grant | [api.md](api.md) — this is the contract other teams read |
| how location, PII, verification or disclaimers work | [trust-and-privacy.md](trust-and-privacy.md) |
| ownership or priority classification | [classification.md](classification.md) |
| why something is built the way it is | [decisions.md](decisions.md) — append, don't rewrite |

Every doc ends with a **Verified against** line: the files it was last read
against, and when. If you touch a doc, update that line. If you read a doc and
the line is stale, trust the code and fix the doc.

Two failure modes worth naming, because both have already nearly happened
today:

- **Two people editing the same migration from different assumptions.** Check
  `git status` before you start. Say in chat which files you have open.
- **Documenting the plan instead of the code.** Write what exists. Anything
  not built yet goes under a heading that says so.

## The docs

- **[architecture.md](architecture.md)** — the two-tier (silver/gold) shape and
  why the containment is structural rather than policy.
- **[data-model.md](data-model.md)** — schemas, tables, enums, what each column
  is for.
- **[api.md](api.md)** — the public contract: `gold` views and RPCs, with the
  parameters and the shape of what comes back.
- **[trust-and-privacy.md](trust-and-privacy.md)** — location fuzzing, PII
  containment, verification levels, disclaimers, refused intake.
- **[classification.md](classification.md)** — WCC ownership and the 1–4 triage
  priority.
- **[workflow-gaps.md](workflow-gaps.md)** — **read this first if you are
  picking up work.** What is verified working end to end, and the seven things
  that are not, each with the fix.
- **[decisions.md](decisions.md)** — the choices worth remembering, dated.

## Constraints that override anything in here

From [CLAUDE.md](../CLAUDE.md), repeated because they are easy to lose at speed:

- Hazard-planning and prototype data, **not** an operational emergency source.
  In an emergency, 111.
- Show reliability, don't hide it. If we infer or aggregate, the interface says
  so.
- This repo is public and must stay free of personal information.

---

**Verified against:** `supabase/migrations/*` (0001–0007), `supabase/config.toml`,
`prototype/` — 8 August 2026.
