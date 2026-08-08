import { NextResponse } from 'next/server'
import { fixClaimsByReference, getReport, updateStatus } from '../../../../lib/store'
import { STATUSES, verifierById } from '../../../../lib/schema'
import type { StatusId } from '../../../../lib/types'

type Context = { params: Promise<{ reference: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: Context) {
  const { reference } = await params
  const report = getReport(reference)
  if (!report) return NextResponse.json({ error: 'No report with that reference' }, { status: 404 })
  const claim = fixClaimsByReference()[report.reference] || null
  return NextResponse.json({ report, claim })
}

export async function PATCH(request: Request, { params }: Context) {
  const { reference } = await params
  const body = (await request.json().catch(() => ({}))) as {
    status?: string
    note?: string
    verifier?: string
  }

  if (!STATUSES.some((s) => s.id === body.status)) {
    return NextResponse.json({ error: 'Unknown status' }, { status: 422 })
  }

  // Verified is the one status that is worthless without a name attached — it
  // means an organisation confirmed this, so it cannot be set by nobody.
  const verifier = verifierById(body.verifier)
  if (body.status === 'verified' && !verifier) {
    return NextResponse.json(
      { error: 'Verifying a report needs a known verifier' },
      { status: 422 },
    )
  }

  const report = updateStatus(reference, {
    status: body.status as StatusId,
    note: body.note,
    ...(verifier ? { by: verifier.by } : {}),
  })
  if (!report) return NextResponse.json({ error: 'No report with that reference' }, { status: 404 })
  return NextResponse.json({ report })
}
