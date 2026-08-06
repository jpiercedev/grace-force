import type { ProfileRow } from '@/types/database'
import { canViewGiving, canWrite, isAdmin } from '@/lib/permissions'

/**
 * Navigation comes in two shapes, and keeping them distinct is the point.
 *
 * The *definition* holds a `visible` predicate. That predicate is a function,
 * and functions cannot cross the server/client boundary — React has to
 * serialise props, and a function is not serialisable. Passing one produces:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * Marking these `'use server'` would be exactly wrong: they are synchronous
 * permission predicates, not server actions, and doing so would turn every
 * visibility check into a network round-trip.
 *
 * So the predicate is evaluated on the server and only `NavItem` — plain
 * strings — is handed to the client. The two types below are what stops the
 * definition leaking across by accident: `NavItem` has no function-valued
 * field, so assigning a definition to it will not typecheck.
 */

/** Server-side definition. May hold predicates; never leaves the server. */
interface NavItemDefinition {
  href: string
  label: string
  /** lucide-react icon name, resolved by the sidebar. */
  icon: string
  /** Evaluated on the server; the result is what the client receives. */
  visible?: (profile: ProfileRow) => boolean
}

interface NavSectionDefinition {
  label: string
  items: NavItemDefinition[]
}

/** What actually crosses to the client. Strings only — no behaviour. */
export interface NavItem {
  href: string
  label: string
  icon: string
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
const NAV_SECTION_DEFINITIONS: NavSectionDefinition[] = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { href: '/search', label: 'Search', icon: 'Search' },
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

/**
 * Resolves the definitions for one profile into client-safe data.
 *
 * The explicit field-by-field construction is deliberate. `filter` alone
 * returns the *same* objects — predicate still attached — which is precisely
 * how the function reached the client bundle before. Rebuilding each item
 * means nothing can ride along, and the `NavItem` return type makes that a
 * compile error rather than a runtime one.
 */
export function visibleSections(profile: ProfileRow): NavSection[] {
  return NAV_SECTION_DEFINITIONS.map((section) => ({
    label: section.label,
    items: section.items
      .filter((item) => !item.visible || item.visible(profile))
      .map(({ href, label, icon }): NavItem => ({ href, label, icon })),
  })).filter((section) => section.items.length > 0)
}
