import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityRow,
  ContactRow,
  Database,
  EngagementRow,
  FollowUpRow,
  GiftRow,
  Json,
  LeadRow,
  PipelineCardRow,
} from '@/types/database'

/**
 * What this CRM can hand back.
 *
 * Each dataset is one table, exported with its own `id` and with its parents'
 * ids in plain `contact_id` / `engagement_id` columns, so the relationships
 * survive in the CSVs alone — no lookup table, no proprietary key, nothing
 * that only makes sense inside this application.
 *
 * Reading is paged and injected as a client, never a module-level connection:
 * an export must run as the person asking for it so Row Level Security
 * returns exactly the rows they could already see on screen.
 */

export type ExportValue = string | number | boolean | null
export type ExportRow = Record<string, ExportValue>
export type ExportClient = SupabaseClient<Database>

/** Rows per round-trip. Well under PostgREST's ceiling, and bounded memory. */
export const EXPORT_PAGE_SIZE = 500

export type ExportDatasetKey =
  | 'contacts'
  | 'engagements'
  | 'activities'
  | 'follow_ups'
  | 'gifts'
  | 'pipeline_cards'
  | 'leads'

/** Reads one page. An empty result ends the export. */
export type ExportPageReader = (offset: number, limit: number) => Promise<ExportRow[]>

export interface ExportDataset {
  key: ExportDatasetKey
  label: string
  description: string
  /** CSV header order, and the source of truth for what a row contains. */
  columns: readonly string[]
  /** Datasets whose ids appear in this one's columns. */
  references: readonly ExportDatasetKey[]
  /** A capability beyond write access that the caller also needs. */
  requires: 'giving' | null
  countRows: (db: ExportClient) => Promise<number>
  createReader: (db: ExportClient) => Promise<ExportPageReader>
}

function failed(what: string, error: PostgrestError): Error {
  return new Error(`Exporting ${what}: ${error.message}`)
}

/** Tags re-import unchanged: the contact importer splits on comma or semicolon. */
function list(values: readonly string[] | null): string {
  return values && values.length > 0 ? values.join(', ') : ''
}

function json(value: Json): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return ''
  if (Array.isArray(value) && value.length === 0) return ''
  return JSON.stringify(value)
}

// --- contacts ---------------------------------------------------------------
//
// Each `*_SELECT` is one unbroken literal on purpose: the typed client infers
// the row shape from the literal itself, and a string built by concatenation
// infers nothing, which quietly turns every mapper argument into an error.

export const CONTACT_EXPORT_COLUMNS = [
  'id',
  'external_source',
  'external_id',
  'first_name',
  'last_name',
  'preferred_name',
  'full_name',
  'email',
  'secondary_email',
  'phone',
  'mobile_phone',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'organization_name',
  'job_title',
  'lifecycle_stage',
  'status',
  'source',
  'source_detail',
  'owner_id',
  'do_not_contact',
  'do_not_email',
  'birthday',
  'tags',
  'notes',
  'last_activity_at',
  'created_at',
  'updated_at',
] as const

const CONTACT_SELECT = 'id, external_source, external_id, first_name, last_name, preferred_name, full_name, email, secondary_email, phone, mobile_phone, address_line1, address_line2, city, region, postal_code, country, organization_name, job_title, lifecycle_stage, status, source, source_detail, owner_id, do_not_contact, do_not_email, birthday, tags, notes, last_activity_at, created_at, updated_at'

export type ContactExportRecord = Pick<ContactRow, (typeof CONTACT_EXPORT_COLUMNS)[number]>

export function contactExportRow(record: ContactExportRecord): ExportRow {
  return { ...record, tags: list(record.tags) }
}

// --- engagements ------------------------------------------------------------

export const ENGAGEMENT_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'engagement_type_id',
  'engagement_type',
  'engagement_type_label',
  'status',
  'role_detail',
  'owner_id',
  'started_on',
  'ended_on',
  'last_touch_at',
  'notes',
  'external_source',
  'external_id',
  'created_at',
  'updated_at',
] as const

