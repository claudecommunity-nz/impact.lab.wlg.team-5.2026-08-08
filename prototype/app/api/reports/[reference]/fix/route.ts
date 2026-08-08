// "I fixed it" — a member of the public saying a reported problem is now sorted.
//
// This deliberately does not change the report's status. A resident clearing a
// drain is real information and the Council should have it within seconds; it is
// not the Council having checked. The claim lands in the console as a claim, and
// a duty officer decides whether to verify it.
//
// It accepts a reference that has no local report, because the public map shows
// reports from the shared feed which this prototype does not own. Those claims
// are kept and shown as being against the feed.

import { NextResponse } from 'next/server'
import { claimFixed, getReport } from '../../../../../lib/store'
import { REPORTER_KINDS } from '../../../../../lib/schema'
import type { ReporterKindId } from '../../../../../lib/types'

type Context = { params: Promise<{ reference: string }> }

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: Context) {
  const { reference } = await params
  const body = (await request.json().catch(() => ({}))) as { note?: string; by?: string }

  const trimmed = String(reference || '').trim()
  if (!trimmed) return NextResponse.json({ error: 'A reference is required' }, { status: 422 })

  const by = REPORTER_KINDS.some((k) => k.id === body.by)
    ? (body.by as ReporterKindId)
    : 'resident'

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null

  const claim = claimFixed(trimmed, { note, by })
  return NextResponse.json({ claim, report: getReport(trimmed) }, { status: 201 })
}
