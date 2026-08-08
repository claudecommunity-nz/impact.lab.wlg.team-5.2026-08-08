'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatWhen, relativeWhen } from '../lib/time'
import type { PublicReport } from '../lib/publicFeed'
import type { Report, ReportGroup } from '../lib/types'

// The public read-only view of the shared reports feed.
//
// The map is the Council's published ArcGIS app, embedded. Worth being plain
// about what that costs: it draws its own layers — suburb boundaries, public
// toilets, Community Emergency Hubs — and it cannot draw the community reports
// on this page, because a cross-origin iframe will not take a data source from
// us. So the reports are the list beside it, not pins on it.
//
// What still ties the two together is selection: picking a report recentres the
// embedded map on its coordinates. That is one-way. Nothing done inside the
// map comes back out.
const NEARBY_APP =
  'https://www.arcgis.com/apps/instant/nearby/index.html?appid=8220d135781b45e7b4f236288fd852aa'

interface FeedResponse {
  count: number
  syntheticCount: number
  disclaimer: string | null
  fetchedAt: string
  error: string | null
  reports: Report[]
  details: PublicReport[]
  groups: ReportGroup[]
}

const REFRESH_MS = 15000

export default function PublicMap() {
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public-feed')
      if (!res.ok) throw new Error(`Feed responded ${res.status}`)
      setData(await res.json())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const details = useMemo(
    () => new Map((data?.details || []).map((d) => [d.reference, d])),
    [data],
  )

  const chosen = selected ? details.get(selected) || null : null
  const error = loadError || data?.error || null

  // Instant Apps honour these when URL parameters are enabled; if this one does
  // not, it opens at its own extent and the rest of the page is unaffected.
  const src = chosen ? `${NEARBY_APP}&center=${chosen.lng},${chosen.lat}&level=17` : NEARBY_APP

  return (
    <div>
      <header>
        <h1 className="max-w-measure text-4xl font-bold tracking-[-0.015em]">
          What people are reporting
        </h1>
        <span aria-hidden="true" className="rule-yellow mt-4" />
        <p className="mt-4 max-w-measure text-lg">
          Community reports on the shared feed, alongside the Council&apos;s published map of local
          resources. This page only reads — nothing here is a Council decision, and no status on it
          was set by anyone at the Council.
        </p>
      </header>

      {data && data.syntheticCount > 0 && (
        <div role="alert" className="mt-6 border-t-rule border-warning-fg bg-warning-bg p-6">
          <h2 className="text-xl font-semibold text-warning-fg">
            {data.syntheticCount} of the {data.count} reports on this feed are test data
          </h2>
          <p className="mt-2 max-w-measure text-sm">
            The feed flags them <span className="ref">isSynthetic</span> and they are marked below.
            They were generated to fill the feed, not observed by anyone. Do not read them as
            conditions on the ground.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-6 border-t-rule border-error-fg bg-error-bg p-6">
          <h2 className="text-xl font-semibold text-error-fg">The feed did not load</h2>
          <p className="mt-2 max-w-measure text-sm">
            <span className="ref">{error}</span> — the list below is showing whatever loaded last,
            which may be nothing at all. It is not evidence that there is nothing happening.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_26rem]">
        <div>
          <iframe
            src={src}
            title="Find your local community resources — Wellington City Council"
            className="h-[34rem] w-full rounded border border-grey-300 lg:h-[44rem]"
            referrerPolicy="no-referrer-when-downgrade"
            allow="geolocation"
          />
          <p className="mt-2 max-w-measure hint">
            The Council&apos;s published map, embedded. It shows its own layers — suburb boundaries,
            public toilets and Community Emergency Hubs.{' '}
            <strong>The community reports are not on it.</strong> They are the list on the right,
            because an embedded map cannot take a data source from this page. Choosing a report
            recentres the map on where it was reported.
          </p>
        </div>

        <div className="card overflow-hidden">
          {chosen ? (
            <Detail report={chosen} onClear={() => setSelected(null)} />
          ) : (
            <List reports={data?.details || []} onSelect={setSelected} />
          )}
        </div>
      </div>

      <p className="mt-4 max-w-measure hint">
        {data?.disclaimer ||
          'Unverified community reports. Not an operational emergency source. In an emergency call 111.'}
      </p>
      {data && (
        <p className="mt-1 hint">
          Feed read {formatWhen(data.fetchedAt)}, then every {REFRESH_MS / 1000} seconds.
        </p>
      )}
    </div>
  )
}

function List({
  reports,
  onSelect,
}: {
  reports: PublicReport[]
  onSelect: (reference: string) => void
}) {
  if (!reports.length) {
    return <p className="p-6 text-center hint">No reports on the feed.</p>
  }

  return (
    <ul className="max-h-[44rem] divide-y divide-grey-200 overflow-y-auto">
      {reports.map((report) => (
        <li key={report.reference}>
          <button
            type="button"
            className="block w-full p-4 text-left hover:bg-grey-50"
            onClick={() => onSelect(report.reference)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="ref text-sm">{report.reference}</span>
              <span className="text-xs text-muted">{relativeWhen(report.submittedAt)}</span>
            </span>
            <span className="mt-1 block font-semibold">{report.faultLabel || report.faultType}</span>
            <span className="block text-sm text-grey-600">{report.suburb || 'Unknown suburb'}</span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              <Tag>{report.statusLabel || report.status}</Tag>
              {report.isSynthetic && <Tag tone="warning">Test data</Tag>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Detail({ report, onClear }: { report: PublicReport; onClear: () => void }) {
  return (
    <div className="max-h-[44rem] overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="ref text-sm">{report.reference}</span>
        <button type="button" className="text-sm underline" onClick={onClear}>
          Back to list
        </button>
      </div>

      <h2 className="mt-2 text-xl font-semibold">{report.faultLabel || report.faultType}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Tag>{report.statusLabel || report.status}</Tag>
        {report.isSynthetic && <Tag tone="warning">Test data</Tag>}
      </div>

      {report.isSynthetic && (
        <p className="mt-3 border-t-rule border-warning-fg bg-warning-bg p-3 text-sm">
          Generated test data, flagged by the feed. Nobody observed this.
        </p>
      )}

      {report.description && <p className="mt-3">{report.description}</p>}

      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Where" value={report.address} />
        <Row label="Suburb" value={report.suburb} />
        <Row label="Coordinates" value={`${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`} />
        <Row label="Location precision" value={report.locationPrecision} />
        <Row label="Observed" value={formatWhen(report.observedAt)} />
        <Row label="Submitted" value={formatWhen(report.submittedAt)} />
        <Row label="Severity" value={`${report.severity} — the reporter's own words`} />
        <Row label="Priority" value={report.priorityLabel} />
        <Row label="Priority basis" value={report.priorityBasisLabel} />
        <Row label="Verification" value={report.verificationLevel} />
        <Row label="Who leads" value={report.ownershipLabel} />
        <Row label="Assigned to" value={report.assignedAgency || report.partnerAgency} />
        <Row label="Reported by" value={report.hubName || report.reporterKind} />
        <Row label="Photos" value={report.photoCount ? `${report.photoCount}` : null} />
      </dl>

      {report.statusNote && (
        <p className="mt-4 border-t border-grey-200 pt-3 text-sm">
          <strong>Latest update:</strong> {report.statusNote}
          {report.statusUpdatedAt && (
            <span className="text-muted"> — {formatWhen(report.statusUpdatedAt)}</span>
          )}
        </p>
      )}

      {report.ownershipNote && <p className="mt-3 hint">{report.ownershipNote}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2">
      <dt className="text-grey-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warning' }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] ${
        tone === 'warning' ? 'bg-warning-bg text-warning-fg' : 'bg-grey-100 text-grey-700'
      }`}
    >
      {children}
    </span>
  )
}
