// Publishing a verified report to the shared feed.
//
// `lib/publicFeed.ts` reads that feed. This is the other direction. It is the
// only place in the prototype that writes to the database, and the only place
// that touches the service role key.
//
// An earlier version of this file POSTed a row at `/rest/v1/report`. That was
// written before `supabase/` existed in the repo and it was simply wrong:
// `gold.report` is a read projection over a sealed `silver`, and Postgres will
// not insert into a view built with a WITH clause. The database has a designed
// API and this now uses it.
//
// Publishing is two calls, in this order:
//
//   gold.submit_report   the only write path into silver. Validates hard —
//                        fault type, service, bounds, severity — and mints its
//                        own reference, which is why `publishedReference` is
//                        kept: the upstream report is a different record from
//                        ours and pretending otherwise loses the link.
//   gold.confirm_report  raises verification_level to field_confirmed and names
//                        the agency that confirmed it. Service role only, so
//                        this cannot be done from a browser.
//
// The second call is the whole point. Without it the report lands on the feed
// as `unverified` with a disclaimer saying so, which is worse than not
// publishing: it adds noise to a feed whose value is that it is checked.

import { statusById, verifierByName } from './schema'
import type { Report } from './types'

/** `https://<ref>.supabase.co`, no trailing slash. */
export function supabaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  return raw ? raw.replace(/\/+$/, '') : null
}

/**
 * Server-side only. Never import this into anything a client component reaches:
 * the key bypasses every grant in `20260808000006_grants.sql`, including the
 * ones that stop the public advancing a status.
 */
function serviceKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

export interface PublishTarget {
  /** Where reports go, for the console to show before anyone presses publish. */
  url: string | null
  configured: boolean
  /** Why it is not configured, in words an operator can act on. */
  reason: string | null
}

export function publishTarget(): PublishTarget {
  const url = supabaseUrl()
  if (!url) {
    return {
      url: null,
      configured: false,
      reason: 'No NEXT_PUBLIC_SUPABASE_URL is set. Copy .env.example to .env and fill it in.',
    }
  }
  if (!serviceKey()) {
    return {
      url: `${url}/rest/v1/rpc/submit_report`,
      configured: false,
      reason:
        'No SUPABASE_SERVICE_ROLE_KEY is set. Confirming a report is deliberately refused to ' +
        'the anon key, so publishing needs the service role key in .env (never in .env.example).',
    }
  }
  return { url: `${url}/rest/v1/rpc/submit_report`, configured: true, reason: null }
}

export interface PublishResult {
  ok: boolean
  at: string | null
  /** The reference the report was given upstream. Not ours — gold mints its own. */
  reference: string | null
  error: string | null
}

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const key = serviceKey() as string
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    // PostgREST puts the useful part in the body — the Postgres error code and
    // the message the function raised. Carry it through rather than the status
    // code alone, which only ever says "400".
    const text = await res.text().catch(() => '')
    let detail = text
    try {
      const parsed = JSON.parse(text) as { message?: string; hint?: string; code?: string }
      detail = [parsed.message, parsed.hint].filter(Boolean).join(' — ') || text
      if (parsed.code) detail = `${detail} (${parsed.code})`
    } catch {
      /* not JSON; the raw body is the best we have */
    }
    throw new Error(`${name} responded ${res.status}. ${detail}`.trim())
  }

  return res.json()
}

export async function publishReport(report: Report): Promise<PublishResult> {
  const target = publishTarget()
  if (!target.configured) {
    return { ok: false, at: null, reference: null, error: target.reason }
  }

  // Who confirmed it, read back off the trail. The console cannot reach this
  // code path without a verified status, but the agency is what gold.confirm_report
  // records, so a verified report whose verifier we cannot name is a bug worth
  // stopping for rather than publishing as anonymous.
  const verifiedEntry = [...report.timeline].reverse().find((e) => e.status === 'verified')
  const verifier = verifierByName(verifiedEntry?.by)
  if (!verifier) {
    return {
      ok: false,
      at: null,
      reference: null,
      error:
        'This report is verified but the trail does not name a known agency, so there is ' +
        'nothing to publish it under. Verify it again from the console.',
    }
  }

  try {
    // Parameter names are exactly gold.submit_report's, so nothing is remapped.
    // No contact fields: the feed is public, and the gold view would strip them
    // anyway. Not sending them at all is the stronger guarantee.
    const submitted = (await rpc('submit_report', {
      service: report.service,
      faultType: report.faultType,
      faultDesc: report.faultDesc,
      locLatitude: report.locLatitude,
      locLongitude: report.locLongitude,
      severity: report.severity,
      locAddress: report.locAddress,
      locSuburb: report.locSuburb,
      reporterKind: report.reporterKind,
      hubName: report.hubName,
      attachmentUploadKeys: report.attachmentUploadKeys,
      observedAt: report.observedAt,
      sourceChannel: 'wcc-console-publish',
    })) as { reference?: string }

    const reference = submitted?.reference
    if (!reference) throw new Error('submit_report returned no reference')

    // Now the part anon is refused. `field_confirmed` is what makes this a
    // verified dataset rather than one more unverified post.
    await rpc('confirm_report', {
      reference,
      agencyCode: verifier.agencyCode,
      level: 'field_confirmed',
      note:
        report.statusNote ||
        `Confirmed on the ground by ${verifier.by}. Published from the WCC console ` +
          `(local reference ${report.reference}, status ${statusById(report.status).label}).`,
      by: verifier.by,
    })

    return { ok: true, at: new Date().toISOString(), reference, error: null }
  } catch (err) {
    return {
      ok: false,
      at: null,
      reference: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
