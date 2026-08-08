'use client'

import { useState } from 'react'
import Link from 'next/link'
import MapPicker from './MapPicker'
import PhotoUpload from './PhotoUpload'
import {
  CALL_111,
  CALL_CONTACT_CENTRE,
  CONTACT_CENTRE,
  SERVICES,
  faultLabel,
  isEmergencyService,
  serviceById,
} from '../lib/taxonomy'
import { REPORTER_KINDS, SEVERITIES } from '../lib/schema'
import type { StagedPhoto } from './PhotoUpload'
import type {
  HubProperties,
  LatLng,
  Report,
  ReporterKindId,
  SeverityId,
} from '../lib/types'

interface FormState {
  service: string
  faultType: string
  faultDesc: string
  location: LatLng | null
  locAddress: string
  observedAt: string
  severity: SeverityId
  reporterKind: ReporterKindId
  hubName: string
  photos: StagedPhoto[]
  contactFirstName: string
  contactLastName: string
  contactEmail: string
  contactPhone: string
  anonymous: boolean
}

type FormErrors = Partial<Record<keyof FormState, string>>

/** Merge a partial update into the form. */
type SetForm = (patch: Partial<FormState>) => void

interface StepProps {
  form: FormState
  set: SetForm
  errors: FormErrors
}

const STEPS = ['What', 'Where', 'Details', 'You', 'Done']

const EMPTY: FormState = {
  service: '',
  faultType: '',
  faultDesc: '',
  location: null,
  locAddress: '',
  observedAt: '',
  severity: 'info',
  reporterKind: 'resident',
  hubName: '',
  photos: [],
  contactFirstName: '',
  contactLastName: '',
  contactEmail: '',
  contactPhone: '',
  anonymous: false,
}

