'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  CheckSquare,
  Download,
  HandCoins,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Menu,
  Plug,
  Search,
  Upload,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/display'
import type { NavSection } from './nav'
import type { ProfileRow } from '@/types/database'
import { ROLE_LABELS } from '@/lib/permissions'

/**
 * Explicit map rather than a wildcard `import * as Icons` — the wildcard would
 * pull every lucide icon into the client bundle.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Search,
  Users,
  CheckSquare,
  KanbanSquare,
  Inbox,
  HandCoins,
  Mail,
  Upload,
  Download,
  UserCog,
  Plug,
}

function Icon({ name, className }: { name: string; className?: string }) {
  const Resolved = ICONS[name]
  if (!Resolved) return null
  return <Resolved className={className} aria-hidden="true" />
}

/** One brand lockup for sidebar, mobile topbar and drawer alike. */
function Brand() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white"
      >
        GF
      </span>
      <span className="text-sm font-semibold tracking-tight text-slate-900">Grace Force CRM</span>
    </span>
  )
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActivePath(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      // Taller rows below lg: the drawer is a touch surface.
                      'flex items-center gap-2.5 rounded-md px-2 py-2.5 text-sm font-medium transition-colors lg:py-2',
                      active
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    <Icon
                      name={item.icon}
                      className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-slate-500')}
                    />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AppShell({
  profile,
  sections,
  signOutAction,
  children,
}: {
  profile: ProfileRow
  sections: NavSection[]
  signOutAction: () => Promise<void>
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Close the drawer on navigation, so a tap-through does not leave it open
  // over the page it just opened.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Escape closes the drawer — expected for anything modal. While it is open
  // the page behind must actually behave as inert: no scrolling underneath
  // (body lock here) and no keyboard focus escaping into it (`inert` on the
  // content wrapper below).
  useEffect(() => {
    if (!mobileOpen) return
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false)
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

      {/* Desktop sidebar. Sticky so navigation and Sign out stay reachable on
          long pages instead of scrolling away with the document. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-4">
          <Brand />
        </div>
        <NavLinks sections={sections} />
        <UserFooter
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
            className="absolute inset-0 h-full w-full bg-slate-900/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-64 flex-col bg-white shadow-xl animate-fade-in"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <Brand />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <NavLinks sections={sections} onNavigate={() => setMobileOpen(false)} />
            <UserFooter
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
        {/* Sticky topbar: the hamburger is the only way into navigation on
            phones, and pages here run thousands of pixels tall. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2.5 text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-6 w-6" />
          </button>
          <Brand />
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

function UserFooter({
  displayName,
  email,
  role,
  signOutAction,
}: {
  displayName: string
  email: string
  role: string
  signOutAction: () => Promise<void>
}) {
  return (
    <div className="shrink-0 border-t border-slate-200 px-3 py-3">
      <div className="flex items-center gap-2.5 px-2">
        <Avatar name={displayName} />
        <div className="min-w-0 flex-1">
          {/* The email lives on the name's title so a hover can confirm which
              account this is; the visible line stays the role. */}
          <p className="truncate text-sm font-medium text-slate-900" title={email}>
            {displayName}
          </p>
          <p className="truncate text-xs text-slate-500">{role}</p>
        </div>
      </div>
      <form action={signOutAction} className="mt-2">
        <button
          type="submit"
          className="w-full rounded-md px-2 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:py-2"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
