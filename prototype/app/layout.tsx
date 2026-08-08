import './globals.css'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import QuickActions from '../components/QuickActions'
import { CONTACT_CENTRE } from '../lib/taxonomy'

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
          <SiteHeader />
          <QuickActions />
          <PrototypeNotice />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}

function SiteHeader() {
  return (
    <header className="border-b-rule border-wcc-yellow bg-wcc-white">
      <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-gutter py-4">
        <Link href="/" className="block leading-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wcc-logo.svg"
            alt="Wellington City Council — Me Heke Ki Pōneke"
            width={250}
            height={63}
            className="h-auto w-[200px] sm:w-[250px]"
          />
        </Link>
        <p className="text-sm text-muted">
          Community reporting prototype
        </p>
      </div>
    </header>
  )
}

// Urgency is stated, not implied. The design system's urgent callout: tinted
// surface, 4px rule on the top edge, phone number in the copy.
function PrototypeNotice() {
  return (
    <div role="alert" className="border-t-rule border-error-fg bg-error-bg">
      <div className="mx-auto max-w-container px-gutter py-3">
        <p className="font-semibold text-error-fg">
          Prototype — not a Council service. Nothing submitted here reaches Wellington City Council.
        </p>
        <p className="mt-1 max-w-measure text-sm">
          In an emergency call <strong>111</strong>. For urgent Council matters call{' '}
          <strong>{CONTACT_CENTRE}</strong>.
        </p>
      </div>
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t-rule border-wcc-yellow bg-wcc-black text-wcc-white">
      <div className="mx-auto grid max-w-container gap-6 px-gutter py-9 md:grid-cols-3">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-wcc-white">About this prototype</h2>
          <p className="text-sm text-grey-300">
            Built at Impact Lab Wellington, 8 August 2026, for problem statement 02 — a two-way
            information channel between communities and WCC.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-wcc-white">What you are looking at</h2>
          <p className="text-sm text-grey-300">
            Reports here are unverified community observations. Hazard layers shown alongside them
            are planning data, not live emergency information.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-wcc-white">Machine-readable feed</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <FooterLink href="/api/feed">Every report as GeoJSON</FooterLink>
            </li>
            <li>
              <FooterLink href="/api/feed?grouped=1">Grouped by fault type and proximity</FooterLink>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-grey-700">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-gutter py-4">
          <p className="text-xs text-grey-300">
            Interface built with the Wellington City Council design system. Reports are not Council
            records.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wcc-logo-white.svg"
            alt="Wellington City Council — Me Heke Ki Pōneke"
            width={200}
            height={50}
            className="h-auto w-[200px]"
          />
        </div>
      </div>
    </footer>
  )
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-wcc-white underline underline-offset-[3px] transition-colors duration-fast ease-standard hover:text-wcc-yellow"
    >
      {children}
    </a>
  )
}
