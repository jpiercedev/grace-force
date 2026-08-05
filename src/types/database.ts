/**
 * Database types for the Grace Force CRM schema.
 *
 * Hand-authored to mirror `supabase/migrations`. Regenerate with
 * `npm run db:types` once a Supabase project is configured; the shape below
 * matches what the generator emits, so it can be swapped in wholesale.
 *
 * Keep in sync when adding a migration — `tests/db/schema-contract.test.ts`
 * compares this file's table list against the live schema.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Convenience wrapper matching the generator's per-table shape. */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

// --- Enums ------------------------------------------------------------------

export type UserRole = 'admin' | 'staff' | 'viewer'

export type ContactSource =
  | 'manual'
  | 'web_form'
  | 'event'
  | 'referral'
  | 'import'
  | 'mailchimp'
  | 'giving_platform'
  | 'other'

export type LifecycleStage = 'prospect' | 'engaged' | 'active' | 'lapsed' | 'archived'

export type ContactStatus = 'active' | 'inactive' | 'archived'

export type EngagementStatus = 'prospect' | 'active' | 'paused' | 'lapsed' | 'ended'

export type ActivityType =
  | 'note'
  | 'call'
  | 'email'
  | 'meeting'
  | 'text_message'
  | 'visit'
  | 'prayer_request'
  | 'follow_up_created'
  | 'follow_up_completed'
  | 'engagement_started'
  | 'engagement_changed'
  | 'pipeline_stage_changed'
  | 'pipeline_card_created'
  | 'pipeline_card_closed'
  | 'gift_recorded'
  | 'assignment_changed'
  | 'lead_submitted'
  | 'lead_converted'
  | 'mailchimp_subscribed'
  | 'mailchimp_unsubscribed'
  | 'mailchimp_campaign_sent'
  | 'mailchimp_campaign_opened'
  | 'mailchimp_campaign_clicked'
  | 'mailchimp_bounced'
  | 'import'
  | 'system'

export type ActivityDirection = 'inbound' | 'outbound' | 'internal'

export type ActivitySource = 'manual' | 'system' | 'mailchimp' | 'import' | 'lead_form'

export type FollowUpStatus = 'open' | 'completed' | 'cancelled'

export type FollowUpPriority = 'low' | 'normal' | 'high' | 'urgent'

export type PipelineCardStatus = 'open' | 'won' | 'lost'

export type LeadStatus = 'new' | 'in_review' | 'converted' | 'spam' | 'archived'

export type GiftMethod = 'cash' | 'check' | 'card' | 'ach' | 'stock' | 'in_kind' | 'other'

export type SyncStatus = 'running' | 'succeeded' | 'failed' | 'partial'

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export type ImportStatus = 'pending' | 'validated' | 'committed' | 'failed'

export type MailchimpMemberStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'cleaned'
  | 'pending'
  | 'transactional'
  | 'archived'

export type MailchimpAction = 'sent' | 'open' | 'click' | 'bounce' | 'unsub' | 'abuse'

// --- Row shapes -------------------------------------------------------------

