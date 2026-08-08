import { Suspense } from 'react'
import type { Metadata } from 'next'
import Tracker from '../../components/Tracker'

export const metadata: Metadata = { title: 'Track a report — Wellington (prototype)' }

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Track a report</h1>
      <p className="mt-2 hint">
        Enter the reference number you were given when you submitted. It looks like WCC-4KDPM.
      </p>
      <Suspense fallback={<p className="mt-6 hint">Loading…</p>}>
        <Tracker />
      </Suspense>
    </div>
  )
}
