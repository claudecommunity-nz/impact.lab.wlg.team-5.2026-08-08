'use client'

import { useState } from 'react'
import { REPORTER_KINDS } from '../lib/schema'
import { formatWhen, relativeWhen } from '../lib/time'
import type { FixClaim, ReporterKindId } from '../lib/types'

// "I fixed it".
//
// A neighbour clears the drain, a hub team moves the branch, a contractor
// finishes before anyone at the Council has looked. Today that never gets back
// to the Council at all, so the report sits open and the map keeps showing a
// problem that is not there any more. This is the return leg of the two-way
// channel: the community closing the loop, not only opening it.
//
// What the copy has to carry, and the reason it is this wordy: tapping this
// does not resolve the report. It cannot. An unverified claim that a hazard is
// gone is the most dangerous single thing this prototype could treat as fact —
// it is the one that takes a warning off a map. So the button files a claim, a
// duty officer sees it as a claim, and only a first responder's confirmation
// moves the status.

export default function FixedIt({
  reference,
  claim,
  onClaimed,
  source = 'local',
}: {
  reference: string
  claim: FixClaim | null
  onClaimed: (claim: FixClaim) => void
  /** 'feed' when the report belongs to the shared feed, not to this prototype. */
  source?: 'local' | 'feed'
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [by, setBy] = useState<ReporterKindId>('resident')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reference)}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null, by }),
      })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const data = await res.json()
      setOpen(false)
      setNote('')
      onClaimed(data.claim)
    } catch (err) {
      setError(
        err instanceof Error
          ? `We could not send that — ${err.message}. Please try again.`
          : 'We could not send that. Please try again.',
      )
    } finally {
      setSending(false)
    }
  }

  if (claim && !open) return <Claimed claim={claim} onAdd={() => setOpen(true)} />

  return (
    <div className="mt-6 border-t border-grey-200 pt-4">
      {!open ? (
        <>
          <h3 className="text-lg font-semibold">Has this been fixed?</h3>
          <p className="mt-1 max-w-measure text-sm">
            If you or someone in your street has sorted it — cleared the drain, moved the branch —
            tell the Council. It stops a crew being sent to a problem that is already gone.
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={() => setOpen(true)}>
            I fixed it
          </button>
        </>
      ) : (
        <>
          <h3 className="text-lg font-semibold">Tell us what you fixed</h3>

          <fieldset className="mt-3">
            <legend className="label">Who is telling us?</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {REPORTER_KINDS.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  onClick={() => setBy(kind.id)}
                  aria-pressed={by === kind.id}
                  className={`min-h-tap rounded border px-3 text-sm font-semibold transition-colors duration-fast ease-standard ${
                    by === kind.id
                      ? 'border-wcc-black bg-wcc-black text-wcc-white'
                      : 'border-grey-300 bg-wcc-white hover:bg-grey-50'
                  }`}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="label mt-3 block" htmlFor="fix-note">
            What did you do? <span className="font-normal text-muted">Optional</span>
          </label>
          <textarea
            id="fix-note"
            rows={2}
            className="field mt-1 text-sm"
            placeholder="Cleared the leaves off the grate, water is draining again."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />

          <p className="mt-2 max-w-measure rounded border border-grey-200 bg-grey-50 p-3 text-sm">
            This does not close the report. The Council will see that you said it is fixed, and
            somebody has to confirm it before the status changes.{' '}
            <strong>If it is still dangerous, do not send this — call 111.</strong>
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-error-fg">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={sending} onClick={submit}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={sending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>

          {source === 'feed' && (
            <p className="mt-2 max-w-measure hint">
              This report is on the shared feed, which this page can only read. Your message goes to
              the Council console here, not back onto that feed.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Claimed({ claim, onAdd }: { claim: FixClaim; onAdd: () => void }) {
  const who =
    REPORTER_KINDS.find((k) => k.id === claim.by)?.label.replace(/^A /, 'a ') || 'someone'

  return (
    <div className="mt-6 border-t-rule border-wcc-black bg-grey-050 p-4">
      <h3 className="text-lg font-semibold">Reported as fixed</h3>
      <p className="mt-1 max-w-measure text-sm">
        {claim.count > 1
          ? `${claim.count} people have said this is fixed. The most recent was `
          : 'Sent by '}
        {who} {relativeWhen(claim.at)}, at {formatWhen(claim.at)}. The Council console shows it now.
      </p>
      {claim.note && <p className="mt-2 max-w-measure text-sm text-grey-600">“{claim.note}”</p>}
      <p className="mt-2 max-w-measure text-sm">
        The status above has <strong>not</strong> changed, and will not until a first responder or a
        Council crew confirms it. That is deliberate — nobody should take a hazard off a map on one
        person&apos;s word.
      </p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={onAdd}>
        I can confirm it too
      </button>
    </div>
  )
}
