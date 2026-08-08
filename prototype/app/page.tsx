import Link from 'next/link'
import { CONTACT_CENTRE } from '../lib/taxonomy'

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-bold sm:text-4xl">Tell the Council what you can see</h1>
        <p className="mt-4 text-lg text-council-ink/80">
          Report a problem in your street — a pothole any day of the year, or flooding, a slip or a
          blocked road during a storm. You get a reference number, and you can see what happened to
          your report.
        </p>
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Tile
          href="/report"
          title="Report an issue"
          body="Pick what you saw, drop a pin, add a photo. Takes about a minute."
          cta="Start a report"
          primary
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

      <section className="mt-10 card p-6">
        <h2 className="text-lg font-bold">Call, don&apos;t type</h2>
        <ul className="mt-3 space-y-1.5 text-council-ink/80">
          <li>
            <strong>111</strong> — anyone is in danger, or there is a fire, injury or immediate risk
            to life.
          </li>
          <li>
            <strong>{CONTACT_CENTRE}</strong> — urgent but not life-threatening, or the problem
            affects a large group of people.
          </li>
        </ul>
        <p className="mt-3 hint">
          A form is the wrong tool for an emergency. This channel is for the picture around the
          emergency: what a street looks like, what is passable, what a hub can see.
        </p>
      </section>

      <section className="mt-6 card p-6">
        <h2 className="text-lg font-bold">For other Impact Lab teams</h2>
        <p className="mt-2 text-council-ink/80">
          Community reports are published as GeoJSON so they can be a layer in the shared common
          operating picture. CORS is open.
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-council-ink p-4 text-sm text-white">
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
  primary?: boolean
}

function Tile({ href, title, body, cta, primary }: TileProps) {
  return (
    <Link
      href={href}
      className={`card flex flex-col p-6 transition hover:shadow-md ${
        primary ? 'border-council-accent ring-1 ring-council-accent/30' : ''
      }`}
    >
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 flex-1 text-council-ink/70">{body}</p>
      <span className="mt-4 font-semibold text-council-accent">{cta} →</span>
    </Link>
  )
}
