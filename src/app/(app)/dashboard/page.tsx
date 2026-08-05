import { PageHeader } from '@/components/ui/display'
import { requireProfile } from '@/lib/auth'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const profile = await requireProfile()
  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? 'there'

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`Welcome back, ${firstName}`} description="Your relationships at a glance." />
    </div>
  )
}
