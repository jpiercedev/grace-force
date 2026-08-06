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

/**
 * One brand lockup for sidebar, mobile topbar and drawer alike. The wordmark
 * speaks in the serif display voice; `onDark` flips it for the ink rail.
 */
function Brand({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 translate-y-1 items-center justify-center self-center rounded-lg bg-brand-600 font-display text-[13px] font-bold text-brand-50"
      >
        G
      </span>
      <span
        className={cn(
          'font-display text-[17px] font-semibold tracking-tight',
          onDark ? 'text-slate-50' : 'text-slate-900',
        )}
      >
        Grace Force
      </span>
      <span
        className={cn(
          'text-[10px] font-semibold uppercase tracking-[0.14em]',
          // AA floor even for this whisper of a label.
          onDark ? 'text-white/70' : 'text-slate-500',
        )}
      >
        CRM
      </span>
    </span>
  )
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Navigation on the ink rail. The active item carries three quiet signals —
 * a soft wash, full-strength text, and a short evergreen bar — so "where am
 * I" survives any one of them being missed.
 */
function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
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
                      'relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 lg:py-2',
                      active
                        ? 'bg-white/[0.08] text-white'
                        : 'text-white/65 hover:bg-white/[0.05] hover:text-white',
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400"
                      />
                    ) : null}
                    <Icon
                      name={item.icon}
                      className={cn('h-4 w-4 shrink-0', active ? 'text-brand-300' : 'text-white/40')}
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
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

      {/* Desktop sidebar: the one dark surface in the product — a deep
          evergreen-ink rail that gives the app its silhouette and makes the
          parchment canvas feel light. Sticky so navigation and Sign out stay
          reachable on long pages. */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex h-16 shrink-0 items-center border-b border-ink-line px-5">
          <Brand onDark />
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
            className="absolute inset-0 h-full w-full bg-slate-950/50"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-ink shadow-raised animate-slide-in-left motion-reduce:animate-none"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-ink-line px-5">
              <Brand onDark />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2.5 text-slate-600 transition-colors hover:bg-slate-100"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-6 w-6" />
          </button>
          <Brand />
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
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
    <div className="shrink-0 border-t border-ink-line px-3 py-3">
      <div className="flex items-center gap-2.5 px-2">
        <Avatar name={displayName} />
        <div className="min-w-0 flex-1">
          {/* The email lives on the name's title so a hover can confirm which
              account this is; the visible line stays the role. */}
          <p className="truncate text-sm font-medium text-white" title={email}>
            {displayName}
          </p>
          <p className="truncate text-xs text-white/50">{role}</p>
        </div>
      </div>
      <form action={signOutAction} className="mt-2">
        <button
          type="submit"
          className="w-full rounded-lg px-2 py-2.5 text-left text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white lg:py-2"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
