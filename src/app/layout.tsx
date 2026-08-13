import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

/**
 * Source Sans 3 — a humanist sans designed for user interfaces: friendly,
 * unobtrusive, and highly legible at the 13–14px sizes a working CRM lives at.
 * Self-hosted (latin subset, variable weight) so the build needs no network
 * and the interface renders identically everywhere. License: SIL OFL 1.1,
 * alongside the files in ./fonts.
 */
const sourceSans = localFont({
  src: [
    {
      path: './fonts/source-sans-3-latin-wght-normal.woff2',
      style: 'normal',
      weight: '200 900',
    },
    {
      path: './fonts/source-sans-3-latin-wght-italic.woff2',
      style: 'italic',
      weight: '200 900',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

export const metadata: Metadata = {
  title: {
    default: 'Grace Force CRM',
    template: '%s · Grace Force CRM',
  },
  description:
    'Relationship management for Grace Force: contacts, engagements, follow-ups and giving in one place.',
  robots: {
    // A CRM holds contact and donor PII; it should never be indexed.
    index: false,
    follow: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // brand-600 spruce — keeps mobile browser chrome on the product's color.
  themeColor: '#0e7a52',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sourceSans.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
