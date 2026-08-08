'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import FixedIt from './FixedIt'
import { formatWhen, relativeWhen } from '../lib/time'
import type { PublicReport, StatusEvent } from '../lib/publicFeed'
import type { FixClaim, Report, ReportGroup } from '../lib/types'

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
  historyError: string | null
  reports: Report[]
  details: PublicReport[]
  groups: ReportGroup[]
  claims: Record<string, FixClaim>
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
          Map for Communities
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
            <Detail
              report={chosen}
              historyError={data?.historyError || null}
              claim={data?.claims?.[chosen.reference] || null}
              onClaimed={load}
              onClear={() => setSelected(null)}
            />
          ) : (
            <List
              reports={data?.details || []}
              claims={data?.claims || {}}
              onSelect={setSelected}
            />
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
  claims,
  onSelect,
}: {
  reports: PublicReport[]
  claims: Record<string, FixClaim>
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
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag>{report.statusLabel || report.status}</Tag>
              {report.isSynthetic && <Tag tone="warning">Test data</Tag>}
              {claims[report.reference] && <Tag tone="claim">Reported fixed</Tag>}
            </span>
            {latestUpdate(report) && (
              <span className="mt-1.5 block text-xs text-grey-600">
                {report.timeline.length} update{report.timeline.length === 1 ? '' : 's'} — last by{' '}
                {latestUpdate(report)?.by}, {relativeWhen(latestUpdate(report)?.at)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

function latestUpdate(report: PublicReport): StatusEvent | null {
  return report.timeline.length ? report.timeline[report.timeline.length - 1] : null
}

function Detail({
  report,
  historyError,
  claim,
  onClaimed,
  onClear,
}: {
  report: PublicReport
  historyError: string | null
  claim: FixClaim | null
  onClaimed: () => void
  onClear: () => void
}) {
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

      <Timeline report={report} historyError={historyError} />

      <FixedIt
        reference={report.reference}
        claim={claim}
        onClaimed={onClaimed}
        source="feed"
      />

      {report.ownershipNote && <p className="mt-3 hint">{report.ownershipNote}</p>}
    </div>
  )
}

// What has actually happened to the report, from the feed's own status trail.
//
// Chronological, oldest first, because that is the shape of the question a
// reporter is asking — what happened after I sent this. Every entry names who
// moved it, and `actorRole` distinguishes a status the system set on receipt
// from one a duty officer or a partner agency set deliberately.
function Timeline({
  report,
  historyError,
}: {
  report: PublicReport
  historyError: string | null
}) {
  const events = report.timeline

  if (!events.length) {
    return (
      <div className="mt-4 border-t border-grey-200 pt-3">
        <h3 className="text-sm font-semibold">What has happened</h3>
        {historyError ? (
          <p className="mt-1 text-sm text-error-fg">
            The status history did not load — <span className="ref">{historyError}</span>. This is
            not the same as nothing having happened.
          </p>
        ) : (
          <p className="mt-1 hint">No status updates recorded on the feed.</p>
        )}
        {report.statusNote && <p className="mt-2 text-sm">{report.statusNote}</p>}
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-grey-200 pt-3">
      <h3 className="text-sm font-semibold">
        What has happened{' '}
        <span className="font-normal text-muted">
          ({events.length} update{events.length === 1 ? '' : 's'})
        </span>
      </h3>

      <ol className="mt-3 space-y-3">
        {events.map((event, i) => {
          const current = i === events.length - 1
          return (
            <li key={`${event.at}-${i}`} className="grid grid-cols-[auto_1fr] gap-3">
              <span aria-hidden="true" className="flex flex-col items-center pt-1">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    current ? 'bg-wcc-black' : 'bg-grey-300'
                  }`}
                />
                {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-grey-300" />}
              </span>

              <div className="pb-1 text-sm">
                <p className={current ? 'font-semibold' : 'font-medium'}>
                  {event.statusLabel || event.status}
                  {current && (
                    <span className="ml-2 text-xs font-normal text-muted">Current</span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {formatWhen(event.at)} — {event.by || 'unknown'}
                  {event.actorRole === 'system' && ' (automatic)'}
                  {event.agency && event.agency !== event.by && ` · ${event.agency}`}
                </p>
                {event.note && <p className="mt-1">{event.note}</p>}
                {event.externalTicketRef && (
                  <p className="mt-1 text-xs text-muted">
                    Ticket <span className="ref">{event.externalTicketRef}</span>
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
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

const TAG_TONES: Record<string, string> = {
  warning: 'bg-warning-bg text-warning-fg',
  // Outlined, not filled: someone said this is fixed, which is not the same
  // kind of fact as the statuses beside it and should not look like one.
  claim: 'border border-wcc-black bg-wcc-white text-wcc-black',
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warning' | 'claim' }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] ${
        (tone && TAG_TONES[tone]) || 'bg-grey-100 text-grey-700'
      }`}
    >
      {children}
    </span>
  )
}
