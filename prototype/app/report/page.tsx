import Wizard from '../../components/Wizard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Report an issue — Wellington (prototype)' }

// Forms and prose narrow to 720px in this design system.
export default function ReportPage() {
  return (
    <div className="mx-auto max-w-narrow px-gutter py-section">
      <Wizard />
    </div>
  )
}
