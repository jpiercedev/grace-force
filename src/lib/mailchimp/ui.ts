import type { BadgeTone } from '@/components/ui/display'
import type { Json, MailchimpMemberStatus, SyncStatus } from '@/types/database'

/**
 * Presentation vocabulary for the Mailchimp screens.
 *
 * Pure and browser-safe, so the client components that show a sync result can
 * import it alongside the server components that render the tables.
 */

export interface MailchimpActionState {
  error?: string
  notice?: string
  fieldErrors?: Record<string, string>
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  partial: 'Partly succeeded',
}

export const SYNC_STATUS_TONES: Record<SyncStatus, BadgeTone> = {
  running: 'sky',
  succeeded: 'emerald',
  failed: 'red',
  partial: 'amber',
}

export const MEMBER_STATUS_LABELS: Record<MailchimpMemberStatus, string> = {
  subscribed: 'Subscribed',
  unsubscribed: 'Unsubscribed',
  cleaned: 'Cleaned',
  pending: 'Pending',
  transactional: 'Transactional',
  archived: 'Archived',
}

export const MEMBER_STATUS_TONES: Record<MailchimpMemberStatus, BadgeTone> = {
  subscribed: 'emerald',
  unsubscribed: 'zinc',
  cleaned: 'amber',
  pending: 'sky',
  transactional: 'slate',
  archived: 'slate',
}

export function memberStatusLabel(status: string): string {
  return status in MEMBER_STATUS_LABELS
    ? MEMBER_STATUS_LABELS[status as MailchimpMemberStatus]
    : status
}

export function memberStatusTone(status: string): BadgeTone {
  return status in MEMBER_STATUS_TONES ? MEMBER_STATUS_TONES[status as MailchimpMemberStatus] : 'slate'
}

/** Counters use snake_case keys; these read them out as English. */
const STAT_LABELS: Record<string, string> = {
  fetched: 'fetched',
  created: 'created',
  updated: 'updated',
  matched: 'matched',
  unmatched: 'unmatched',
  contacts_created: 'contacts created',
  members_upserted: 'subscribers stored',
  activity_upserted: 'events stored',
  engagements_created: 'engagements started',
  timeline_entries: 'timeline entries',
  reports_fetched: 'reports read',
  reports_missing: 'reports unavailable',
  warnings: 'warnings',
}

/**
 * Renders a run's `stats` jsonb as a short line. Zero counters are dropped so
 * a successful run reads as what it did, not as a list of things it did not.
 */
export function summariseStats(stats: Json): string {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return ''

  const parts: string[] = []
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || value === 0) continue
    parts.push(`${value.toLocaleString()} ${STAT_LABELS[key] ?? key.replace(/_/g, ' ')}`)
  }
  return parts.join(' · ')
}

/** Warnings recorded alongside the counters, when a run only partly worked. */
export function statWarnings(stats: Json): string[] {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return []
  const warnings = stats.warnings
  if (!Array.isArray(warnings)) return []
  return warnings.filter((entry): entry is string => typeof entry === 'string')
}

/** Mailchimp reports rates as fractions; the screen wants a percentage. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

export function durationLabel(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return 'still running'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
}
