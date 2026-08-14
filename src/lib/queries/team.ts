import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Json, NotificationStatus, SyncStatus, UserRole } from '@/types/database'

/**
 * Reads for the administration screens — team, integrations and the engagement
 * type catalogue.
 *
 * Everything goes through the request-scoped client, so Row Level Security is
 * what decides visibility: `profiles` is readable by every active user, while
 * `notifications` is admin-only. The pages guard with `requireAdmin()` first so
 * a non-admin is redirected rather than shown an inexplicably empty table.
 */

export const RECENT_SYNC_RUN_LIMIT = 15
export const RECENT_NOTIFICATION_LIMIT = 15

export const NOTIFICATION_STATUSES = [
  'pending',
  'sent',
  'failed',
  'skipped',
] as const satisfies readonly NotificationStatus[]

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

// --- Team roster ------------------------------------------------------------

export interface TeamMemberDetail {
  id: string
  email: string
  full_name: string | null
  title: string | null
  role: UserRole
  is_active: boolean
  last_seen_at: string | null
  created_at: string
}

const ROSTER_FIELDS =
  'id, email, full_name, title, role, is_active, last_seen_at, created_at'

export async function listTeamRoster(): Promise<TeamMemberDetail[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(ROSTER_FIELDS)
    // Postgres sorts false before true, so descending puts the people who can
    // still sign in above the ones who are only kept for history.
    .order('is_active', { ascending: false })
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true })

  if (error) fail('the team roster', error)
  return data ?? []
}

/**
 * Backs the warning shown before the only administrator is demoted. The
 * database refuses that change outright; this is so the screen can say so
 * before the click rather than after it.
 */
export async function countActiveAdmins(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)

  if (error) fail('the administrator count', error)
  return count ?? 0
}

export function teamMemberName(member: Pick<TeamMemberDetail, 'full_name' | 'email'>): string {
  return member.full_name?.trim() || member.email
}

// --- Engagement type catalogue ----------------------------------------------

/**
 * Live engagements per type, so deactivating one can say what it affects.
 *
 * One head count per type rather than a grouped aggregate: the catalogue holds
 * a handful of rows, and PostgREST offers no `group by` without an RPC.
 */
export async function countLiveEngagementsByType(
  typeIds: readonly string[],
): Promise<Map<string, number>> {
  if (typeIds.length === 0) return new Map()

  const supabase = await createClient()
  const entries = await Promise.all(
    typeIds.map(async (id): Promise<[string, number]> => {
      const { count, error } = await supabase
        .from('engagements')
        .select('id', { count: 'exact', head: true })
        .eq('engagement_type_id', id)
        .neq('status', 'ended')

      if (error) fail('engagement counts', error)
      return [id, count ?? 0]
    }),
  )

  return new Map(entries)
}

// --- Integration health -----------------------------------------------------

export interface SyncRunListItem {
  id: string
  integration: string
  job: string
  status: SyncStatus
  started_at: string
  finished_at: string | null
  stats: Json
  error: string | null
}

/** Every integration's runs, newest first — not just Mailchimp's. */
export async function listSyncRuns(
  limit: number = RECENT_SYNC_RUN_LIMIT,
): Promise<SyncRunListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('integration_sync_runs')
    .select('id, integration, job, status, started_at, finished_at, stats, error')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) fail('sync history', error)
  return data ?? []
}

export interface NotificationListItem {
  id: string
  kind: string
  subject: string
  status: NotificationStatus
  recipients: string[]
  error: string | null
  attempts: number
  sent_at: string | null
  created_at: string
}

export async function listNotifications(
  limit: number = RECENT_NOTIFICATION_LIMIT,
): Promise<NotificationListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, subject, status, recipients, error, attempts, sent_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) fail('the notification outbox', error)
  return data ?? []
}

/**
 * Outbox totals. The recent list only reaches back a page, and a backlog of
 * pending or failed sends is the thing an administrator actually needs to see.
 */
export async function countNotificationsByStatus(): Promise<Record<NotificationStatus, number>> {
  const supabase = await createClient()
  const entries = await Promise.all(
    NOTIFICATION_STATUSES.map(async (status): Promise<[NotificationStatus, number]> => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)

      if (error) fail('notification totals', error)
      return [status, count ?? 0]
    }),
  )

  return Object.fromEntries(entries) as Record<NotificationStatus, number>
}