const ENGAGEMENT_SELECT = 'id, contact_id, engagement_type_id, status, role_detail, owner_id, started_on, ended_on, last_touch_at, notes, external_source, external_id, created_at, updated_at'

export type EngagementExportRecord = Pick<
  EngagementRow,
  | 'id'
  | 'contact_id'
  | 'engagement_type_id'
  | 'status'
  | 'role_detail'
  | 'owner_id'
  | 'started_on'
  | 'ended_on'
  | 'last_touch_at'
  | 'notes'
  | 'external_source'
  | 'external_id'
  | 'created_at'
  | 'updated_at'
>

export interface EngagementTypeLabel {
  slug: string
  label: string
}

/**
 * The type's slug travels beside its id. The id keeps the export joinable;
 * the slug keeps it readable in a spreadsheet, where nobody can tell one uuid
 * from another.
 */
export function engagementExportRow(
  record: EngagementExportRecord,
  types: ReadonlyMap<string, EngagementTypeLabel>,
): ExportRow {
  const type = types.get(record.engagement_type_id)
  return {
    ...record,
    engagement_type: type?.slug ?? '',
    engagement_type_label: type?.label ?? '',
  }
}

// --- activities -------------------------------------------------------------

export const ACTIVITY_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'engagement_id',
  'pipeline_card_id',
  'type',
  'direction',
  'source',
  'subject',
  'body',
  'occurred_at',
  'actor_id',
  'actor_label',
  'metadata',
  'dedupe_key',
  'is_pinned',
  'created_at',
] as const

const ACTIVITY_SELECT = 'id, contact_id, engagement_id, pipeline_card_id, type, direction, source, subject, body, occurred_at, actor_id, actor_label, metadata, dedupe_key, is_pinned, created_at'

export type ActivityExportRecord = Pick<
  ActivityRow,
  Exclude<(typeof ACTIVITY_EXPORT_COLUMNS)[number], 'metadata'>
> & { metadata: Json }

export function activityExportRow(record: ActivityExportRecord): ExportRow {
  return { ...record, metadata: json(record.metadata) }
}

// --- follow-ups -------------------------------------------------------------

export const FOLLOW_UP_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'engagement_id',
  'pipeline_card_id',
  'title',
  'details',
  'due_at',
  'remind_at',
  'priority',
  'status',
  'assigned_to',
  'created_by',
  'completed_at',
  'completed_by',
  'outcome_note',
  'created_at',
  'updated_at',
] as const

const FOLLOW_UP_SELECT = 'id, contact_id, engagement_id, pipeline_card_id, title, details, due_at, remind_at, priority, status, assigned_to, created_by, completed_at, completed_by, outcome_note, created_at, updated_at'

export type FollowUpExportRecord = Pick<FollowUpRow, (typeof FOLLOW_UP_EXPORT_COLUMNS)[number]>

export function followUpExportRow(record: FollowUpExportRecord): ExportRow {
  return { ...record }
}

// --- gifts ------------------------------------------------------------------

export const GIFT_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'amount_cents',
  'currency',
  'given_on',
  'method',
  'fund',
  'campaign',
  'is_recurring',
  'recurrence',
  'is_anonymous',
  'receipt_number',
  'notes',
  'external_source',
  'external_id',
  'created_at',
  'updated_at',
] as const

const GIFT_SELECT = 'id, contact_id, amount_cents, currency, given_on, method, fund, campaign, is_recurring, recurrence, is_anonymous, receipt_number, notes, external_source, external_id, created_at, updated_at'

export type GiftExportRecord = Pick<GiftRow, (typeof GIFT_EXPORT_COLUMNS)[number]>

/** Money leaves as integer cents, the way it is stored. Never as a float. */
export function giftExportRow(record: GiftExportRecord): ExportRow {
  return { ...record }
}

// --- pipeline cards ---------------------------------------------------------

export const PIPELINE_CARD_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'engagement_id',
  'pipeline_id',
  'pipeline',
  'stage_id',
  'stage',
  'title',
  'details',
  'organization_name',
  'next_step',
  'value_cents',
  'currency',
  'status',
  'owner_id',
  'expected_close_on',
  'closed_at',
  'close_reason',
  'position',
  'created_at',
  'updated_at',
] as const

