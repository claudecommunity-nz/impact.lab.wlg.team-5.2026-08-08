'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// The black quick-actions bar from wellington.govt.nz, carrying this
// prototype's three routes instead of the Council's. Hover and current both
// fill yellow with black text — the design system uses colour, never opacity,
// to signal state.

const ACTIONS = [
  { href: '/report', label: 'Report an issue' },
  { href: '/track', label: 'Track a report' },
  { href: '/wcc', label: 'Council console' },
]

export default function QuickActions() {
  const pathname = usePathname()

  return (
    <nav aria-label="Quick actions" className="bg-wcc-black">
      <ul className="mx-auto flex max-w-container flex-wrap px-gutter">
        {ACTIONS.map((action) => {
          const current = pathname === action.href
          return (
            <li key={action.href}>
              <Link
                href={action.href}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-tap items-center px-4 text-sm font-semibold transition-colors duration-fast ease-standard ${
                  current
                    ? 'bg-wcc-yellow text-wcc-black'
                    : 'text-wcc-white hover:bg-wcc-yellow hover:text-wcc-black'
                }`}
              >
                {action.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
