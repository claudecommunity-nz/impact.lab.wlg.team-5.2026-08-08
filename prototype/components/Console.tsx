'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import ReportMap, { shadeFor } from './ReportMap'
import { STATUSES, statusById } from '../lib/schema'
import { SEVERITY_COLOUR } from '../lib/map'
import { SERVICES, faultLabel } from '../lib/taxonomy'
import { formatWhen, relativeWhen } from '../lib/time'
import { countBySuburb, emptyCollection, suburbAt } from '../lib/layers'
import type { SuburbCollection } from '../lib/layers'
import type {
  BoundaryLayerToggles,
  ParcelStatus as ParcelStatusValue,
  Report,
  ReportGroup,
  SeverityId,
  StatusId,
} from '../lib/types'

type QueueFilter = 'open' | 'urgent' | 'hub' | 'all'

const SEVERITY_LABEL: Record<SeverityId, string> = {
  info: 'Info',
  disruption: 'Disruption',
  urgent: 'Urgent',
}
const OPEN_STATUSES: StatusId[] = ['received', 'checking', 'acting']

export default function Console() {
  const [reports, setReports] = useState<Report[]>([])
  const [groups, setGroups] = useState<ReportGroup[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<QueueFilter>('open')
  const [service, setService] = useState('all')
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [layers, setLayers] = useState<BoundaryLayerToggles>({
    suburbs: true,
    parcels: false,
    hubs: false,
  })
  const [suburbs, setSuburbs] = useState<SuburbCollection>(
    emptyCollection() as SuburbCollection,
  )
  const [parcelStatus, setParcelStatus] = useState<ParcelStatusValue>({ state: 'off' })

  const load = useCallback(async () => {
    const res = await fetch('/api/reports')
    const data = await res.json()
    setReports(data.reports)
    setGroups(data.groups)
    setLoadedAt(new Date())
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const visible = useMemo(() => {
    return reports.filter((r) => {
      if (service !== 'all' && r.service !== service) return false
      if (filter === 'open') return OPEN_STATUSES.includes(r.status)
      if (filter === 'urgent') return r.severity === 'urgent' && OPEN_STATUSES.includes(r.status)
      if (filter === 'hub') return r.reporterKind === 'hub'
      return true
    })
  }, [reports, filter, service])

  const visibleGroups = useMemo(() => {
    const refs = new Set(visible.map((r) => r.reference))
    return groups
      .map((g) => ({ ...g, reports: g.reports.filter((r) => refs.has(r.reference)) }))
      .filter((g) => g.reports.length)
      .map((g) => ({ ...g, count: g.reports.length }))
  }, [groups, visible])

  const suburbCounts = useMemo(() => {
    if (!suburbs.features?.length) return new Map()
    return countBySuburb(visible, suburbs)
  }, [visible, suburbs])

  const selectedReport = reports.find((r) => r.reference === selected) || null
  const selectedSuburb = useMemo(() => {
    if (!selectedReport || !suburbs.features?.length) return null
    return suburbAt(selectedReport.locLongitude, selectedReport.locLatitude, suburbs)
  }, [selectedReport, suburbs])
  const selectedGroup = selectedReport
    ? groups.find((g) => g.reports.some((r) => r.reference === selectedReport.reference))
    : null

  async function setStatus(reference: string, status: StatusId, note: string): Promise<void> {
    await fetch(`/api/reports/${reference}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    })
    load()
  }

  return (
    <div>
      <Header reports={reports} loadedAt={loadedAt} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr_24rem]">
        <Queue
          groups={visibleGroups}
          selected={selected}
          onSelect={setSelected}
          filter={filter}
          setFilter={setFilter}
          service={service}
          setService={setService}
          total={visible.length}
          suburbCounts={suburbCounts}
        />

        <div className="card relative h-[38rem] overflow-hidden lg:h-[46rem]">
          <ReportMap
            reports={visible}
            groups={visibleGroups}
            selected={selected}
            onSelect={setSelected}
            layers={layers}
            suburbCounts={suburbCounts}
            onSuburbs={setSuburbs}
            onParcelStatus={setParcelStatus}
          />
          <LayerControl
            layers={layers}
            setLayers={setLayers}
            parcelStatus={parcelStatus}
            suburbsLoaded={suburbs.features?.length || 0}
          />
          <MapLegend showSuburbShading={layers.suburbs} />
        </div>

        <Detail
          report={selectedReport}
          group={selectedGroup}
          suburb={selectedSuburb}
          onStatus={setStatus}
        />
      </div>
    </div>
  )
}

function Header({ reports, loadedAt }: { reports: Report[]; loadedAt: Date | null }) {
  const open = reports.filter((r) => OPEN_STATUSES.includes(r.status))
  const urgent = open.filter((r) => r.severity === 'urgent')
  const unacknowledged = open.filter((r) => r.status === 'received')
  const hubs = reports.filter((r) => r.reporterKind === 'hub')

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.015em]">Incoming community reports</h1>
        <span aria-hidden="true" className="rule-yellow mt-3" />
        <p className="mt-3 max-w-measure hint">
          Unverified public reports. Grouping is inferred from fault type and proximity, not
          confirmed. Nothing here is an operational emergency source.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat label="Open" value={open.length} />
        <Stat label="Urgent" value={urgent.length} tone="text-error-fg" />
        <Stat label="Not yet actioned" value={unacknowledged.length} />
        <Stat label="From hubs" value={hubs.length} />
      </div>
      {loadedAt && (
        <p className="w-full text-xs text-muted">
          Refreshed {formatWhen(loadedAt.toISOString())}, then every 5 seconds.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card min-w-[6rem] px-4 py-2 text-center">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{label}</div>
    </div>
  )
}

interface QueueProps {
  groups: ReportGroup[]
  selected: string | null
  onSelect: (reference: string) => void
  filter: QueueFilter
  setFilter: (filter: QueueFilter) => void
  service: string
  setService: (service: string) => void
  total: number
  suburbCounts: Map<string, number>
}

function Queue({
  groups,
  selected,
  onSelect,
  filter,
  setFilter,
  service,
  setService,
  total,
  suburbCounts,
}: QueueProps) {
  const worstSuburbs = [...(suburbCounts?.entries() || [])]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  return (
    <div className="card flex h-[38rem] flex-col lg:h-[46rem]">
      <div className="space-y-2 border-b border-grey-200 p-3">
        <div className="flex gap-1">
          {([
            ['open', 'Open'],
            ['urgent', 'Urgent'],
            ['hub', 'Hubs'],
            ['all', 'All'],
          ] as [QueueFilter, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`min-h-tap flex-1 rounded px-2 text-sm font-semibold transition-colors duration-fast ease-standard ${
                filter === id
                  ? 'bg-wcc-black text-wcc-white'
                  : 'bg-grey-100 text-grey-700 hover:bg-wcc-yellow hover:text-wcc-black'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select className="field py-1.5 text-sm" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="all">All services</option>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          {total} report{total === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}
        </p>
        {worstSuburbs.length > 0 && (
          <p className="text-xs text-muted">
            Most reports:{' '}
            {worstSuburbs.map(([suburb, count], i) => (
              <span key={suburb}>
                {i > 0 && ', '}
                <strong>{suburb}</strong> ({count})
              </span>
            ))}
          </p>
        )}
      </div>

      <ol className="flex-1 divide-y divide-grey-200 overflow-y-auto">
        {groups.map((group) => (
          <li key={group.key}>
            <GroupRow group={group} selected={selected} onSelect={onSelect} />
          </li>
        ))}
        {!groups.length && <li className="p-6 text-center hint">Nothing matches that filter.</li>}
      </ol>
    </div>
  )
}

function GroupRow({
  group,
  selected,
  onSelect,
}: {
  group: ReportGroup
  selected: string | null
  onSelect: (reference: string) => void
}) {
  const worst = group.reports.some((r) => r.severity === 'urgent')
    ? 'urgent'
    : group.reports.some((r) => r.severity === 'disruption')
      ? 'disruption'
      : 'info'

  return (
    <div className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{faultLabel(group.service, group.faultType)}</p>
          <p className="text-xs text-muted">
            {group.reports[0].locAddress || 'Pinned location'}
          </p>
        </div>
        {group.count > 1 && (
          <span className="shrink-0 rounded-full bg-wcc-black px-2.5 py-0.5 text-xs font-semibold text-wcc-white">
            ×{group.count}
          </span>
        )}
      </div>

      {group.count > 1 && (
        <p className="mt-1 text-xs italic text-muted">
          {group.count} reports within {group.radiusM}m — grouped automatically, not confirmed as the
          same incident.
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {group.reports.map((r) => (
          <li key={r.reference}>
            <button
              type="button"
              onClick={() => onSelect(r.reference)}
              aria-pressed={selected === r.reference}
              className={`min-h-tap w-full rounded border px-2 py-1.5 text-left text-sm transition-colors duration-fast ease-standard ${
                selected === r.reference
                  ? 'border-wcc-black bg-brand-100'
                  : 'border-transparent hover:bg-grey-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: statusById(r.status).dot }}
                />
                <span className="ref text-xs">{r.reference}</span>
                <span className="ml-auto text-xs text-muted">
                  {relativeWhen(r.submittedAt)}
                </span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                <Tag tone={worst === 'urgent' && r.severity === 'urgent' ? 'urgent' : r.severity}>
                  {SEVERITY_LABEL[r.severity]}
                </Tag>
                {r.reporterKind === 'hub' && <Tag tone="hub">Hub</Tag>}
                {r.attachmentUploadKeys.length > 0 && <Tag>{r.attachmentUploadKeys.length} photo</Tag>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Status is a pill with a word in it, never a coloured dot on its own.
function Tag({ children, tone }: { children: ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    urgent: 'bg-error-bg text-error-fg',
    disruption: 'bg-warning-bg text-warning-fg',
    info: 'bg-grey-100 text-grey-700',
    hub: 'bg-wcc-yellow text-wcc-black',
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-[0.04em] ${
        (tone && tones[tone]) || tones.info
      }`}
    >
      {children}
    </span>
  )
}

// Council layers, served live from gis.wcc.govt.nz and mapping.gw.govt.nz. The
// panel says where each one comes from, because a boundary drawn on a map gets
// treated as authoritative and the operator should be able to see whose it is.
const LAYER_OPTIONS: {
  id: keyof BoundaryLayerToggles
  label: string
  source: string
  note: string | null
}[] = [
  {
    id: 'suburbs',
    label: 'Suburb boundaries',
    source: 'WCC · 57 suburbs',
    note: 'Shaded by how many of the reports below fall inside each suburb.',
  },
  {
    id: 'parcels',
    label: 'Property boundaries',
    source: 'WCC · 84,223 parcels',
    note: 'Loaded for the current view only. Zoom in to see them.',
  },
  {
    id: 'hubs',
    label: 'Community Emergency Hubs',
    source: 'WREMO · 126 hubs',
    note: null,
  },
]

interface LayerControlProps {
  layers: BoundaryLayerToggles
  setLayers: Dispatch<SetStateAction<BoundaryLayerToggles>>
  parcelStatus: ParcelStatusValue
  suburbsLoaded: number
}

function LayerControl({ layers, setLayers, parcelStatus, suburbsLoaded }: LayerControlProps) {
  const [open, setOpen] = useState(true)

  return (
    <div className="map-plate absolute right-3 top-3 w-64 rounded border border-grey-200 text-xs shadow-raised">
      <button
        type="button"
        className="flex min-h-tap w-full items-center justify-between px-3 py-2 font-semibold"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Map layers
        <span aria-hidden="true" className="text-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-grey-200 p-3">
          {LAYER_OPTIONS.map((option) => (
            <div key={option.id}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={layers[option.id]}
                  onChange={(e) =>
                    setLayers((l) => ({ ...l, [option.id]: e.target.checked }))
                  }
                />
                <span>
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block text-muted">{option.source}</span>
                </span>
              </label>
              {layers[option.id] && option.note && (
                <p className="ml-6 mt-0.5 text-muted">{option.note}</p>
              )}
              {option.id === 'parcels' && layers.parcels && (
                <ParcelStatus status={parcelStatus} />
              )}
              {option.id === 'suburbs' && layers.suburbs && suburbsLoaded === 0 && (
                <p className="ml-6 mt-0.5 text-muted">Loading boundaries…</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The parcel layer can silently return a partial answer: the service caps a
// query at 2,000 rows and says so only in a flag most clients ignore. If that
// happens the operator is looking at a map with properties missing, so it says
// so rather than looking complete.
function ParcelStatus({ status }: { status: ParcelStatusValue }) {
  if (status.state === 'loading') {
    return <p className="ml-6 mt-0.5 text-muted">Loading for this view…</p>
  }
  if (status.state === 'error') {
    return <p className="ml-6 mt-0.5 font-semibold text-error-fg">Could not load: {status.error}</p>
  }
  if (status.state === 'loaded') {
    return (
      <p className={`ml-6 mt-0.5 ${status.truncated ? 'font-semibold text-error-fg' : 'text-muted'}`}>
        {status.truncated
          ? `Showing 2,000 of more than 2,000 — some boundaries are missing. Zoom in.`
          : `${status.count.toLocaleString('en-NZ')} in view`}
      </p>
    )
  }
  return null
}

function MapLegend({ showSuburbShading }: { showSuburbShading: boolean }) {
  return (
    <div className="map-plate absolute bottom-3 left-3 rounded border border-grey-200 p-3 text-xs shadow-raised">
      <p className="font-semibold">Reported severity</p>
      <ul className="mt-1 space-y-0.5">
        <LegendDot colour={SEVERITY_COLOUR.urgent}>Urgent</LegendDot>
        <LegendDot colour={SEVERITY_COLOUR.disruption}>Causing disruption</LegendDot>
        <LegendDot colour={SEVERITY_COLOUR.info}>Information</LegendDot>
      </ul>
      <p className="mt-2 max-w-[13rem] italic text-muted">
        Severity is what the reporter said, not a Council assessment.
      </p>

      {showSuburbShading && (
        <>
          <p className="mt-2.5 font-semibold">Reports per suburb</p>
          <ul className="mt-1 space-y-0.5">
            <LegendSwatch colour={shadeFor(1)}>1–2</LegendSwatch>
            <LegendSwatch colour={shadeFor(3)}>3–5</LegendSwatch>
            <LegendSwatch colour={shadeFor(6)}>6 or more</LegendSwatch>
          </ul>
          <p className="mt-1 max-w-[13rem] italic text-muted">
            Counts follow the filters, so they are reports shown, not reports received.
          </p>
        </>
      )}
    </div>
  )
}

function LegendDot({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
      {children}
    </li>
  )
}

function LegendSwatch({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-3 w-4 rounded-sm border border-grey-400"
        style={{ background: colour }}
      />
      {children}
    </li>
  )
}

interface DetailProps {
  report: Report | null
  group: ReportGroup | null | undefined
  suburb: string | null
  onStatus: (reference: string, status: StatusId, note: string) => void
}

function Detail({ report, group, suburb, onStatus }: DetailProps) {
  const [note, setNote] = useState('')

  useEffect(() => setNote(''), [report?.reference])

  if (!report) {
    return (
      <div className="card flex h-[38rem] items-center justify-center p-6 text-center hint lg:h-[46rem]">
        Pick a report from the queue or the map.
      </div>
    )
  }

  const status = statusById(report.status)

  return (
    <div className="card flex h-[38rem] flex-col overflow-y-auto p-4 lg:h-[46rem]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="ref text-xs text-muted">{report.reference}</p>
          <h2 className="mt-1 text-xl font-semibold">
            {faultLabel(report.service, report.faultType)}
          </h2>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.04em] ${status.tone}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm">{report.faultDesc}</p>

      {report.attachmentPreviews?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {report.attachmentPreviews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`Photo ${i + 1} from the reporter`}
              className="h-24 w-24 rounded border border-grey-200 object-cover"
            />
          ))}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Row label="Where">{report.locAddress || '—'}</Row>
        <Row label="Suburb">
          {suburb ? (
            <>
              {suburb} <span className="text-muted">— from the pin, not the reporter</span>
            </>
          ) : (
            'Outside the Wellington City boundary'
          )}
        </Row>
        <Row label="Coordinates">
          <span className="ref text-xs">
            {report.locLatitude.toFixed(5)}, {report.locLongitude.toFixed(5)}
          </span>
        </Row>
        <Row label="Observed">{formatWhen(report.observedAt)}</Row>
        <Row label="Submitted">
          {formatWhen(report.submittedAt)} ({relativeWhen(report.submittedAt)})
        </Row>
        <Row label="Severity">{SEVERITY_LABEL[report.severity]} — reporter&apos;s own words</Row>
        <Row label="Reported by">
          {report.hubName || (report.reporterKind === 'resident' ? 'A resident' : 'A community group')}
        </Row>
        <Row label="Contact">
          {report.contactEmail || report.contactPhone ? (
            <>
              {[report.contactFirstName, report.contactLastName].filter(Boolean).join(' ')}
              <br />
              {report.contactEmail || report.contactPhone}
            </>
          ) : (
            'Not left — cannot follow up'
          )}
        </Row>
      </dl>

      {group && group.count > 1 && (
        <p className="mt-3 rounded border border-grey-200 bg-grey-50 p-2.5 text-xs">
          Grouped with {group.count - 1} other report{group.count > 2 ? 's' : ''} of the same fault
          type within {group.radiusM}m. This is a proximity heuristic — check them before treating
          it as one incident.
        </p>
      )}

      <div className="mt-4 border-t border-grey-200 pt-4">
        <h3 className="text-base font-semibold">Tell the reporter what is happening</h3>
        <textarea
          rows={2}
          className="field mt-2 text-sm"
          placeholder="Optional note — the reporter sees this."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUSES.filter((s) => s.id !== report.status).map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onStatus(report.reference, s.id, note)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          The reporter sees this within seconds on their tracking page. That is the whole point.
        </p>
      </div>

      <div className="mt-4 border-t border-grey-200 pt-4">
        <h3 className="text-base font-semibold">History</h3>
        <ol className="mt-2 space-y-2 text-xs">
          {report.timeline.map((entry, i) => (
            <li key={i} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ background: statusById(entry.status).dot }}
              />
              <div>
                <p className="font-semibold">{statusById(entry.status).label}</p>
                {entry.note && <p className="text-grey-600">{entry.note}</p>}
                <p className="text-muted">
                  {formatWhen(entry.at)} · {entry.by}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
