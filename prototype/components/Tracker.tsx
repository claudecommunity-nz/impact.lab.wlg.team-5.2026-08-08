'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { STATUSES, statusById } from '../lib/schema'
import type { Report, StatusId } from '../lib/types'
import { faultLabel } from '../lib/taxonomy'
import { formatWhen, relativeWhen } from '../lib/time'

export default function Tracker() {
  const params = useSearchParams()
  const [reference, setReference] = useState(params.get('ref') || '')
  const [report, setReport] = useState<Report | null>(null)
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
        setError('We could not find a report with that reference. Please check the letters again.')
        return
      }
      const data = await res.json()
      setReport(data.report)
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
          aria-label="Reference number"
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Checking…' : 'Check status'}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded border border-urgent bg-red-50 p-4 text-sm font-medium text-urgent">
          {error}
        </p>
      )}

      {report && <ReportStatus report={report} />}
    </div>
  )
}

function ReportStatus({ report }: { report: Report }) {
  const status = statusById(report.status)

  return (
    <div className="card mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-council-ink/60">{report.reference}</p>
          <h2 className="text-xl font-bold">{faultLabel(report.service, report.faultType)}</h2>
          <p className="hint">{report.locAddress || 'Location pinned on the map'}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${status.tone}`}>
          {status.label}
        </span>
      </div>

      <p className="mt-4 rounded border border-council-line bg-council-sand p-4">
        {status.residentText}
        {report.statusNote && (
          <>
            <br />
            <span className="mt-2 block text-sm text-council-ink/70">“{report.statusNote}”</span>
          </>
        )}
      </p>

      <StatusRail current={report.status} />

      <div className="mt-6">
        <h3 className="font-bold">Everything that has happened</h3>
        <ol className="mt-3 space-y-3">
          {report.timeline.map((entry, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: statusById(entry.status).dot }}
              />
              <div>
                <p className="font-semibold">{statusById(entry.status).label}</p>
                {entry.note && <p className="text-sm text-council-ink/70">{entry.note}</p>}
                <p className="text-xs text-council-ink/50">
                  {formatWhen(entry.at)} · {relativeWhen(entry.at)} · {entry.by}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 border-t border-council-line pt-4">
        <h3 className="font-bold">What you told us</h3>
        <p className="mt-1 whitespace-pre-wrap text-council-ink/80">{report.faultDesc}</p>
        <p className="mt-2 text-xs text-council-ink/50">
          Submitted {formatWhen(report.submittedAt)}
          {report.attachmentUploadKeys.length > 0 &&
            ` · ${report.attachmentUploadKeys.length} photo${report.attachmentUploadKeys.length > 1 ? 's' : ''}`}
        </p>
      </div>

      <p className="mt-4 text-xs text-council-ink/50">This page refreshes itself every few seconds.</p>
    </div>
  )
}

// A resident should be able to see the whole path, including the steps that
// have not happened yet. "Received" with nothing after it for two days is
// information, and hiding it is what makes the current channel feel like a void.
function StatusRail({ current }: { current: StatusId }) {
  const path = STATUSES.filter((s) => s.id !== 'no-action')
  const currentIndex = path.findIndex((s) => s.id === current)

  return (
    <ol className="mt-5 flex flex-wrap gap-2">
      {path.map((s, i) => {
        const done = currentIndex >= i && currentIndex !== -1
        return (
          <li
            key={s.id}
            className={`flex-1 rounded border px-3 py-2 text-sm font-semibold ${
              done ? s.tone : 'border-dashed border-council-line bg-white text-council-ink/35'
            }`}
          >
            {s.label}
          </li>
        )
      })}
    </ol>
  )
}
