import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  // Absolute, so the public form is not titled after the internal CRM.
  title: { absolute: 'Get in touch · Grace Force' },
  description: 'Send a message to the Grace Force team.',
}

/**
 * Chrome for the public intake pages.
 *
 * These render for unauthenticated visitors, outside the app shell and outside
 * every auth guard, so nothing below this layout may read a session or query
 * the database.
 */
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-4 sm:px-6">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white"
          >
            GF
          </span>
          <span className="text-sm font-semibold tracking-tight text-brand-700">Grace Force</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>

      <footer className="mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6">
        <p className="text-xs text-slate-500">
          Grace Force keeps what you send here only to reply to you.
        </p>
      </footer>
    </div>
  )
}
