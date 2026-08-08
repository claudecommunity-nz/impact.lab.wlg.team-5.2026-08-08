import Link from 'next/link'
import { CONTACT_CENTRE } from '../lib/taxonomy'

export default function HomePage() {
  return (
    <div className="mx-auto max-w-container px-gutter py-section">
      <header>
        <h1 className="max-w-measure text-4xl font-bold tracking-[-0.015em]">
          Tell the Council what you can see
        </h1>
        <span aria-hidden="true" className="rule-yellow mt-4" />
        <p className="mt-4 max-w-measure text-lg">
          Report a problem in your street — a pothole any day of the year, or flooding, a slip or a
          blocked road during a storm. You get a reference number, and you can see what happened to
          your report.
        </p>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Tile
          href="/report"
          title="Report an issue"
          body="Pick what you saw, drop a pin, add a photo. Takes about a minute."
          cta="Start a report"
          accent
        />
        <Tile
          href="/track"
          title="Track a report"
          body="Enter your reference number to see whether your report has been checked or acted on."
          cta="Look up a reference"
        />
        <Tile
          href="/wcc"
          title="Council console"
          body="The other side of the channel: everything coming in, grouped, on a map. Set a status and the reporter sees it."
          cta="Open the console"
        />
      </div>

      <section className="mt-6 border-t-rule border-error-fg bg-error-bg p-6">
        <h2 className="text-xl font-semibold text-error-fg">Call, do not type</h2>
        <ul className="mt-3 max-w-measure space-y-2">
          <li>
            <strong>111</strong> — anyone is in danger, or there is a fire, injury or immediate risk
            to life.
          </li>
          <li>
            <strong>{CONTACT_CENTRE}</strong> — urgent but not life-threatening, or the problem
            affects a large group of people.
          </li>
        </ul>
        <p className="mt-3 max-w-measure text-sm">
          A form is the wrong tool for an emergency. This channel is for the picture around the
          emergency: what a street looks like, what is passable, what a hub can see.
        </p>
      </section>

      <section className="card mt-4 p-6">
        <h2 className="text-xl font-semibold">For other Impact Lab teams</h2>
        <p className="mt-2 max-w-measure">
          Community reports are published as GeoJSON so they can be a layer in the shared common
          operating picture. CORS is open.
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-wcc-black p-4 font-mono text-sm text-wcc-white">
{`GET /api/feed              # every report as a point
GET /api/feed?grouped=1    # clustered by fault type + proximity
GET /api/reports           # full records, plus grouping
POST /api/reports          # file a report`}
        </pre>
      </section>
    </div>
  )
}

interface TileProps {
  href: string
  title: string
  body: string
  cta: string
  accent?: boolean
}

// An emphasised card takes the 4px yellow rule along its top edge. A coloured
// left border is not part of this system.
function Tile({ href, title, body, cta, accent }: TileProps) {
  return (
    <Link
      href={href}
      className={`card card-interactive flex flex-col p-6 ${accent ? 'card-accent' : ''}`}
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 flex-1 text-grey-600">{body}</p>
      <span className="mt-4 font-semibold">{cta} →</span>
    </Link>
  )
}
