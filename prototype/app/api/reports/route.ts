import { NextResponse } from 'next/server'
import { createReport, fixClaimsByReference, groupReports, listReports } from '../../../lib/store'
import { validate } from '../../../lib/schema'
import { publishTarget } from '../../../lib/publish'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const service = searchParams.get('service')
  const status = searchParams.get('status')

  let reports = listReports()
  if (service) reports = reports.filter((r) => r.service === service)
  if (status) reports = reports.filter((r) => r.status === status)

  return NextResponse.json({
    count: reports.length,
    reports,
    groups: groupReports(reports),
    // Claims are keyed by reference rather than folded into each report: the
    // console has to show them as a separate kind of fact from anything the
    // Council set, and a field on the report invites exactly that confusion.
    claims: fixClaimsByReference(),
    publishTarget: publishTarget(),
  })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { ok, errors } = validate(body as Record<string, unknown>)
  if (!ok) return NextResponse.json({ errors }, { status: 422 })

  const report = createReport(body as Record<string, unknown>)
  return NextResponse.json({ report }, { status: 201 })
}
