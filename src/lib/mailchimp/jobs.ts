/**
 * The vocabulary of the four sync jobs.
 *
 * Kept apart from the engine so that the cron route, the admin control and the
 * sync engine can all name the same jobs without a client bundle inheriting
 * the engine — this module has no imports and no runtime dependencies.
 */

export type MailchimpJob = 'audiences' | 'members' | 'campaigns' | 'activity'

/** Canonical order. Members need audiences, and activity needs campaigns. */
export const MAILCHIMP_JOBS: readonly MailchimpJob[] = [
  'audiences',
  'members',
  'campaigns',
  'activity',
]

export const MAILCHIMP_JOB_LABELS: Record<MailchimpJob, string> = {
  audiences: 'Audiences',
  members: 'Subscribers',
  campaigns: 'Campaigns',
  activity: 'Campaign activity',
}

export const MAILCHIMP_JOB_DESCRIPTIONS: Record<MailchimpJob, string> = {
  audiences: 'Lists and their headline counts.',
  members: 'Subscribers, contact matching and newsletter engagements.',
  campaigns: 'Sent campaigns and their performance.',
  activity: 'Per-person opens and clicks for recent campaigns.',
}

export function parseMailchimpJob(value: string | null | undefined): MailchimpJob | 'all' | null {
  const trimmed = value?.trim().toLowerCase() ?? ''
  if (trimmed === '' || trimmed === 'all') return 'all'
  return MAILCHIMP_JOBS.find((job) => job === trimmed) ?? null
}

export function jobsFor(selection: MailchimpJob | 'all'): MailchimpJob[] {
  return selection === 'all' ? [...MAILCHIMP_JOBS] : [selection]
}
