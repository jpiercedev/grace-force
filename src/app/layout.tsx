import type { Metadata, Viewport } from 'next'
import { interfaceFont } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Grace Lead Management',
    template: '%s · Grace Lead Management',
  },
  description:
    'People and relationship management for the Grace team: contacts, leads, sales opportunities and follow-ups in one shared place.',
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
    <html lang="en" className={interfaceFont.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
