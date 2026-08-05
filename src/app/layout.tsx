import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Bridge CRM — Grace Force',
    template: '%s · Bridge CRM',
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
  themeColor: '#1f47d8',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
