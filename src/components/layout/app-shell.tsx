'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckSquare,
  Download,
  FileSignature,
  FileText,
  HandCoins,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Menu,
  Search,
  Settings,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import graceMark from '@/brand/grace-g.webp'
import { Avatar } from '@/components/ui/display'
import type { NavItem, Navigation } from './nav'
import type { ProfileRow } from '@/types/database'
import { ROLE_LABELS } from '@/lib/permissions'

/**
 * Explicit map rather than a wildcard `import * as Icons` — the wildcard would
 * pull every lucide icon into the client bundle.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  CheckSquare,
  FileSignature,
  CalendarDays,
  FileText,
  HandCoins,
  KanbanSquare,
  Inbox,
  Mail,
  Upload,
  Download,
  Settings,
}

function Icon({ name, className }: { name: string; className?: string }) {
  const Resolved = ICONS[name]
  if (!Resolved) return null
  return <Resolved className={className} aria-hidden="true" />
}

/**
 * One brand lockup for sidebar, mobile topbar and drawer alike: the official
 * Grace "G" mark (a knockout, so the script g takes the surface's color)
 * beside the product name. The image is decorative — the adjacent text *is*
 * the accessible name.
 */
function Brand() {
  return (
    <span className="flex items-center gap-2">
      <Image
        src={graceMark}
        alt=""
        aria-hidden="true"
        priority
        className="h-6 w-6 shrink-0"
      />
      <span className="whitespace-nowrap text-sm font-bold tracking-tight text-slate-900">
        Grace Lead Management
      </span>
    </span>
  )
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The active item is a brand-tinted row with full-strength text — two signals
 * (wash and weight), either of which survives the other being missed.
 */
function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Taller rows below lg: the drawer is a touch surface.
        'flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors duration-150 lg:py-[7px] lg:text-[13px]',
        active
          ? 'bg-brand-50 font-semibold text-brand-800'
          : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      <Icon
        name={item.icon}
        className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-slate-400')}
      />
      {item.label}
    </Link>
  )
}

/**
 * Six everyday destinations, then the tools group — all of it visible at
 * once. A compact rail that shows every destination beats a tidy one that
 * hides half the product behind a disclosure.
 */
function NavLinks({ navigation, onNavigate }: { navigation: Navigation; onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <nav aria-label="Main">
        <ul className="space-y-px">
          {navigation.primary.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={isActivePath(pathname, item.href)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>

        {navigation.more.length > 0 ? (
          <>
            <p className="mb-1 mt-5 px-2.5 text-xs font-medium text-slate-500">More</p>
            <ul className="space-y-px">
              {navigation.more.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={isActivePath(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>
    </div>
  )
}

/**
 * Search is a field, not a destination.
 *
 * It submits with GET to /search, so it works before hydration and a result
 * page can be linked or bookmarked. `key` on the input resets the visible
 * value when the query changes, which stops a stale term sitting in the box
 * after navigating away.
 */
function SearchField({ className }: { className?: string }) {
  const params = useSearchParams()
  const current = params.get('q') ?? ''

  return (
    <form action="/search" role="search" className={cn('relative', className)}>
      <label htmlFor="global-search" className="sr-only">
        Search people
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      />
      <input
        id="global-search"
        key={current}
        type="search"
        name="q"
        defaultValue={current}
        placeholder="Search people…"
        autoComplete="off"
        className="h-9 w-full rounded-md bg-white px-3 py-1.5 pl-8 text-base text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-500 hover:ring-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm"
      />
    </form>
  )
}

export function AppShell({
  profile,
  navigation,
  signOutAction,
  children,
}: {
  profile: ProfileRow
  navigation: Navigation
  signOutAction: () => Promise<void>
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close the drawer on navigation, so a tap-through does not leave it open
  // over the page it just opened.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Escape closes the drawer — expected for anything modal. While it is open
  // the page behind must actually behave as inert: no scrolling underneath
  // (body lock), no keyboard focus escaping (`inert` on the content wrapper
  // plus the Tab trap here — the skip link and body sit outside the inert
  // subtree, so `inert` alone still lets Tab walk out of the dialog).
  useEffect(() => {
    if (!mobileOpen) return
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !drawerRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !drawerRef.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileOpen])

  const displayName = profile.full_name?.trim() || profile.email

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar: compact, light, always fully visible — an
          operational rail, not a showcase. Sticky so navigation and Sign out
          stay reachable on long pages. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-5">
          <Brand />
        </div>
        <NavLinks navigation={navigation} />
        <NavFooter
          settings={navigation.settings}
          displayName={displayName}
          email={profile.email}
          role={ROLE_LABELS[profile.role]}
          signOutAction={signOutAction}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* tabIndex={-1}: tap-to-close stays, but Shift+Tab from the X must
              not land on an invisible viewport-sized button. Escape and the X
              are the keyboard paths. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 h-full w-full bg-slate-950/40"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-raised animate-slide-in-left motion-reduce:animate-none"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
              <Brand />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks navigation={navigation} onNavigate={() => setMobileOpen(false)} />
            <NavFooter
              settings={navigation.settings}
              displayName={displayName}
              email={profile.email}
              role={ROLE_LABELS[profile.role]}
              signOutAction={signOutAction}
            />
          </div>
        </div>
      ) : null}

      {/* inert while the drawer is open: aria-modal alone does not stop Tab
          from wandering into content hidden behind the backdrop. */}
      <div className="flex min-w-0 flex-1 flex-col" inert={mobileOpen || undefined}>
        {/* Sticky header. On phones the hamburger is the only way into
            navigation and pages run thousands of pixels tall; on desktop the
            bar exists to carry search, which every screen should be one
            keystroke away from. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-6 lg:h-12 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <SearchField className="ml-auto hidden w-full max-w-sm lg:ml-0 lg:block" />
        </header>

        {/* Search moves under the bar on phones, where it cannot share a row
            with the wordmark without both being unusable. */}
        <div className="border-b border-slate-200 bg-white px-4 py-2 sm:px-6 lg:hidden">
          <SearchField />
        </div>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

function NavFooter({
  settings,
  displayName,
  email,
  role,
  signOutAction,
}: {
  settings: NavItem | null
  displayName: string
  email: string
  role: string
  signOutAction: () => Promise<void>
}) {
  const pathname = usePathname()

  return (
    <div className="shrink-0 border-t border-slate-200 px-3 py-3">
      {settings ? (
        <div className="mb-2">
          <NavLink item={settings} active={isActivePath(pathname, '/settings')} />
        </div>
      ) : null}
      <div className="flex items-center gap-2.5 px-2">
        <Avatar name={displayName} size="sm" />
        <div className="min-w-0 flex-1">
          {/* The email lives on the name's title so a hover can confirm which
              account this is; the visible line stays the role. */}
          <p className="truncate text-[13px] font-medium text-slate-900" title={email}>
            {displayName}
          </p>
          <p className="truncate text-xs text-slate-500">{role}</p>
        </div>
      </div>
      <form action={signOutAction} className="mt-1.5">
        <button
          type="submit"
          className="w-full rounded-md px-2 py-2 text-left text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:py-1.5"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