export type ProfileRow = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  title: string | null
  phone: string | null
  role: UserRole
  can_view_giving: boolean
  is_active: boolean
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type ContactRow = {
  id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  /** Generated column — never write. */
  full_name: string | null
  email: string | null
  /** Generated column — never write. */
  email_normalized: string | null
  secondary_email: string | null
  phone: string | null
  /** Generated column — never write. */
  phone_normalized: string | null
  mobile_phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  organization_name: string | null
  job_title: string | null
  lifecycle_stage: LifecycleStage
  status: ContactStatus
  source: ContactSource
  source_detail: string | null
  owner_id: string | null
  do_not_contact: boolean
  do_not_email: boolean
  birthday: string | null
  tags: string[]
  notes: string | null
  external_source: string | null
  external_id: string | null
  last_activity_at: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Columns the database computes; excluded from writes. */
type ContactGenerated = 'id' | 'full_name' | 'email_normalized' | 'phone_normalized' | 'created_at' | 'updated_at'

export type ContactInsert = Partial<Omit<ContactRow, ContactGenerated>> & { id?: string }
export type ContactUpdate = Partial<Omit<ContactRow, ContactGenerated>>

export type EngagementTypeRow = {
  id: string
  slug: string
  label: string
  description: string | null
  color: string
  icon: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type EngagementRow = {
  id: string
  contact_id: string
  engagement_type_id: string
  status: EngagementStatus
  role_detail: string | null
  owner_id: string | null
  started_on: string
  ended_on: string | null
  last_touch_at: string | null
  notes: string | null
  metadata: Json
  external_source: string | null
  external_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PipelineRow = {
  id: string
  slug: string
  name: string
  description: string | null
  engagement_type_id: string | null
  tracks_value: boolean
  is_default: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type PipelineStageRow = {
  id: string
  pipeline_id: string
  slug: string
  name: string
  description: string | null
  position: number
  is_won: boolean
  is_lost: boolean
  color: string
  created_at: string
  updated_at: string
}

export type PipelineCardRow = {
  id: string
  pipeline_id: string
  stage_id: string
  contact_id: string
  engagement_id: string | null
  title: string
  details: string | null
  value_cents: number | null
  currency: string
  status: PipelineCardStatus
  owner_id: string | null
  expected_close_on: string | null
  closed_at: string | null
  close_reason: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ActivityRow = {
  id: string
  contact_id: string
  engagement_id: string | null
  pipeline_card_id: string | null
  type: ActivityType
  direction: ActivityDirection
  source: ActivitySource
  subject: string | null
  body: string | null
  occurred_at: string
  actor_id: string | null
  actor_label: string | null
  metadata: Json
  dedupe_key: string | null
  is_pinned: boolean
  created_at: string
}

export type FollowUpRow = {
  id: string
  contact_id: string
  engagement_id: string | null
  pipeline_card_id: string | null
  title: string
  details: string | null
  due_at: string
  remind_at: string | null
  priority: FollowUpPriority
  status: FollowUpStatus
  assigned_to: string | null
  created_by: string | null
  completed_at: string | null
  completed_by: string | null
  outcome_note: string | null
  reminder_sent_at: string | null
  created_at: string
  updated_at: string
}

export type GiftRow = {
  id: string
  contact_id: string
  amount_cents: number
  currency: string
  given_on: string
  method: GiftMethod
  fund: string | null
  campaign: string | null
  is_recurring: boolean
  recurrence: string | null
  is_anonymous: boolean
  receipt_number: string | null
  notes: string | null
  external_source: string | null
  external_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type LeadRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  /** Generated column — never write. */
  email_normalized: string | null
  phone: string | null
  organization_name: string | null
  message: string | null
  interest: string | null
  source: ContactSource
  form_key: string
  page_url: string | null
  utm: Json
  ip_hash: string | null
  user_agent: string | null
  honeypot_tripped: boolean
  status: LeadStatus
  assigned_to: string | null
  contact_id: string | null
  converted_at: string | null
  converted_by: string | null
  dedupe_key: string | null
  created_at: string
  updated_at: string
}

export type LeadInsert = Partial<Omit<LeadRow, 'id' | 'email_normalized' | 'created_at' | 'updated_at'>>

export type MailchimpAudienceRow = {
  id: string
  mailchimp_list_id: string
  name: string
  web_id: string | null
  permission_reminder: string | null
  member_count: number
  unsubscribe_count: number
  cleaned_count: number
  is_active: boolean
  last_synced_at: string | null
  raw: Json
  created_at: string
  updated_at: string
}

export type MailchimpMemberRow = {
  id: string
  audience_id: string
  mailchimp_member_id: string
  email_address: string
  /** Generated column — never write. */
  email_normalized: string | null
  status: MailchimpMemberStatus
  contact_id: string | null
  matched_at: string | null
  match_method: string | null
  merge_fields: Json
  tags: Json
  member_rating: number | null
  is_vip: boolean
  opt_in_at: string | null
  last_changed_at: string | null
  unsubscribed_at: string | null
  raw: Json
  synced_at: string
  created_at: string
  updated_at: string
}

export type MailchimpMemberInsert = Partial<
  Omit<MailchimpMemberRow, 'id' | 'email_normalized' | 'created_at' | 'updated_at'>
> & { audience_id: string; mailchimp_member_id: string; email_address: string }

export type MailchimpCampaignRow = {
  id: string
  mailchimp_campaign_id: string
  audience_id: string | null
  web_id: string | null
  title: string | null
  subject_line: string | null
  preview_text: string | null
  from_name: string | null
  reply_to: string | null
  campaign_type: string | null
  status: string | null
  send_time: string | null
  emails_sent: number
  opens_total: number
  unique_opens: number
  clicks_total: number
  subscriber_clicks: number
  unsubscribed: number
  bounces: number
  open_rate: number | null
  click_rate: number | null
  archive_url: string | null
  raw: Json
  synced_at: string
  created_at: string
  updated_at: string
}

export type MailchimpCampaignActivityRow = {
  id: string
  campaign_id: string
  member_id: string | null
  contact_id: string | null
  email_address: string
  /** Generated column — never write. */
  email_normalized: string | null
  action: MailchimpAction
  action_at: string | null
  url: string | null
  event_count: number
  dedupe_key: string
  created_at: string
  updated_at: string
}

export type MailchimpCampaignActivityInsert = Partial<
  Omit<MailchimpCampaignActivityRow, 'id' | 'email_normalized' | 'created_at' | 'updated_at'>
> & { campaign_id: string; email_address: string; action: MailchimpAction; dedupe_key: string }

export type IntegrationSyncRunRow = {
  id: string
  integration: string
  job: string
  status: SyncStatus
  started_at: string
  finished_at: string | null
  stats: Json
  error: string | null
  triggered_by: string | null
  created_at: string
}

export type NotificationRow = {
  id: string
  kind: string
  dedupe_key: string
  recipients: string[]
  subject: string
  body_text: string | null
  body_html: string | null
  status: NotificationStatus
  provider: string
  provider_message_id: string | null
  error: string | null
  attempts: number
  payload: Json
  related_contact_id: string | null
  related_lead_id: string | null
  related_follow_up_id: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export type ImportBatchRow = {
  id: string
  kind: 'contacts' | 'gifts'
  filename: string | null
  status: ImportStatus
  total_rows: number
  valid_rows: number
  error_rows: number
  created_rows: number
  updated_rows: number
  skipped_rows: number
  column_mapping: Json
  options: Json
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  committed_at: string | null
}

export type ImportRowRow = {
  id: string
  batch_id: string
  row_number: number
  raw: Json
  normalized: Json
  errors: Json
  action: 'create' | 'update' | 'skip' | 'error'
  applied: boolean
  contact_id: string | null
  gift_id: string | null
  created_at: string
}

export type ContactGivingSummaryRow = {
  contact_id: string
  gift_count: number
  total_cents: number
  first_gift_on: string | null
  last_gift_on: string | null
  largest_gift_cents: number
  average_gift_cents: number
  ytd_cents: number
  trailing_12mo_cents: number
  has_recurring: boolean
}

export type ContactEmailEngagementRow = {
  contact_id: string
  emails_received: number
  campaigns_opened: number
  campaigns_clicked: number
  bounces: number
  unsubscribes: number
  last_opened_at: string | null
  last_clicked_at: string | null
  last_email_event_at: string | null
}

// --- Database ---------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      contacts: Table<ContactRow, ContactInsert, ContactUpdate>
      engagement_types: Table<EngagementTypeRow>
      engagements: Table<EngagementRow>
      pipelines: Table<PipelineRow>
      pipeline_stages: Table<PipelineStageRow>
      pipeline_cards: Table<PipelineCardRow>
      activities: Table<ActivityRow>
      follow_ups: Table<FollowUpRow>
      gifts: Table<GiftRow>
      leads: Table<LeadRow, LeadInsert>
      mailchimp_audiences: Table<MailchimpAudienceRow>
      mailchimp_members: Table<MailchimpMemberRow, MailchimpMemberInsert>
      mailchimp_campaigns: Table<MailchimpCampaignRow>
      mailchimp_campaign_activity: Table<
        MailchimpCampaignActivityRow,
        MailchimpCampaignActivityInsert
      >
      integration_sync_runs: Table<IntegrationSyncRunRow>
      notifications: Table<NotificationRow>
      import_batches: Table<ImportBatchRow>
      import_rows: Table<ImportRowRow>
      rate_limit_hits: Table<{ bucket: string; window_start: string; hits: number }>
    }
    Views: {
      contact_giving_summary: {
        Row: ContactGivingSummaryRow
        Relationships: []
      }
      contact_email_engagement: {
        Row: ContactEmailEngagementRow
        Relationships: []
      }
    }
    Functions: {
      convert_lead: {
        Args: { p_lead_id: string; p_owner_id?: string | null }
        Returns: string
      }
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds?: number }
        Returns: boolean
      }
      prune_rate_limit_hits: {
        Args: { p_older_than_hours?: number }
        Returns: number
      }
    }
    Enums: {
      user_role: UserRole
      contact_source: ContactSource
      lifecycle_stage: LifecycleStage
      contact_status: ContactStatus
      engagement_status: EngagementStatus
      activity_type: ActivityType
      activity_direction: ActivityDirection
      activity_source: ActivitySource
      follow_up_status: FollowUpStatus
      follow_up_priority: FollowUpPriority
      pipeline_card_status: PipelineCardStatus
      lead_status: LeadStatus
      gift_method: GiftMethod
      sync_status: SyncStatus
      notification_status: NotificationStatus
      import_status: ImportStatus
    }
    CompositeTypes: Record<never, never>
  }
}
