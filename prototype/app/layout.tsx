import './globals.css'
import Link from 'next/link'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Report local conditions — Wellington (prototype)',
  description:
    'Hackathon prototype: a two-way reporting channel between Wellington communities and the Council.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>
        <div className="flex min-h-screen flex-col">
          <PrototypeBanner />
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}

function PrototypeBanner() {
  return (
    <div className="bg-urgent px-4 py-2 text-center text-sm font-semibold text-white">
      Prototype — not a Council service. Nothing submitted here reaches Wellington City Council.
      In an emergency call 111.
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="border-b border-council-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded bg-council-navy text-sm font-bold text-white">
            WN
          </span>
          <span className="leading-tight">
            <span className="block text-base font-bold">Report local conditions</span>
            <span className="block text-xs text-council-ink/60">Wellington City Council · prototype</span>
          </span>
        </Link>
        <nav className="ml-auto flex flex-wrap items-center gap-1 text-sm font-semibold">
          <NavLink href="/report">Report an issue</NavLink>
          <NavLink href="/track">Track a report</NavLink>
          <NavLink href="/wcc">Council console</NavLink>
        </nav>
      </div>
    </header>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded px-3 py-2 hover:bg-council-sand">
      {children}
    </Link>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-council-line bg-white">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-council-ink/70">
        <p>
          Built at Impact Lab Wellington, 8 August 2026, for problem statement 02 — a two-way
          information channel between communities and WCC.
        </p>
        <p>
          Reports here are unverified community observations. Hazard layers shown alongside them are
          planning data, not live emergency information.
        </p>
        <p>
          Machine-readable feed:{' '}
          <a className="font-semibold text-council-accent underline" href="/api/feed">
            /api/feed
          </a>{' '}
          (GeoJSON) ·{' '}
          <a className="font-semibold text-council-accent underline" href="/api/feed?grouped=1">
            grouped
          </a>
        </p>
      </div>
    </footer>
  )
}
