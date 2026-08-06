import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { BrandBand } from '@/app/(auth)/auth-card'

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
      <BrandBand tagline="We would love to hear from you" width="max-w-2xl" />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>

      <footer className="mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6">
        <p className="border-t border-slate-200 pt-5 text-sm text-slate-600">
          Grace Force keeps what you send here only to reply to you.
        </p>
      </footer>
    </div>
  )
}