const PIPELINE_CARD_SELECT = 'id, contact_id, engagement_id, pipeline_id, stage_id, title, details, organization_name, next_step, value_cents, currency, status, owner_id, expected_close_on, closed_at, close_reason, position, created_at, updated_at'

export type PipelineCardExportRecord = Pick<
  PipelineCardRow,
  | 'id'
  | 'contact_id'
  | 'engagement_id'
  | 'pipeline_id'
  | 'stage_id'
  | 'title'
  | 'details'
  | 'organization_name'
  | 'next_step'
  | 'value_cents'
  | 'currency'
  | 'status'
  | 'owner_id'
  | 'expected_close_on'
  | 'closed_at'
  | 'close_reason'
  | 'position'
  | 'created_at'
  | 'updated_at'
>

export function pipelineCardExportRow(
  record: PipelineCardExportRecord,
  pipelines: ReadonlyMap<string, string>,
  stages: ReadonlyMap<string, string>,
): ExportRow {
  return {
    ...record,
    pipeline: pipelines.get(record.pipeline_id) ?? '',
    stage: stages.get(record.stage_id) ?? '',
  }
}

// --- leads ------------------------------------------------------------------

export const LEAD_EXPORT_COLUMNS = [
  'id',
  'contact_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'organization_name',
  'message',
  'interest',
  'source',
  'form_key',
  'page_url',
  'utm',
  'status',
  'assigned_to',
  'converted_at',
  'converted_by',
  'created_at',
  'updated_at',
] as const

const LEAD_SELECT = 'id, contact_id, first_name, last_name, email, phone, organization_name, message, interest, source, form_key, page_url, utm, status, assigned_to, converted_at, converted_by, created_at, updated_at'

export type LeadExportRecord = Pick<
  LeadRow,
  Exclude<(typeof LEAD_EXPORT_COLUMNS)[number], 'utm'>
> & { utm: Json }

export function leadExportRow(record: LeadExportRecord): ExportRow {
  return { ...record, utm: json(record.utm) }
}

// --- datasets ---------------------------------------------------------------

/**
 * Dependency order: a dataset only ever references one listed before it, so
 * reading them in this order — or re-importing them in it — never asks for a
 * parent that does not exist yet.
 */
