import Wizard from '../../components/Wizard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Report an issue — Wellington (prototype)' }

export default function ReportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Wizard />
    </div>
  )
}
