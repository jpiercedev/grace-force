'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Sub-navigation for the administration area.
 *
 * The engagement type catalogue has no entry in the main sidebar, so this is
 * the only way to reach it; team and integrations are repeated here so the
 * three admin screens read as one place rather than three unrelated pages.
 * The eyebrow names that place.
 */
const SETTINGS_TABS = [
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/engagement-types', label: 'Engagement types' },
] as const

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Administration
      </p>
      <div className="mt-2.5 border-b border-slate-200">
        <ul className="-mb-px flex gap-x-6 overflow-x-auto px-1">
          {SETTINGS_TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-block whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm transition-colors',
                    active
                      ? 'border-brand-600 font-semibold text-brand-800'
                      : 'border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
