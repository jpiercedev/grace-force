import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { contactDisplayName } from '@/lib/utils'
import type { Json, SyncStatus } from '@/types/database'

/**
 * Reads for the Mailchimp screens.
 *
 * All of it goes through the user-scoped client, so Row Level Security is what
 * decides visibility: every active profile may read the mirrored tables, and
 * only an admin may update `mailchimp_members` to correct a link. The sync
 * jobs are the only writers, and they are elsewhere.
 */

export const RECENT_CAMPAIGN_LIMIT = 10
export const RECENT_RUN_LIMIT = 12
export const UNMATCHED_PAGE_SIZE = 50
export const CONTACT_SEARCH_LIMIT = 20

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

export interface AudienceSummary {
  id: string
  mailchimp_list_id: string
  name: string
  member_count: number
  unsubscribe_count: number
  cleaned_count: number
  last_synced_at: string | null
  /** Rows actually mirrored locally, which may lag the provider's own count. */
  stored: number
  unmatched: number
}

export interface CampaignSummary {
  id: string
  mailchimp_campaign_id: string
  title: string | null
  subject_line: string | null
  send_time: string | null
  emails_sent: number
  unique_opens: number
  subscriber_clicks: number
  bounces: number
  open_rate: number | null
  click_rate: number | null
  archive_url: string | null
}

export interface SyncRunSummary {
  id: string
  job: string
  status: SyncStatus
  started_at: string
  finished_at: string | null
  stats: Json
  error: string | null
}

export interface MailchimpOverview {
  audiences: AudienceSummary[]
  campaigns: CampaignSummary[]
  runs: SyncRunSummary[]
  totals: {
    audiences: number
    subscribers: number
    unmatched: number
    campaigns: number
  }
  lastSyncedAt: string | null
}

export async function getMailchimpOverview(): Promise<MailchimpOverview> {
  const supabase = await createClient()

  const [audienceRows, campaigns, runs, subscribers, unmatched, campaignCount] = await Promise.all([
    supabase
      .from('mailchimp_audiences')
      .select('id, mailchimp_list_id, name, member_count, unsubscribe_count, cleaned_count, last_synced_at')
      .order('name', { ascending: true }),
    supabase
      .from('mailchimp_campaigns')
      .select(
        'id, mailchimp_campaign_id, title, subject_line, send_time, emails_sent, unique_opens, subscriber_clicks, bounces, open_rate, click_rate, archive_url',
      )
      .order('send_time', { ascending: false, nullsFirst: false })
      .limit(RECENT_CAMPAIGN_LIMIT),
    supabase
      .from('integration_sync_runs')
      .select('id, job, status, started_at, finished_at, stats, error')
      .eq('integration', 'mailchimp')
      .order('started_at', { ascending: false })
      .limit(RECENT_RUN_LIMIT),
    supabase.from('mailchimp_members').select('id', { count: 'exact', head: true }),
    supabase
      .from('mailchimp_members')
      .select('id', { count: 'exact', head: true })
      .is('contact_id', null),
    supabase.from('mailchimp_campaigns').select('id', { count: 'exact', head: true }),
  ])

  if (audienceRows.error) fail('audiences', audienceRows.error)
  if (campaigns.error) fail('campaigns', campaigns.error)
  if (runs.error) fail('sync runs', runs.error)
  if (subscribers.error) fail('subscriber totals', subscribers.error)
  if (unmatched.error) fail('unmatched subscribers', unmatched.error)
  if (campaignCount.error) fail('campaign totals', campaignCount.error)

  // One pair of head counts per audience. There are a handful of audiences at
  // most, and PostgREST offers no grouped count without an RPC.
  const audiences = await Promise.all(
    (audienceRows.data ?? []).map(async (row): Promise<AudienceSummary> => {
      const [stored, unlinked] = await Promise.all([
        supabase
          .from('mailchimp_members')
          .select('id', { count: 'exact', head: true })
          .eq('audience_id', row.id),
        supabase
          .from('mailchimp_members')
          .select('id', { count: 'exact', head: true })
          .eq('audience_id', row.id)
          .is('contact_id', null),
      ])
      return {
        ...row,
        stored: stored.count ?? 0,
        unmatched: unlinked.count ?? 0,
      }
    }),
  )

  const lastSyncedAt = audiences.reduce<string | null>(
    (latest, audience) =>
      audience.last_synced_at && (!latest || audience.last_synced_at > latest)
        ? audience.last_synced_at
        : latest,
    null,
  )

  return {
    audiences,
    campaigns: campaigns.data ?? [],
    runs: runs.data ?? [],
    totals: {
      audiences: audiences.length,
      subscribers: subscribers.count ?? 0,
      unmatched: unmatched.count ?? 0,
      campaigns: campaignCount.count ?? 0,
    },
    lastSyncedAt,
  }
}

// --- Unmatched review queue -------------------------------------------------

export interface UnmatchedMember {
  id: string
  email_address: string
  status: string
  last_changed_at: string | null
  merge_fields: Json
  audience: { id: string; name: string } | null
}

interface UnmatchedRow {
  id: string
  email_address: string
  status: string
  last_changed_at: string | null
  merge_fields: Json
  audience: { id: string; name: string } | null
}

const UNMATCHED_SELECT = `
  id, email_address, status, last_changed_at, merge_fields,
  audience:mailchimp_audiences(id, name)
`

export async function listUnmatchedMembers(
  limit: number = UNMATCHED_PAGE_SIZE,
): Promise<{ items: UnmatchedMember[]; total: number }> {
  const supabase = await createClient()

  const { data, error, count } = await supabase
    .from('mailchimp_members')
    .select(UNMATCHED_SELECT, { count: 'exact' })
    .is('contact_id', null)
    // Newest movement first: a subscriber who just joined is the one most
    // likely to be worth linking by hand.
    .order('last_changed_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit)
    .overrideTypes<UnmatchedRow[], { merge: false }>()

  if (error) fail('unmatched subscribers', error)

  const rows = data ?? []
  return { items: rows, total: count ?? rows.length }
}

export async function getUnmatchedMember(id: string): Promise<UnmatchedMember | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mailchimp_members')
    .select(UNMATCHED_SELECT)
    .eq('id', id)
    .is('contact_id', null)
    .maybeSingle()
    .overrideTypes<UnmatchedRow, { merge: false }>()

  if (error) fail('that subscriber', error)
  return data ?? null
}

export interface LinkCandidate {
  id: string
  name: string
  email: string | null
  organization_name: string | null
}

/**
 * Contacts an admin might link a subscriber to. Deliberately a search rather
 * than a full list: a select holding every contact in the CRM is neither
 * usable nor navigable from a keyboard.
 */
export async function searchContactsToLink(
  term: string,
  limit: number = CONTACT_SEARCH_LIMIT,
): Promise<LinkCandidate[]> {
  const cleaned = term.replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return []

  const supabase = await createClient()
  const like = `%${cleaned}%`

  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, preferred_name, first_name, last_name, organization_name, email')
    .is('deleted_at', null)
    .or(
      [
        `full_name.ilike.${like}`,
        `preferred_name.ilike.${like}`,
        `email.ilike.${like}`,
        `secondary_email.ilike.${like}`,
        `organization_name.ilike.${like}`,
      ].join(','),
    )
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit)

  if (error) fail('contacts', error)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: contactDisplayName(row),
    email: row.email,
    organization_name: row.organization_name,
  }))
}