export const EXPORT_DATASETS: readonly ExportDataset[] = [
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Every person and organisation, excluding those in the deleted state.',
    columns: CONTACT_EXPORT_COLUMNS,
    references: [],
    requires: null,
    async countRows(db) {
      const { count, error } = await db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
      if (error) throw failed('contacts', error)
      return count ?? 0
    },
    async createReader(db) {
      return async (offset, limit) => {
        const { data, error } = await db
          .from('contacts')
          .select(CONTACT_SELECT)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('contacts', error)
        return (data ?? []).map(contactExportRow)
      }
    },
  },
  {
    key: 'engagements',
    label: 'Engagements',
    description: 'How each contact is involved — donor, volunteer, prayer partner and the rest.',
    columns: ENGAGEMENT_EXPORT_COLUMNS,
    references: ['contacts'],
    requires: null,
    async countRows(db) {
      const { count, error } = await db
        .from('engagements')
        .select('id', { count: 'exact', head: true })
      if (error) throw failed('engagements', error)
      return count ?? 0
    },
    async createReader(db) {
      // The type table is small and fixed; reading it once per export beats
      // an embed that would repeat the same eight rows on every page.
      const { data: types, error: typesError } = await db
        .from('engagement_types')
        .select('id, slug, label')
      if (typesError) throw failed('engagement types', typesError)
      const lookup = new Map<string, EngagementTypeLabel>(
        (types ?? []).map((type) => [type.id, { slug: type.slug, label: type.label }]),
      )

      return async (offset, limit) => {
        const { data, error } = await db
          .from('engagements')
          .select(ENGAGEMENT_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('engagements', error)
        return (data ?? []).map((record) => engagementExportRow(record, lookup))
      }
    },
  },
  {
    key: 'pipeline_cards',
    label: 'Pipeline cards',
    description: 'Work in progress on a pipeline, with its stage and value.',
    columns: PIPELINE_CARD_EXPORT_COLUMNS,
    references: ['contacts', 'engagements'],
    requires: null,
    async countRows(db) {
      const { count, error } = await db
        .from('pipeline_cards')
        .select('id', { count: 'exact', head: true })
      if (error) throw failed('pipeline cards', error)
      return count ?? 0
    },
    async createReader(db) {
      const [{ data: pipelines, error: pipelineError }, { data: stages, error: stageError }] =
        await Promise.all([
          db.from('pipelines').select('id, slug'),
          db.from('pipeline_stages').select('id, name'),
        ])
      if (pipelineError) throw failed('pipelines', pipelineError)
      if (stageError) throw failed('pipeline stages', stageError)

      const pipelineNames = new Map((pipelines ?? []).map((row) => [row.id, row.slug]))
      const stageNames = new Map((stages ?? []).map((row) => [row.id, row.name]))

      return async (offset, limit) => {
        const { data, error } = await db
          .from('pipeline_cards')
          .select(PIPELINE_CARD_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('pipeline cards', error)
        return (data ?? []).map((record) => pipelineCardExportRow(record, pipelineNames, stageNames))
      }
    },
  },
  {
    key: 'activities',
    label: 'Activities',
    description: 'The timeline: notes, calls, meetings and everything the database logs itself.',
    columns: ACTIVITY_EXPORT_COLUMNS,
    references: ['contacts', 'engagements', 'pipeline_cards'],
    requires: null,
    async countRows(db) {
      const { count, error } = await db.from('activities').select('id', { count: 'exact', head: true })
      if (error) throw failed('activities', error)
      return count ?? 0
    },
    async createReader(db) {
      return async (offset, limit) => {
        const { data, error } = await db
          .from('activities')
          .select(ACTIVITY_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('activities', error)
        return (data ?? []).map(activityExportRow)
      }
    },
  },
  {
    key: 'follow_ups',
    label: 'Follow-ups',
    description: 'Commitments to get back to someone, open and completed.',
    columns: FOLLOW_UP_EXPORT_COLUMNS,
    references: ['contacts', 'engagements', 'pipeline_cards'],
    requires: null,
    async countRows(db) {
      const { count, error } = await db.from('follow_ups').select('id', { count: 'exact', head: true })
      if (error) throw failed('follow-ups', error)
      return count ?? 0
    },
    async createReader(db) {
      return async (offset, limit) => {
        const { data, error } = await db
          .from('follow_ups')
          .select(FOLLOW_UP_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('follow-ups', error)
        return (data ?? []).map(followUpExportRow)
      }
    },
  },
  {
    key: 'gifts',
    label: 'Giving history',
    description: 'Every recorded gift, in integer cents. Visible only with giving access.',
    columns: GIFT_EXPORT_COLUMNS,
    references: ['contacts'],
    requires: 'giving',
    async countRows(db) {
      const { count, error } = await db.from('gifts').select('id', { count: 'exact', head: true })
      if (error) throw failed('gifts', error)
      return count ?? 0
    },
    async createReader(db) {
      return async (offset, limit) => {
        const { data, error } = await db
          .from('gifts')
          .select(GIFT_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('gifts', error)
        return (data ?? []).map(giftExportRow)
      }
    },
  },
  {
    key: 'leads',
    label: 'Leads',
    description: 'Enquiries from the public forms, including the contact each became.',
    columns: LEAD_EXPORT_COLUMNS,
    references: ['contacts'],
    requires: null,
    async countRows(db) {
      const { count, error } = await db.from('leads').select('id', { count: 'exact', head: true })
      if (error) throw failed('leads', error)
      return count ?? 0
    },
    async createReader(db) {
      return async (offset, limit) => {
        const { data, error } = await db
          .from('leads')
          .select(LEAD_SELECT)
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1)
        if (error) throw failed('leads', error)
        return (data ?? []).map(leadExportRow)
      }
    },
  },
]

export function findExportDataset(key: string): ExportDataset | null {
  return EXPORT_DATASETS.find((dataset) => dataset.key === key) ?? null
}