export default function Wizard() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Report | null>(null)
  const [nearestHub, setNearestHub] = useState<HubProperties | null>(null)
  const [suburb, setSuburb] = useState<string | null>(null)

  const set: SetForm = (patch) => setForm((f) => ({ ...f, ...patch }))

  function validateStep(index: number): boolean {
    const next: FormErrors = {}
    if (index === 0) {
      if (!form.service) next.service = 'Please select a service'
      if (!form.faultType) next.faultType = 'Please select what you are reporting'
    }
    if (index === 1 && !form.location) {
      next.location = 'Please drop a pin so we know where this is'
    }
    if (index === 2) {
      if (!form.faultDesc.trim()) next.faultDesc = 'Please tell us what you can see'
      if (isEmergencyService(form.service) && !form.severity) {
        next.severity = 'Please tell us how bad it is'
      }
      if (form.reporterKind === 'hub' && !form.hubName.trim()) {
        next.hubName = 'Please tell us which hub'
      }
    }
    if (index === 3 && !form.anonymous) {
      if (!form.contactFirstName.trim()) next.contactFirstName = 'Please provide your first name'
      if (!form.contactEmail.trim() && !form.contactPhone.trim()) {
        next.contactEmail = 'Please give us an email address or a phone number'
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function next() {
    if (!validateStep(step)) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function back() {
    setErrors({})
    setStep((s) => Math.max(s - 1, 0))
  }

  async function submit() {
    if (!validateStep(3)) return
    setSubmitting(true)
    setSubmitError(null)

    const payload = {
      service: form.service,
      faultType: form.faultType,
      faultDesc: form.faultDesc,
      locAddress: form.locAddress || null,
      locSuburb: suburb,
      locLatitude: form.location!.lat,
      locLongitude: form.location!.lng,
      observedAt: form.observedAt ? new Date(form.observedAt).toISOString() : new Date().toISOString(),
      severity: form.severity,
      reporterKind: form.reporterKind,
      hubName: form.reporterKind === 'hub' ? form.hubName : null,
      attachmentUploadKeys: form.photos.map((p) => p.key),
      attachmentPreviews: form.photos.map((p) => p.dataUrl),
      contactFirstName: form.anonymous ? null : form.contactFirstName,
      contactLastName: form.anonymous ? null : form.contactLastName,
      contactEmail: form.anonymous ? null : form.contactEmail,
      contactPhone: form.anonymous ? null : form.contactPhone,
    }

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(
          data.errors
            ? 'Some details need fixing. Please go back and check them.'
            : 'A server error occurred during submission.',
        )
        return
      }
      setReceipt(data.report)
      setStep(4)
    } catch {
      setSubmitError('We could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 4 && receipt) return <Receipt report={receipt} onAnother={() => { setForm(EMPTY); setReceipt(null); setStep(0) }} />

  return (
    <div>
      <Progress step={step} />

      <div className="card mt-6 p-6">
        {step === 0 && <StepWhat form={form} set={set} errors={errors} />}
        {step === 1 && (
          <StepWhere
            form={form}
            set={set}
            errors={errors}
            nearestHub={nearestHub}
            setNearestHub={setNearestHub}
            suburb={suburb}
            setSuburb={setSuburb}
          />
        )}
        {step === 2 && <StepDetails form={form} set={set} errors={errors} />}
        {step === 3 && <StepYou form={form} set={set} errors={errors} />}

        {submitError && (
          <div className="mt-5 rounded border border-urgent bg-red-50 p-4 text-sm font-medium text-urgent">
            {submitError} You can call us on {CONTACT_CENTRE}.
          </div>
        )}

        <div className="mt-8 flex items-center gap-3 border-t border-council-line pt-5">
          {step > 0 && (
            <button type="button" className="btn-secondary" onClick={back}>
              Back
            </button>
          )}
          {step < 3 && (
            <button type="button" className="btn-primary ml-auto" onClick={next}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn-primary ml-auto" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`rounded-full border px-3 py-1 font-semibold ${
            i === step
              ? 'border-council-accent bg-council-accent text-white'
              : i < step
                ? 'border-council-accent/40 bg-white text-council-accent'
                : 'border-council-line bg-white text-council-ink/40'
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  )
}

function StepWhat({ form, set, errors }: StepProps) {
  const service = serviceById(form.service)

  return (
    <div>
      <h1 className="text-2xl font-bold">What are you reporting?</h1>
      <p className="mt-2 hint">Pick the closest match. We can sort it out at our end if it is not exact.</p>

      <div className="mt-6 space-y-2">
        {SERVICES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => set({ service: s.id, faultType: '' })}
            className={`w-full rounded border p-4 text-left transition ${
              form.service === s.id
                ? 'border-council-accent bg-council-accent/5 ring-1 ring-council-accent/30'
                : 'border-council-line bg-white hover:bg-council-sand'
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              {s.label}
              {s.emergency && (
                <span className="rounded bg-urgent px-2 py-0.5 text-xs font-bold text-white">
                  During an event
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm text-council-ink/60">{s.blurb}</span>
          </button>
        ))}
      </div>
      {errors.service && <p className="error">{errors.service}</p>}

      {service && (
        <div className="mt-6">
          <label className="label" htmlFor="faultType">
            What kind of {service.label.toLowerCase()} issue?
          </label>
          <select
            id="faultType"
            className="field"
            value={form.faultType}
            onChange={(e) => set({ faultType: e.target.value })}
          >
            <option value="">Please select…</option>
            {service.faults.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {errors.faultType && <p className="error">{errors.faultType}</p>}
          <EscalationNotice faultType={form.faultType} />
        </div>
      )}
    </div>
  )
}

// The existing Council tool does this and it is the right call: some things
// should not go into a queue. We keep the interruption rather than quietly
// accepting a life-safety report.
function EscalationNotice({ faultType }: { faultType: string }) {
  if (CALL_111.has(faultType)) {
    return (
      <div className="mt-4 rounded border-2 border-urgent bg-red-50 p-4">
        <p className="font-bold text-urgent">If anyone is in danger, call 111 now.</p>
        <p className="mt-1 text-sm text-council-ink/80">
          You can still leave a report here so the Council has the picture, but a report is not a
          call for help and no one is watching this form second by second.
        </p>
      </div>
    )
  }
  if (CALL_CONTACT_CENTRE.has(faultType)) {
    return (
      <div className="mt-4 rounded border border-amber-400 bg-amber-50 p-4">
        <p className="font-semibold text-amber-900">
          If this affects a large group of people, call the Contact Centre on {CONTACT_CENTRE}.
        </p>
        <p className="mt-1 text-sm text-council-ink/80">
          Outages and water faults are usually handled by the lines or water company, and a phone
          call reaches them faster.
        </p>
      </div>
    )
  }
  return null
}

interface StepWhereProps extends StepProps {
  nearestHub: HubProperties | null
  setNearestHub: (hub: HubProperties) => void
  suburb: string | null
  setSuburb: (suburb: string | null) => void
}

function StepWhere({
  form,
  set,
  errors,
  nearestHub,
  setNearestHub,
  suburb,
  setSuburb,
}: StepWhereProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Where is it?</h1>
      <p className="mt-2 hint">
        A pin is worth more than an address to the people reading this — it puts your report on the
        same map as everything else.
      </p>

      <div className="mt-5">
        <MapPicker
          value={form.location}
          onChange={(loc) => set({ location: loc })}
          onNearestHub={setNearestHub}
          onSuburb={setSuburb}
        />
        {errors.location && <p className="error">{errors.location}</p>}
      </div>

      <div className="mt-5">
        <label className="label" htmlFor="locAddress">
          Nearest address or landmark <span className="font-normal text-council-ink/50">(optional)</span>
        </label>
        <input
          id="locAddress"
          className="field"
          placeholder="e.g. Evans Bay Parade, outside the marina"
          value={form.locAddress}
          onChange={(e) => set({ locAddress: e.target.value })}
        />
      </div>

      {form.location && (
        <div className="mt-3 space-y-1">
          <p className="hint">
            Suburb:{' '}
            {suburb ? (
              <strong>{suburb}</strong>
            ) : (
              <span>outside the Wellington City boundary</span>
            )}{' '}
            — worked out from your pin against the Council&apos;s own boundaries, so you do not have
            to type it.
          </p>
          {nearestHub?.NAME && (
            <p className="hint">
              Nearest Community Emergency Hub: <strong>{nearestHub.NAME}</strong>
              {nearestHub.SUBURB ? `, ${nearestHub.SUBURB}` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function StepDetails({ form, set, errors }: StepProps) {
  const emergency = isEmergencyService(form.service)

  return (
    <div>
      <h1 className="text-2xl font-bold">Tell us what you can see</h1>
      <p className="mt-2 hint">Please include as many relevant details as you can.</p>

      <div className="mt-5">
        <label className="label" htmlFor="faultDesc">
          Description
        </label>
        <textarea
          id="faultDesc"
          rows={5}
          className="field"
          placeholder="What is happening, how bad it is, whether it is getting worse."
          value={form.faultDesc}
          onChange={(e) => set({ faultDesc: e.target.value })}
        />
        {errors.faultDesc && <p className="error">{errors.faultDesc}</p>}
      </div>

      {emergency && (
        <fieldset className="mt-6">
          <legend className="label">How bad is it right now?</legend>
          <div className="space-y-2">
            {SEVERITIES.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer gap-3 rounded border p-3 ${
                  form.severity === s.id
                    ? 'border-council-accent bg-council-accent/5'
                    : 'border-council-line bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="severity"
                  className="mt-1"
                  checked={form.severity === s.id}
                  onChange={() => set({ severity: s.id })}
                />
                <span>
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block text-sm text-council-ink/60">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.severity && <p className="error">{errors.severity}</p>}
        </fieldset>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="observedAt">
            When did you see this? <span className="font-normal text-council-ink/50">(optional)</span>
          </label>
          <input
            id="observedAt"
            type="datetime-local"
            className="field"
            value={form.observedAt}
            onChange={(e) => set({ observedAt: e.target.value })}
          />
          <p className="mt-1 hint">Leave blank if it is happening now.</p>
        </div>

        <div>
          <label className="label" htmlFor="reporterKind">
            Who is reporting?
          </label>
          <select
            id="reporterKind"
            className="field"
            value={form.reporterKind}
            onChange={(e) => set({ reporterKind: e.target.value as ReporterKindId })}
          >
            {REPORTER_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.reporterKind === 'hub' && (
        <div className="mt-5">
          <label className="label" htmlFor="hubName">
            Which hub?
          </label>
          <input
            id="hubName"
            className="field"
            placeholder="e.g. Hataitai Community Emergency Hub"
            value={form.hubName}
            onChange={(e) => set({ hubName: e.target.value })}
          />
          {errors.hubName && <p className="error">{errors.hubName}</p>}
          <p className="mt-1 hint">
            Reports from a staffed hub are flagged in the Council console, because someone has
            physically been there.
          </p>
        </div>
      )}

      <div className="mt-6">
        <PhotoUpload photos={form.photos} onChange={(photos) => set({ photos })} />
      </div>
    </div>
  )
}

function StepYou({ form, set, errors }: StepProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold">How can we get back to you?</h1>
      <p className="mt-2 hint">
        We use this to tell you what happened to your report, and to ask a question if we need to.
      </p>

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded border border-council-line bg-white p-4">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.anonymous}
          onChange={(e) => set({ anonymous: e.target.checked })}
        />
        <span>
          <span className="block font-semibold">Report without leaving my details</span>
          <span className="block text-sm text-council-ink/60">
            You still get a reference number, and you can still track the report with it. We just
            cannot contact you.
          </span>
        </span>
      </label>

      {!form.anonymous && (
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contactFirstName">First name</label>
            <input
              id="contactFirstName"
              className="field"
              value={form.contactFirstName}
              onChange={(e) => set({ contactFirstName: e.target.value })}
            />
            {errors.contactFirstName && <p className="error">{errors.contactFirstName}</p>}
          </div>
          <div>
            <label className="label" htmlFor="contactLastName">
              Last name <span className="font-normal text-council-ink/50">(optional)</span>
            </label>
            <input
              id="contactLastName"
              className="field"
              value={form.contactLastName}
              onChange={(e) => set({ contactLastName: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="contactEmail">Email address</label>
            <input
              id="contactEmail"
              type="email"
              className="field"
              value={form.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
            />
            {errors.contactEmail && <p className="error">{errors.contactEmail}</p>}
          </div>
          <div>
            <label className="label" htmlFor="contactPhone">Phone number</label>
            <input
              id="contactPhone"
              className="field"
              placeholder="Including area code"
              value={form.contactPhone}
              onChange={(e) => set({ contactPhone: e.target.value })}
            />
          </div>
        </div>
      )}

      <Summary form={form} />
    </div>
  )
}

function Summary({ form }: { form: FormState }) {
  return (
    <div className="mt-8 rounded border border-council-line bg-council-sand p-4 text-sm">
      <h2 className="font-bold">What you are sending</h2>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">Issue</dt>
        <dd>{faultLabel(form.service, form.faultType)}</dd>
        <dt className="font-semibold">Location</dt>
        <dd>
          {form.locAddress || 'Pin only'}
          {form.location && ` (${form.location.lat.toFixed(5)}, ${form.location.lng.toFixed(5)})`}
        </dd>
        <dt className="font-semibold">Description</dt>
        <dd className="whitespace-pre-wrap">{form.faultDesc || '—'}</dd>
        <dt className="font-semibold">Photos</dt>
        <dd>{form.photos.length}</dd>
      </dl>
    </div>
  )
}

function Receipt({ report, onAnother }: { report: Report; onAnother: () => void }) {
  return (
    <div className="card p-6">
      <div className="rounded border-2 border-council-accent bg-council-accent/5 p-5">
        <h1 className="text-2xl font-bold">Thank you — we have your report</h1>
        <p className="mt-2">Your reference number is</p>
        <p className="mt-1 text-3xl font-bold tracking-wider text-council-accent">
          {report.reference}
        </p>
        <p className="mt-3 text-sm text-council-ink/80">
          Write this down. You can check what is happening with your report at any time, and you can
          read it out over the phone or a radio.
        </p>
      </div>

      <div className="mt-6">
        <h2 className="font-bold">What happens next</h2>
        <ol className="mt-2 space-y-2 text-council-ink/80">
          <li>
            <strong>1. Received</strong> — done. Your report is in the queue and visible to the
            Council duty officer right now.
          </li>
          <li>
            <strong>2. Being checked</strong> — someone reads it, and looks at whether other people
            have reported the same thing.
          </li>
          <li>
            <strong>3. Being acted on</strong> — it is passed to whoever can deal with it.
          </li>
        </ol>
        <p className="mt-3 hint">
          Every step is timestamped and you can see all of it. If nothing happens, you will be able
          to see that too.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/track?ref=${report.reference}`} className="btn-primary">
          Track this report
        </Link>
        <button type="button" className="btn-secondary" onClick={onAnother}>
          Report another problem
        </button>
      </div>
    </div>
  )
}
