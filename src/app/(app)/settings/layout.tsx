import type { ReactNode } from 'react'
import { requireAdmin } from '@/lib/auth'
import { SettingsNav } from './settings-nav'

/**
 * Administration shell. The guard here means a non-admin never sees the tab
 * strip flash before being redirected; each page guards again, because a
 * layout is not a security boundary and Row Level Security is what actually
 * refuses the writes underneath.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireAdmin()

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SettingsNav />
      {children}
    </div>
  )
}
