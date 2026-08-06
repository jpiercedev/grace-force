import type { Metadata, Viewport } from 'next'
import './globals.css'

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
  // brand-600 evergreen — keeps mobile browser chrome on the product's color.
  themeColor: '#2b6a4d',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
