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

// Bilingual titles are a design system non-negotiable. These four pairings come
// from the Fixit UI kit in the bundle — its README flags that the live Fixit
// service could not be read, so they are the kit author's informed inventions,
// not verified Council copy. Only "Whākina he raruraru / Report a problem" was
// read from wellington.govt.nz. Get the real pairings from the Council before
// this goes anywhere near production.
const TE_REO: Record<number, string> = {
  0: 'He aha te raruraru?',
  1: 'Kei hea?',
  2: 'Ngā taipitopito',
  3: 'Ō pārongo',
}

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
      if (!form.service) next.service = 'Select a service'
      if (!form.faultType) next.faultType = 'Select what you are reporting'
    }
    if (index === 1 && !form.location) {
      next.location = 'Drop a pin so we know where this is'
    }
    if (index === 2) {
      if (!form.faultDesc.trim()) next.faultDesc = 'Tell us what you can see'
      if (isEmergencyService(form.service) && !form.severity) {
        next.severity = 'Tell us how bad it is'
      }
      if (form.reporterKind === 'hub' && !form.hubName.trim()) {
        next.hubName = 'Tell us which hub'
      }
    }
    if (index === 3 && !form.anonymous) {
      if (!form.contactFirstName.trim()) next.contactFirstName = 'Enter your first name'
      if (!form.contactEmail.trim() && !form.contactPhone.trim()) {
        next.contactEmail = 'Enter an email address or a phone number'
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
            ? 'Some details need fixing. Go back and check them.'
            : 'A server error occurred during submission.',
        )
        return
      }
      setReceipt(data.report)
      setStep(4)
    } catch {
      setSubmitError('We could not reach the server. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 4 && receipt) return <Receipt report={receipt} onAnother={() => { setForm(EMPTY); setReceipt(null); setStep(0) }} />

  return (
    <div>
      <StepIndicator step={step} />

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
          <Callout tone="error" className="mt-6">
            <p className="font-semibold text-error-fg">{submitError}</p>
            <p className="mt-1 text-sm">You can call us on {CONTACT_CENTRE}.</p>
          </Callout>
        )}

        <div className="mt-8 flex items-center gap-3 border-t border-grey-200 pt-5">
          {step > 0 && (
            <button type="button" className="btn btn-secondary" onClick={back}>
              Back
            </button>
          )}
          {step < 3 && (
            <button type="button" className="btn btn-primary ml-auto" onClick={next}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn btn-primary ml-auto" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// The design system's step progress: a 4px rule per step. Black behind, yellow
// on the current one, grey ahead. No numbered pills.
function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 flex-col gap-2">
          <span
            aria-hidden="true"
            className={`block h-rule rounded-full ${
              i < step ? 'bg-wcc-black' : i === step ? 'bg-wcc-yellow' : 'bg-grey-200'
            }`}
          />
          <span
            className={`text-sm ${i === step ? 'font-semibold text-wcc-black' : 'text-muted'}`}
            aria-current={i === step ? 'step' : undefined}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

// A tinted surface with a 4px rule on its top edge. Yellow is a signal here,
// never a background behind body copy.
function Callout({
  tone,
  className = '',
  children,
}: {
  tone: 'error' | 'warning' | 'info' | 'brand'
  className?: string
  children: React.ReactNode
}) {
  const tones = {
    error: 'border-error-fg bg-error-bg',
    warning: 'border-warning-fg bg-warning-bg',
    info: 'border-info-fg bg-info-bg',
    brand: 'border-wcc-yellow bg-brand-100',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`border-t-rule px-5 py-4 ${tones[tone]} ${className}`}
    >
      {children}
    </div>
  )
}

function StepHeading({ step, title, hint }: { step: number; title: string; hint: string }) {
  return (
    <div>
      {TE_REO[step] && <p className="te-reo">{TE_REO[step]}</p>}
      <h1 className="mt-1 text-2xl font-bold tracking-[-0.015em]">{title}</h1>
      <span aria-hidden="true" className="rule-yellow mt-3" />
      <p className="mt-3 max-w-measure hint">{hint}</p>
    </div>
  )
}

function StepWhat({ form, set, errors }: StepProps) {
  const service = serviceById(form.service)

  return (
    <div>
      <StepHeading
        step={0}
        title="What are you reporting?"
        hint="Pick the closest match. We can sort it out at our end if it is not exact."
      />

      <div className="mt-6 space-y-2">
        {SERVICES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => set({ service: s.id, faultType: '' })}
            aria-pressed={form.service === s.id}
            className={`min-h-tap w-full rounded border p-4 text-left transition-colors duration-fast ease-standard ${
              form.service === s.id
                ? 'border-thick border-wcc-black bg-brand-100'
                : 'border-grey-300 bg-wcc-white hover:bg-grey-50'
            }`}
          >
            <span className="flex flex-wrap items-center gap-2 font-semibold">
              {s.label}
              {s.emergency && (
                <span className="rounded-full bg-wcc-yellow px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] text-wcc-black">
                  During an event
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm text-grey-600">{s.blurb}</span>
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
            aria-invalid={errors.faultType ? 'true' : undefined}
            value={form.faultType}
            onChange={(e) => set({ faultType: e.target.value })}
          >
            <option value="">Select…</option>
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
// accepting a life-safety report. Urgency is stated, not implied, and it comes
// with a phone number.
function EscalationNotice({ faultType }: { faultType: string }) {
  if (CALL_111.has(faultType)) {
    return (
      <Callout tone="error" className="mt-4">
        <p className="font-semibold text-error-fg">If anyone is in danger, call 111 now.</p>
        <p className="mt-1 max-w-measure text-sm">
          You can still leave a report here so the Council has the picture, but a report is not a
          call for help and no one is watching this form second by second.
        </p>
      </Callout>
    )
  }
  if (CALL_CONTACT_CENTRE.has(faultType)) {
    return (
      <Callout tone="warning" className="mt-4">
        <p className="font-semibold text-warning-fg">
          If this affects a large group of people, call the Contact Centre on {CONTACT_CENTRE}.
        </p>
        <p className="mt-1 max-w-measure text-sm">
          Outages and water faults are usually handled by the lines or water company, and a phone
          call reaches them faster.
        </p>
      </Callout>
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
      <StepHeading
        step={1}
        title="Where is it?"
        hint="A pin is worth more than an address to the people reading this — it puts your report on the same map as everything else."
      />

      <div className="mt-6">
        <MapPicker
          value={form.location}
          onChange={(loc) => set({ location: loc })}
          onNearestHub={setNearestHub}
          onSuburb={setSuburb}
        />
        {errors.location && <p className="error">{errors.location}</p>}
      </div>

      <div className="mt-field">
        <label className="label" htmlFor="locAddress">
          Nearest address or landmark <span className="font-normal text-muted">(optional)</span>
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
      <StepHeading
        step={2}
        title="Tell us what you can see"
        hint="Include as many relevant details as you can."
      />

      <div className="mt-6">
        <label className="label" htmlFor="faultDesc">
          Description
        </label>
        <textarea
          id="faultDesc"
          rows={5}
          className="field"
          aria-invalid={errors.faultDesc ? 'true' : undefined}
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
                className={`flex min-h-tap cursor-pointer gap-3 rounded border p-3 transition-colors duration-fast ease-standard ${
                  form.severity === s.id
                    ? 'border-wcc-black bg-brand-100'
                    : 'border-grey-300 bg-wcc-white'
                }`}
              >
                <input
                  type="radio"
                  name="severity"
                  className="mt-0.5"
                  checked={form.severity === s.id}
                  onChange={() => set({ severity: s.id })}
                />
                <span>
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block text-sm text-muted">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.severity && <p className="error">{errors.severity}</p>}
        </fieldset>
      )}

      <div className="mt-6 grid gap-field sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="observedAt">
            When did you see this? <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="observedAt"
            type="datetime-local"
            className="field"
            value={form.observedAt}
            onChange={(e) => set({ observedAt: e.target.value })}
          />
          <p className="mt-2 hint">Leave blank if it is happening now.</p>
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
        <div className="mt-field">
          <label className="label" htmlFor="hubName">
            Which hub?
          </label>
          <input
            id="hubName"
            className="field"
            aria-invalid={errors.hubName ? 'true' : undefined}
            placeholder="e.g. Hataitai Community Emergency Hub"
            value={form.hubName}
            onChange={(e) => set({ hubName: e.target.value })}
          />
          {errors.hubName && <p className="error">{errors.hubName}</p>}
          <p className="mt-2 hint">
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
      <StepHeading
        step={3}
        title="How can we get back to you?"
        hint="We use this to tell you what happened to your report, and to ask a question if we need to."
      />

      <label
        className={`mt-6 flex min-h-tap cursor-pointer items-start gap-3 rounded border p-4 transition-colors duration-fast ease-standard ${
          form.anonymous ? 'border-wcc-black bg-brand-100' : 'border-grey-300 bg-wcc-white'
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.anonymous}
          onChange={(e) => set({ anonymous: e.target.checked })}
        />
        <span>
          <span className="block font-semibold">Report without leaving my details</span>
          <span className="block text-sm text-muted">
            You still get a reference number, and you can still track the report with it. We just
            cannot contact you.
          </span>
        </span>
      </label>

      {!form.anonymous && (
        <div className="mt-6 grid gap-field sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contactFirstName">First name</label>
            <input
              id="contactFirstName"
              className="field"
              aria-invalid={errors.contactFirstName ? 'true' : undefined}
              value={form.contactFirstName}
              onChange={(e) => set({ contactFirstName: e.target.value })}
            />
            {errors.contactFirstName && <p className="error">{errors.contactFirstName}</p>}
          </div>
          <div>
            <label className="label" htmlFor="contactLastName">
              Last name <span className="font-normal text-muted">(optional)</span>
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
              aria-invalid={errors.contactEmail ? 'true' : undefined}
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
    <div className="mt-8 rounded border border-grey-200 bg-grey-50 p-4 text-sm">
      <h2 className="font-semibold">What you are sending</h2>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">Issue</dt>
        <dd>{faultLabel(form.service, form.faultType)}</dd>
        <dt className="font-semibold">Location</dt>
        <dd>
          {form.locAddress || 'Pin only'}
          {form.location && (
            <span className="ref">
              {' '}
              ({form.location.lat.toFixed(5)}, {form.location.lng.toFixed(5)})
            </span>
          )}
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
    <div className="card card-accent p-6">
      <h1 className="text-2xl font-bold tracking-[-0.015em]">Thank you — we have your report</h1>
      <p className="mt-3">Your reference number is</p>
      <p className="ref mt-1 text-3xl">{report.reference}</p>
      <p className="mt-3 max-w-measure text-sm">
        Write this down. You can check what is happening with your report at any time, and you can
        read it out over the phone or a radio.
      </p>

      <div className="mt-6 border-t border-grey-200 pt-5">
        <h2 className="text-xl font-semibold">What happens next</h2>
        <ol className="mt-3 max-w-measure space-y-2">
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
        <p className="mt-3 max-w-measure hint">
          Every step is timestamped and you can see all of it. If nothing happens, you will be able
          to see that too.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/track?ref=${report.reference}`} className="btn btn-primary">
          Track this report
        </Link>
        <button type="button" className="btn btn-secondary" onClick={onAnother}>
          Report another problem
        </button>
      </div>
    </div>
  )
}
