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
    /**
     * Server Actions receive contact and donor data and, since attachments
     * landed, the files themselves — proposal documents, estate papers and
     * scans all route through `uploadAttachment`.
     *
     * The arithmetic, which is why this is 24 and not some rounder number:
     * `@/lib/attachments` caps a single upload at 20MB *in total* across every
     * file in the batch, and multipart framing adds only a few hundred bytes
     * per part (binary, no base64 inflation). 24mb therefore clears the
     * largest submission the application will accept, with room to spare. The
     * total cap is the load-bearing half — capping only each file would let
     * three legal 15MB files add up to a request that dies here, at the
     * framework layer, with no message anyone can act on.
     *
     * The trade-off worth stating: this setting is global, so every action now
     * accepts a larger body than the 4mb it used to. Next.js offers no
     * per-action override. The exposure is bounded by authentication — every
     * action in this app calls `requireProfile`/`requireWriteAccess` before
     * touching the payload — and the alternative (moving uploads to a route
     * handler to keep actions small) trades that for hand-rolled CSRF
     * protection, which server actions provide and a route handler does not.
     */
    serverActions: {
      bodySizeLimit: '24mb',
    },

    /**
     * The second ceiling, and the one that actually bit.
     *
     * Every authenticated route in this app passes through `src/middleware.ts`
     * (it refreshes the Supabase session). For any route with middleware,
     * Next.js buffers at most 10MB of the request body and *silently truncates
     * the rest* — `serverActions.bodySizeLimit` does not raise it. The upload
     * then fails deep inside form parsing with `Unexpected end of form`, which
     * reaches the person as a generic error with no hint that the file was too
     * large, while the interface is still promising 20MB.
     *
     * Found by driving a 19MB upload through the real form rather than a mock,
     * which is why that round trip is worth keeping (see
     * `docs/IMPLEMENTATION_STATUS.md`). Both ceilings have to clear the 20MB
     * total that `@/lib/attachments` accepts, or the smaller one wins quietly.
     */
    middlewareClientMaxBodySize: '24mb',
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
