'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import FixedIt from './FixedIt'
import { STATUSES, statusById } from '../lib/schema'
import type { FixClaim, Report, StatusId } from '../lib/types'
import { faultLabel } from '../lib/taxonomy'
import { formatWhen, relativeWhen } from '../lib/time'

export default function Tracker() {
  const params = useSearchParams()
  const [reference, setReference] = useState(params.get('ref') || '')
  const [report, setReport] = useState<Report | null>(null)
  const [claim, setClaim] = useState<FixClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function lookup(ref: string): Promise<void> {
    const trimmed = ref.trim().toUpperCase()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(trimmed)}`)
      if (res.status === 404) {
        setReport(null)
        setClaim(null)
        setError('We could not find a report with that reference. Please check the letters again.')
        return
      }
      const data = await res.json()
      setReport(data.report)
      setClaim(data.claim || null)
    } catch {
      setError('We could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Deep link from the receipt screen.
  useEffect(() => {
    const ref = params.get('ref')
    if (ref) lookup(ref)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // While the report is open, keep it current — the point of the whole thing is
  // that the resident sees the status change without having to ask anyone.
  useEffect(() => {
    if (!report) return
    const id = setInterval(() => lookup(report.reference), 5000)
    return () => clearInterval(id)
  }, [report?.reference]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <form
        className="mt-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          lookup(reference)
        }}
      >
        <input
          className="field flex-1 font-mono uppercase"
          placeholder="WCC-XXXXX"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-label="Reference number"
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Checking…' : 'Check status'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 border-t-rule border-error-fg bg-error-bg px-5 py-4 font-semibold text-error-fg">
          {error}
        </p>
      )}

      {report && (
        <ReportStatus report={report} claim={claim} onClaimed={() => lookup(report.reference)} />
      )}
    </div>
  )
}

function ReportStatus({
  report,
  claim,
  onClaimed,
}: {
  report: Report
  claim: FixClaim | null
  onClaimed: () => void
}) {
  const status = statusById(report.status)

  return (
    <div className="card card-accent mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ref text-muted">{report.reference}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.015em]">
            {faultLabel(report.service, report.faultType)}
          </h2>
          <p className="mt-1 hint">{report.locAddress || 'Location pinned on the map'}</p>
        </div>
        <StatusTag status={report.status} />
      </div>

      <p className="mt-4 max-w-measure rounded border border-grey-200 bg-grey-50 p-4">
        {status.residentText}
        {report.statusNote && (
          <span className="mt-2 block text-sm text-grey-600">“{report.statusNote}”</span>
        )}
      </p>

      <StatusRail current={report.status} />

      <FixedIt reference={report.reference} claim={claim} onClaimed={onClaimed} />

      <div className="mt-6">
        <h3 className="text-lg font-semibold">Everything that has happened</h3>
        <ol className="mt-3 space-y-3">
          {report.timeline.map((entry, i) => (
            <li key={i} className="flex gap-3">
              {/* Status is carried by the label; the dot only locates it. */}
              <span
                aria-hidden="true"
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: statusById(entry.status).dot }}
              />
              <div>
                <p className="font-semibold">{statusById(entry.status).label}</p>
                {entry.note && <p className="text-sm text-grey-600">{entry.note}</p>}
                <p className="text-xs text-muted">
                  {formatWhen(entry.at)} · {relativeWhen(entry.at)} · {entry.by}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 border-t border-grey-200 pt-4">
        <h3 className="text-lg font-semibold">What you told us</h3>
        <p className="mt-1 max-w-measure whitespace-pre-wrap">{report.faultDesc}</p>
        <p className="mt-2 text-xs text-muted">
          Submitted {formatWhen(report.submittedAt)}
          {report.attachmentUploadKeys.length > 0 &&
            ` · ${report.attachmentUploadKeys.length} photo${report.attachmentUploadKeys.length > 1 ? 's' : ''}`}
        </p>
      </div>

      <p className="mt-4 text-xs text-muted">This page refreshes itself every few seconds.</p>
    </div>
  )
}

// Pills are reserved for status tags in this system, set in the overline role:
// 12px semibold, uppercase, wide tracking.
function StatusTag({ status }: { status: StatusId }) {
  const definition = statusById(status)
  return (
    <span
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.04em] ${definition.tone}`}
    >
      {definition.label}
    </span>
  )
}

// A resident should be able to see the whole path, including the steps that
// have not happened yet. "Received" with nothing after it for two days is
// information, and hiding it is what makes the current channel feel like a void.
function StatusRail({ current }: { current: StatusId }) {
  const path = STATUSES.filter((s) => s.id !== 'no-action')
  const currentIndex = path.findIndex((s) => s.id === current)

  return (
    <ol className="mt-5 flex gap-2">
      {path.map((s, i) => {
        const done = currentIndex >= i && currentIndex !== -1
        const now = currentIndex === i
        return (
          <li key={s.id} className="flex flex-1 flex-col gap-2">
            {/* The 4px rule again: black for steps reached, yellow for the one
                you are on, grey for the ones still ahead. */}
            <span
              aria-hidden="true"
              className={`block h-rule rounded-full ${
                now ? 'bg-wcc-yellow' : done ? 'bg-wcc-black' : 'bg-grey-200'
              }`}
            />
            <span
              className={`text-sm ${now ? 'font-semibold text-wcc-black' : done ? '' : 'text-muted'}`}
              aria-current={now ? 'step' : undefined}
            >
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
