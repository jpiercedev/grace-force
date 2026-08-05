import type { ProfileRow } from '@/types/database'
import { canViewGiving, canWrite, isAdmin } from '@/lib/permissions'

export interface NavItem {
  href: string
  label: string
  /** lucide-react icon name, resolved by the sidebar. */
  icon: string
  /** Hidden when false for the current profile. */
  visible?: (profile: ProfileRow) => boolean
  description?: string
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/**
 * Navigation is filtered by capability so the interface never advertises an
 * action that Row Level Security would then refuse. Hiding is a courtesy;
 * the database is what actually enforces it.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { href: '/contacts', label: 'Contacts', icon: 'Users' },
      { href: '/follow-ups', label: 'Follow-ups', icon: 'CheckSquare' },
      { href: '/pipelines', label: 'Pipelines', icon: 'KanbanSquare' },
      { href: '/leads', label: 'Leads', icon: 'Inbox', visible: canWrite },
    ],
  },
  {
    label: 'Insight',
    items: [
      { href: '/giving', label: 'Giving', icon: 'HandCoins', visible: canViewGiving },
      { href: '/mailchimp', label: 'Email', icon: 'Mail' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/import', label: 'Import', icon: 'Upload', visible: canWrite },
      { href: '/export', label: 'Export', icon: 'Download', visible: canWrite },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/settings/team', label: 'Team', icon: 'UserCog', visible: isAdmin },
      { href: '/settings/integrations', label: 'Integrations', icon: 'Plug', visible: isAdmin },
    ],
  },
]

export function visibleSections(profile: ProfileRow): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.visible || item.visible(profile)),
  })).filter((section) => section.items.length > 0)
}
