import 'server-only'

import { hasServiceRoleKey, isMailchimpConfigured, mailchimpConfig } from '@/lib/env'
import { MailchimpClient } from '@/lib/mailchimp/client'
import type { MailchimpJob } from '@/lib/mailchimp/jobs'
import { runMailchimpJobs, type SyncDeps, type SyncRunResult } from '@/lib/mailchimp/sync'
/*
 * Integration sync is one of the three sanctioned service-role callers. It
 * reconciles whole audiences and writes rows nobody is signed in for, which is
 * exactly what a user-scoped client cannot do.
 */
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The only server-only module in the Mailchimp folder.
 *
 * Everything else takes its collaborators as arguments; this is where the real
 * API client and the service-role database client are built. Keeping the
 * wiring here is what lets the sync engine be tested without either.
 */

/**
 * Why a sync cannot run right now, or null when it can. Callers turn this into
 * a 503 or an on-screen explanation rather than attempting the run and failing.
 */
export function mailchimpUnavailableReason(): string | null {
  if (!isMailchimpConfigured()) {
    return 'Mailchimp is not configured. Set MAILCHIMP_API_KEY (and MAILCHIMP_SERVER_PREFIX if the key has no datacenter suffix).'
  }
  if (!hasServiceRoleKey()) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set, so the sync has no way to write the mirrored data.'
  }
  return null
}

export function isMailchimpSyncAvailable(): boolean {
  return mailchimpUnavailableReason() === null
}

function syncDeps(triggeredBy: string | null): SyncDeps {
  const config = mailchimpConfig()
  if (!config) throw new Error('Mailchimp is not configured.')

  return {
    client: new MailchimpClient({
      apiKey: config.apiKey,
      serverPrefix: config.serverPrefix,
    }),
    db: createAdminClient(),
    options: {
      audienceId: config.audienceId,
      autoCreateContacts: config.autoCreateContacts,
      triggeredBy,
    },
  }
}

/**
 * Runs the requested jobs. Callers must check `mailchimpUnavailableReason()`
 * first — reaching here unconfigured is a programming error, not a user one.
 */
export async function runMailchimpSync(
  jobs: readonly MailchimpJob[],
  triggeredBy: string | null = null,
): Promise<SyncRunResult[]> {
  const reason = mailchimpUnavailableReason()
  if (reason) throw new Error(reason)
  return runMailchimpJobs(syncDeps(triggeredBy), jobs)
}
