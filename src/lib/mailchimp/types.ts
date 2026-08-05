import type { Json } from '@/types/database'

/**
 * Marketing API v3 response shapes, narrowed to the fields the sync actually
 * reads.
 *
 * Two deliberate choices:
 *
 *  - Everything is a `type` alias rather than an `interface`, so a whole
 *    payload stays assignable to `Json` and can be mirrored verbatim into the
 *    `raw` jsonb columns.
 *  - Almost every field is optional. Mailchimp omits keys rather than sending
 *    nulls, and a missing `stats` block must not throw halfway through a sync
 *    of ten thousand members.
 */

// --- Envelope ---------------------------------------------------------------

/** Every collection endpoint reports the full match count alongside the page. */
export type MailchimpPage<T> = {
  total_items?: number
} & T

// --- Audiences --------------------------------------------------------------

export type MailchimpListStats = {
  member_count?: number
  unsubscribe_count?: number
  cleaned_count?: number
  total_contacts?: number
}

export type MailchimpList = {
  id: string
  name?: string
  web_id?: number
  permission_reminder?: string
  stats?: MailchimpListStats
}

export type MailchimpListsResponse = MailchimpPage<{ lists?: MailchimpList[] }>

// --- Members ----------------------------------------------------------------

export type MailchimpMemberTag = {
  id?: number
  name?: string
}

export type MailchimpMember = {
  /** The subscriber hash: md5 of the lowercased address. Stable per list. */
  id: string
  email_address?: string
  status?: string
  merge_fields?: Record<string, Json>
  tags?: MailchimpMemberTag[]
  member_rating?: number
  vip?: boolean
  /** Empty string when the audience does not use double opt-in. */
  timestamp_opt?: string
  timestamp_signup?: string
  last_changed?: string
  unsubscribe_reason?: string
  list_id?: string
}

export type MailchimpMembersResponse = MailchimpPage<{ members?: MailchimpMember[] }>

export type ListMembersOptions = {
  /** Page size. Mailchimp caps this at 1000. */
  count?: number
  offset?: number
  /** ISO 8601. Restricts the pull to members changed since then. */
  sinceLastChanged?: string
}

// --- Campaigns --------------------------------------------------------------

export type MailchimpCampaignSettings = {
  subject_line?: string
  preview_text?: string
  title?: string
  from_name?: string
  reply_to?: string
}

export type MailchimpCampaignRecipients = {
  list_id?: string
  list_name?: string
  recipient_count?: number
}

/**
 * Cheap aggregate returned inline with a campaign. Used as the fallback when
 * the full report is unavailable, which happens for very recent sends.
 */
export type MailchimpReportSummary = {
  opens?: number
  unique_opens?: number
  open_rate?: number
  clicks?: number
  subscriber_clicks?: number
  click_rate?: number
}

export type MailchimpCampaign = {
  id: string
  web_id?: number
  type?: string
  status?: string
  send_time?: string
  emails_sent?: number
  archive_url?: string
  recipients?: MailchimpCampaignRecipients
  settings?: MailchimpCampaignSettings
  report_summary?: MailchimpReportSummary
}

export type MailchimpCampaignsResponse = MailchimpPage<{ campaigns?: MailchimpCampaign[] }>

export type ListCampaignsOptions = {
  count?: number
  offset?: number
  /** ISO 8601. Only campaigns sent at or after this moment. */
  sinceSendTime?: string
}

// --- Reports ----------------------------------------------------------------

export type MailchimpReportBounces = {
  hard_bounces?: number
  soft_bounces?: number
  syntax_errors?: number
}

export type MailchimpReportOpens = {
  opens_total?: number
  unique_opens?: number
  open_rate?: number
  last_open?: string
}

export type MailchimpReportClicks = {
  clicks_total?: number
  unique_clicks?: number
  unique_subscriber_clicks?: number
  click_rate?: number
  last_click?: string
}

export type MailchimpCampaignReport = {
  id: string
  campaign_title?: string
  emails_sent?: number
  unsubscribed?: number
  abuse_reports?: number
  send_time?: string
  bounces?: MailchimpReportBounces
  opens?: MailchimpReportOpens
  clicks?: MailchimpReportClicks
}

// --- Per-subscriber email activity ------------------------------------------

export type MailchimpEmailActivityEntry = {
  /** `open`, `click` or `bounce`. Anything else is ignored by the sync. */
  action?: string
  timestamp?: string
  url?: string
  /** Bounce classification: `hard` or `soft`. */
  type?: string
  ip?: string
}

export type MailchimpEmailActivity = {
  campaign_id?: string
  list_id?: string
  /** The subscriber hash, matching `MailchimpMember.id`. */
  email_id?: string
  email_address?: string
  activity?: MailchimpEmailActivityEntry[]
}

export type MailchimpEmailActivityResponse = MailchimpPage<{
  emails?: MailchimpEmailActivity[]
}>

export type PageOptions = {
  count?: number
  offset?: number
}
