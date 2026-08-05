import { z } from 'zod'

/**
 * Environment access.
 *
 * Two rules shape this module:
 *
 *  1. **Validation is lazy.** `next build` evaluates module scope, so throwing
 *     here at import time would make a missing key break the build rather than
 *     the request. Every accessor validates on first call instead.
 *  2. **`NEXT_PUBLIC_*` is read literally.** Next inlines those at build time
 *     by static analysis, so `process.env[name]` would silently yield
 *     undefined in the browser.
 *
 * Optional integrations resolve to `null` rather than throwing. Callers branch
 * on that to render an "unconfigured" state, which is a supported mode of the
 * app — not an error.
 */

const PLACEHOLDER_PATTERN = /^(your-|placeholder|changeme|xxx)/i

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '' && !PLACEHOLDER_PATTERN.test(value.trim())
}

function assertServer(name: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `${name} is server-only and must never be read in browser code. ` +
        'Move this call into a server component, route handler, or server action.',
    )
  }
}

// --- Public (browser-safe) --------------------------------------------------

const publicSchema = z.object({
  supabaseUrl: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  supabaseAnonKey: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  siteUrl: z.string().url().optional(),
})

export type PublicEnv = z.infer<typeof publicSchema>

const rawPublic = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
}

/** True when Supabase credentials look real rather than placeholders. */
export function isSupabaseConfigured(): boolean {
  return present(rawPublic.supabaseUrl) && present(rawPublic.supabaseAnonKey)
}

let cachedPublic: PublicEnv | null = null

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic
  const parsed = publicSchema.safeParse({
    supabaseUrl: rawPublic.supabaseUrl,
    supabaseAnonKey: rawPublic.supabaseAnonKey,
    siteUrl: present(rawPublic.siteUrl) ? rawPublic.siteUrl : undefined,
  })
  if (!parsed.success) {
    throw new Error(
      `Supabase is not configured. ${parsed.error.issues.map((i) => i.message).join('; ')}. ` +
        'Copy .env.example to .env.local and fill in the values.',
    )
  }
  cachedPublic = parsed.data
  return cachedPublic
}

/** Absolute origin for auth callbacks and links inside notification emails. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (present(configured)) return configured.replace(/\/$/, '')
  // Vercel exposes the deployment host but not a full URL.
  const vercel = process.env.VERCEL_URL
  if (present(vercel)) return `https://${vercel}`
  return 'http://localhost:3000'
}

// --- Server-only ------------------------------------------------------------

export function serviceRoleKey(): string {
  assertServer('SUPABASE_SERVICE_ROLE_KEY')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!present(key)) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for lead intake, ' +
        'integration sync and admin tooling.',
    )
  }
  return key
}

export function hasServiceRoleKey(): boolean {
  return typeof window === 'undefined' && present(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// --- Mailchimp --------------------------------------------------------------

export interface MailchimpConfig {
  apiKey: string
  serverPrefix: string
  audienceId: string | null
  autoCreateContacts: boolean
}

/**
 * Returns null when Mailchimp is not set up. The datacenter prefix is derived
 * from the key's suffix when not given explicitly — Mailchimp keys are always
 * `<key>-<dc>`, and a mismatch between the two is a common misconfiguration.
 */
export function mailchimpConfig(): MailchimpConfig | null {
  assertServer('MAILCHIMP_API_KEY')
  const apiKey = process.env.MAILCHIMP_API_KEY
  if (!present(apiKey)) return null

  const explicitPrefix = process.env.MAILCHIMP_SERVER_PREFIX
  const derived = apiKey.includes('-') ? apiKey.split('-').pop() : undefined
  const serverPrefix = present(explicitPrefix) ? explicitPrefix.trim() : derived

  if (!serverPrefix) {
    throw new Error(
      'MAILCHIMP_SERVER_PREFIX is not set and could not be derived from ' +
        'MAILCHIMP_API_KEY (expected a key ending in "-us21" or similar).',
    )
  }

  return {
    apiKey: apiKey.trim(),
    serverPrefix,
    audienceId: present(process.env.MAILCHIMP_AUDIENCE_ID)
      ? process.env.MAILCHIMP_AUDIENCE_ID!.trim()
      : null,
    // Default on: subscribers are people the ministry is in relationship with.
    autoCreateContacts: process.env.MAILCHIMP_AUTO_CREATE_CONTACTS !== 'false',
  }
}

export function isMailchimpConfigured(): boolean {
  return typeof window === 'undefined' && present(process.env.MAILCHIMP_API_KEY)
}

// --- Resend -----------------------------------------------------------------

export interface ResendConfig {
  apiKey: string
  fromEmail: string
  recipients: string[]
}

export function resendConfig(): ResendConfig | null {
  assertServer('RESEND_API_KEY')
  const apiKey = process.env.RESEND_API_KEY
  if (!present(apiKey)) return null

  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!present(fromEmail)) {
    throw new Error(
      'RESEND_API_KEY is set but RESEND_FROM_EMAIL is not. Set a verified ' +
        'sending identity, e.g. "Bridge CRM <crm@yourdomain.org>".',
    )
  }

  return {
    apiKey: apiKey.trim(),
    fromEmail: fromEmail.trim(),
    recipients: internalRecipients(),
  }
}

export function isResendConfigured(): boolean {
  return typeof window === 'undefined' && present(process.env.RESEND_API_KEY)
}

export function internalRecipients(): string[] {
  const raw = process.env.NOTIFY_INTERNAL_EMAILS
  if (!present(raw)) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('@'))
}

// --- Lead intake ------------------------------------------------------------

export interface LeadIntakeConfig {
  secret: string | null
  allowedOrigins: string[]
  rateLimit: number
}

export function leadIntakeConfig(): LeadIntakeConfig {
  assertServer('LEAD_INTAKE_SECRET')
  const rawLimit = Number.parseInt(process.env.LEAD_INTAKE_RATE_LIMIT ?? '', 10)
  return {
    secret: present(process.env.LEAD_INTAKE_SECRET)
      ? process.env.LEAD_INTAKE_SECRET!.trim()
      : null,
    allowedOrigins: present(process.env.LEAD_INTAKE_ALLOWED_ORIGINS)
      ? process.env.LEAD_INTAKE_ALLOWED_ORIGINS!.split(',')
          .map((o) => o.trim().replace(/\/$/, ''))
          .filter(Boolean)
      : [],
    rateLimit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10,
  }
}

export function cronSecret(): string | null {
  assertServer('CRON_SECRET')
  return present(process.env.CRON_SECRET) ? process.env.CRON_SECRET!.trim() : null
}

/** Summary used by the settings screen to show what is wired up. */
export function integrationStatus() {
  return {
    supabase: isSupabaseConfigured(),
    serviceRole: hasServiceRoleKey(),
    mailchimp: isMailchimpConfigured(),
    resend: isResendConfigured(),
    notificationRecipients: internalRecipients().length,
  }
}
