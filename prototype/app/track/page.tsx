import { Suspense } from 'react'
import type { Metadata } from 'next'
import Tracker from '../../components/Tracker'

export const metadata: Metadata = { title: 'Track a report — Wellington (prototype)' }

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-narrow px-gutter py-section">
      <h1 className="text-3xl font-bold tracking-[-0.015em]">Track a report</h1>
      <span aria-hidden="true" className="rule-yellow mt-4" />
      <p className="mt-4 max-w-measure">
        Enter the reference number you were given when you submitted. It looks like{' '}
        <span className="ref">WCC-4KDPM</span>.
      </p>
      <Suspense fallback={<p className="mt-6 hint">Loading…</p>}>
        <Tracker />
      </Suspense>
    </div>
  )
}
