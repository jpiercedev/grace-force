import type { ProfileRow } from '@/types/database'
import { canWrite, isAdmin } from '@/lib/permissions'

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

/** Strings only — no behaviour. What actually crosses to the client. */
export interface NavItem {
  href: string
  label: string
  icon: string
}

export interface Navigation {
  /** The everyday work of relationship and lead management. */
  primary: NavItem[]
  /** Less-frequent tools, in their own labelled group — always visible. */
  more: NavItem[]
  /** The single administration entry, pinned to the foot of the rail. */
  settings: NavItem | null
}

/**
 * Six everyday destinations, then a quieter group of tools.
 *
 * Everything is visible at once — no collapse, no scroll — because knowing
 * what the product can do is part of being able to use it. The hierarchy is
 * carried by grouping and order, not by hiding: the top group is where the
 * team lives most weeks — people, sales opportunities, follow-through; the
 * group below is the machinery (giving records, planned gifts, lead triage,
 * email marketing, data in and out) they reach for on purpose rather than by
 * habit.
 *
 * This is one shared workspace: nothing here is gated on giving visibility
 * any more, and viewers see every destination their read access covers.
 *
 * Search is not a destination: it is a field in the header, on every page.
 */
const PRIMARY: NavItemDefinition[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { href: '/contacts', label: 'People', icon: 'Users' },
  { href: '/sales', label: 'Sales', icon: 'TrendingUp' },
  { href: '/follow-ups', label: 'Follow-ups', icon: 'CheckSquare' },
  { href: '/events', label: 'Events', icon: 'CalendarDays' },
  { href: '/reports', label: 'Call reports', icon: 'FileText' },
]

const MORE: NavItemDefinition[] = [
  { href: '/leads', label: 'New leads', icon: 'Inbox' },
  { href: '/proposals', label: 'Planned gifts', icon: 'FileSignature' },
  { href: '/giving', label: 'Giving', icon: 'HandCoins' },
  { href: '/mailchimp', label: 'Marketing', icon: 'Mail' },
  { href: '/import', label: 'Import', icon: 'Upload', visible: canWrite },
  { href: '/export', label: 'Export', icon: 'Download', visible: canWrite },
]

const SETTINGS: NavItemDefinition = {
  href: '/settings/team',
  label: 'Settings',
  icon: 'Settings',
  visible: isAdmin,
}

/**
 * Rebuilding each item field by field is deliberate. `filter` alone returns the
 * *same* objects — predicate still attached — which is precisely how a function
 * reached the client bundle before. The `NavItem` return type makes a leak a
 * compile error rather than a runtime one.
 */
function resolve(items: NavItemDefinition[], profile: ProfileRow): NavItem[] {
  return items
    .filter((item) => !item.visible || item.visible(profile))
    .map(({ href, label, icon }): NavItem => ({ href, label, icon }))
}

export function visibleNavigation(profile: ProfileRow): Navigation {
  const settings = SETTINGS.visible?.(profile) ?? true
  return {
    primary: resolve(PRIMARY, profile),
    more: resolve(MORE, profile),
    settings: settings ? { href: SETTINGS.href, label: SETTINGS.label, icon: SETTINGS.icon } : null,
  }
}
