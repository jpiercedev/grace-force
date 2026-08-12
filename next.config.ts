import type { NextConfig } from 'next'

/**
 * Security headers applied to every response.
 *
 * A CRM holds donor and contact PII, so the defaults are deliberately strict:
 * no framing, no referrer leakage to third parties, and no browser feature
 * access the app does not use.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions receive contact/donor data and, since attachments landed,
    // the files themselves: proposal documents, estate papers and scans all
    // route through `uploadAttachment`. 24mb leaves headroom above the 20mb
    // per-file ceiling that action enforces, so an oversized file is refused
    // with a sentence rather than a framework error.
    serverActions: {
      bodySizeLimit: '24mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
