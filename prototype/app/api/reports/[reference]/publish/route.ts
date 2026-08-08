// Publish a verified report to the shared reports feed.
//
// Guarded on `verified`, which is the entire point: the value of a published
// dataset is that everything in it was confirmed by someone who was there. A
// publish button that will push anything makes the feed exactly as trustworthy
// as the unverified reports already on it.

import { NextResponse } from 'next/server'
import { getReport, markPublished } from '../../../../../lib/store'
import { publishReport, publishTarget } from '../../../../../lib/publish'

type Context = { params: Promise<{ reference: string }> }

export const dynamic = 'force-dynamic'

/** What the console needs to describe the publish path before anyone uses it. */
export async function GET() {
  return NextResponse.json({ target: publishTarget() })
}

export async function POST(_request: Request, { params }: Context) {
  const { reference } = await params
  const report = getReport(reference)
  if (!report) return NextResponse.json({ error: 'No report with that reference' }, { status: 404 })

  if (report.status !== 'verified') {
    return NextResponse.json(
      {
        error:
          'Only a verified report can be published. Confirm it with a first responder first.',
      },
      { status: 409 },
    )
  }

  const result = await publishReport(report)
  const updated = markPublished(report.reference, {
    at: result.at,
    error: result.error,
    publishedReference: result.reference,
  })

  // The push failing is not this endpoint failing — the outcome was recorded and
  // the console needs to render it. 200 with `ok: false` and the reason.
  return NextResponse.json({
    ok: result.ok,
    error: result.error,
    reference: result.reference,
    report: updated,
  })
}
