import { NextResponse } from 'next/server'
import { getReport, updateStatus } from '../../../../lib/store'
import { STATUSES } from '../../../../lib/schema'
import type { StatusId } from '../../../../lib/types'

type Context = { params: Promise<{ reference: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: Context) {
  const { reference } = await params
  const report = getReport(reference)
  if (!report) return NextResponse.json({ error: 'No report with that reference' }, { status: 404 })
  return NextResponse.json({ report })
}

export async function PATCH(request: Request, { params }: Context) {
  const { reference } = await params
  const body = (await request.json().catch(() => ({}))) as { status?: string; note?: string }

  if (!STATUSES.some((s) => s.id === body.status)) {
    return NextResponse.json({ error: 'Unknown status' }, { status: 422 })
  }

  const report = updateStatus(reference, { status: body.status as StatusId, note: body.note })
  if (!report) return NextResponse.json({ error: 'No report with that reference' }, { status: 404 })
  return NextResponse.json({ report })
}
