import PublicMap from '../../components/PublicMap'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Map for Communities — Wellington (prototype)' }

export default function MapPage() {
  return (
    <div className="mx-auto max-w-[100rem] px-gutter py-section">
      <PublicMap />
    </div>
  )
}
