import Console from '../../components/Console'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Council console — Wellington (prototype)' }

export default function WccPage() {
  return (
    <div className="mx-auto max-w-[100rem] px-gutter py-6">
      <Console />
    </div>
  )
}
