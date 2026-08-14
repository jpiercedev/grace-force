import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  sanitizeSearchTerm,
  type ContactSummary,
  type TeamProfile,
} from '@/lib/queries/follow-ups'
import type { PipelineCardStatus, PipelineRow, PipelineStageRow } from '@/types/database'

/** Card owners come from the same team list as follow-up assignees. */
export { listAssignableProfiles } from '@/lib/queries/follow-ups'
export type { ContactSummary, TeamProfile } from '@/lib/queries/follow-ups'

/**
 * Reads for the pipeline index and boards.
 *
 * Stage counts and value totals are aggregated in TypeScript rather than SQL:
 * a board is bounded by how much work a team can hold in flight, so one pass
 * over the open cards is cheaper than a round trip per stage.
 */

export type PipelineSummaryStage = Pick<
  PipelineStageRow,
  'id' | 'slug' | 'name' | 'position' | 'is_won' | 'is_lost' | 'color'
> & { open_count: number }

export interface PipelineSummary {
  id: string
  slug: string
  name: string
  description: string | null
  tracks_value: boolean
  is_default: boolean
  stages: PipelineSummaryStage[]
  open_count: number
  /** Null for pipelines that do not track value, so the UI can omit the column. */
  open_value_cents: number | null
}

const STAGE_FIELDS =
  'id, pipeline_id, slug, name, description, position, is_won, is_lost, color, archived_at'

type StageRow = Pick<
  PipelineStageRow,
  | 'id'
  | 'pipeline_id'
  | 'slug'
  | 'name'
  | 'description'
  | 'position'
  | 'is_won'
  | 'is_lost'
  | 'color'
  | 'archived_at'
>

type OpenCardTotals = { pipeline_id: string; stage_id: string; value_cents: number | null }

/**
 * Open cards belonging to contacts that still exist. `contacts!inner` plus the
 * `deleted_at` filter keeps soft-deleted people out of every total.
 */
async function listOpenCardTotals(pipelineIds: string[]): Promise<OpenCardTotals[]> {
  if (pipelineIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipeline_cards')
    .select('pipeline_id, stage_id, value_cents, contact:contacts!inner(id)')
    .in('pipeline_id', pipelineIds)
    .eq('status', 'open')
    .is('contact.deleted_at', null)
    .overrideTypes<OpenCardTotals[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

export async function listPipelineSummaries(): Promise<PipelineSummary[]> {
  const supabase = await createClient()

  const [{ data: pipelines, error: pipelineError }, { data: stages, error: stageError }] =
    await Promise.all([
      supabase
        .from('pipelines')
        .select('id, slug, name, description, tracks_value, is_default, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('pipeline_stages')
        .select(STAGE_FIELDS)
        .is('archived_at', null)
        .order('position', { ascending: true }),
    ])

  if (pipelineError) throw pipelineError
  if (stageError) throw stageError

  const pipelineRows = pipelines ?? []
  const cards = await listOpenCardTotals(pipelineRows.map((pipeline) => pipeline.id))

  const countsByStage = new Map<string, number>()
  const openByPipeline = new Map<string, { count: number; value: number }>()
  for (const card of cards) {
    countsByStage.set(card.stage_id, (countsByStage.get(card.stage_id) ?? 0) + 1)
    const totals = openByPipeline.get(card.pipeline_id) ?? { count: 0, value: 0 }
    totals.count += 1
    totals.value += card.value_cents ?? 0
    openByPipeline.set(card.pipeline_id, totals)
  }

  return pipelineRows.map((pipeline) => {
    const totals = openByPipeline.get(pipeline.id)
    return {
      id: pipeline.id,
      slug: pipeline.slug,
      name: pipeline.name,
      description: pipeline.description,
      tracks_value: pipeline.tracks_value,
      is_default: pipeline.is_default,
      stages: (stages ?? [])
        .filter((stage) => stage.pipeline_id === pipeline.id)
        .map((stage) => ({
          id: stage.id,
          slug: stage.slug,
          name: stage.name,
          position: stage.position,
          is_won: stage.is_won,
          is_lost: stage.is_lost,
          color: stage.color,
          open_count: countsByStage.get(stage.id) ?? 0,
        })),
      open_count: totals?.count ?? 0,
      open_value_cents: pipeline.tracks_value ? (totals?.value ?? 0) : null,
    }
  })
}

export type PipelineHeader = Pick<
  PipelineRow,
  'id' | 'slug' | 'name' | 'description' | 'tracks_value' | 'is_active'
>

export async function getPipelineBySlug(slug: string): Promise<PipelineHeader | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipelines')
    .select('id, slug, name, description, tracks_value, is_active')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return data
}

export interface BoardCard {
  id: string
  pipeline_id: string
  stage_id: string
  contact_id: string
  title: string
  details: string | null
  value_cents: number | null
  currency: string
  status: PipelineCardStatus
  owner_id: string | null
  expected_close_on: string | null
  organization_name: string | null
  next_step: string | null
  position: number
  created_at: string
  contact: ContactSummary | null
  owner: TeamProfile | null
}

export interface BoardStage extends StageRow {
  cards: BoardCard[]
}

export interface PipelineBoard {
  pipeline: PipelineHeader
  stages: BoardStage[]
  open_count: number
  open_value_cents: number | null
  won_count: number
  lost_count: number
}

// `profiles` is referenced twice from pipeline_cards (owner_id, created_by), so
// the embed names the constraint it means.
const BOARD_CARD_SELECT = `
  id, pipeline_id, stage_id, contact_id, title, details, value_cents, currency,
  status, owner_id, expected_close_on, organization_name, next_step, position, created_at,
  contact:contacts!inner(
    id, full_name, preferred_name, first_name, last_name, organization_name, email
  ),
  owner:profiles!pipeline_cards_owner_id_fkey(id, full_name, email)
`

export async function getPipelineBoard(slug: string): Promise<PipelineBoard | null> {
  const supabase = await createClient()

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .select('id, slug, name, description, tracks_value, is_active')
    .eq('slug', slug)
    .maybeSingle()

  if (pipelineError) throw pipelineError
  if (!pipeline) return null

  const [stagesResult, cardsResult, wonResult, lostResult] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select(STAGE_FIELDS)
      .eq('pipeline_id', pipeline.id)
      .is('archived_at', null)
      .order('position', { ascending: true }),
    supabase
      .from('pipeline_cards')
      .select(BOARD_CARD_SELECT)
      .eq('pipeline_id', pipeline.id)
      .eq('status', 'open')
      .is('contact.deleted_at', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .overrideTypes<BoardCard[], { merge: false }>(),
    supabase
      .from('pipeline_cards')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_id', pipeline.id)
      .eq('status', 'won'),
    supabase
      .from('pipeline_cards')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_id', pipeline.id)
      .eq('status', 'lost'),
  ])

  if (stagesResult.error) throw stagesResult.error
  if (cardsResult.error) throw cardsResult.error
  if (wonResult.error) throw wonResult.error
  if (lostResult.error) throw lostResult.error

  const cards = cardsResult.data ?? []
  const openValue = cards.reduce((total, card) => total + (card.value_cents ?? 0), 0)

  return {
    pipeline,
    stages: (stagesResult.data ?? []).map((stage) => ({
      ...stage,
      cards: cards.filter((card) => card.stage_id === stage.id),
    })),
    open_count: cards.length,
    open_value_cents: pipeline.tracks_value ? openValue : null,
    won_count: wonResult.count ?? 0,
    lost_count: lostResult.count ?? 0,
  }
}

export interface PipelineContactOption extends ContactSummary {
  /** A unique index allows only one open card per (pipeline, contact). */
  has_open_card: boolean
}

export async function searchContactsForPipeline(
  pipelineId: string,
  term: string,
  limit = 10,
): Promise<PipelineContactOption[]> {
  const cleaned = sanitizeSearchTerm(term)
  if (cleaned.length < 2) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, preferred_name, first_name, last_name, organization_name, email')
    .is('deleted_at', null)
    .or(`full_name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,organization_name.ilike.%${cleaned}%`)
    .order('full_name', { ascending: true })
    .limit(limit)

  if (error) throw error
  const contacts = data ?? []
  if (contacts.length === 0) return []

  const { data: openCards, error: cardError } = await supabase
    .from('pipeline_cards')
    .select('contact_id')
    .eq('pipeline_id', pipelineId)
    .eq('status', 'open')
    .in(
      'contact_id',
      contacts.map((contact) => contact.id),
    )

  if (cardError) throw cardError
  const taken = new Set((openCards ?? []).map((card) => card.contact_id))

  return contacts.map((contact) => ({ ...contact, has_open_card: taken.has(contact.id) }))
}

/* ------------------------------------------------------------------------- */
/* Sales                                                                     */
/* ------------------------------------------------------------------------- */

/** One opportunity row for the Sales list — the card plus everything a table
 *  column needs, so the page renders from a single query. */
export interface OpportunityListItem extends BoardCard {
  closed_at: string | null
  close_reason: string | null
  updated_at: string
  pipeline: { id: string; slug: string; name: string; tracks_value: boolean } | null
  stage: { id: string; name: string; color: string; is_won: boolean; is_lost: boolean } | null
  creator: TeamProfile | null
}

const OPPORTUNITY_SELECT = `
  id, pipeline_id, stage_id, contact_id, title, details, value_cents, currency,
  status, owner_id, expected_close_on, organization_name, next_step, position,
  created_at, closed_at, close_reason, updated_at,
  pipeline:pipelines!inner(id, slug, name, tracks_value),
  stage:pipeline_stages!pipeline_cards_stage_id_pipeline_id_fkey(id, name, color, is_won, is_lost),
  contact:contacts!inner(
    id, full_name, preferred_name, first_name, last_name, organization_name, email
  ),
  owner:profiles!pipeline_cards_owner_id_fkey(id, full_name, email),
  creator:profiles!pipeline_cards_created_by_fkey(id, full_name, email)
`

export interface OpportunityFilters {
  pipelineId?: string
  stageId?: string
  /** A profile id, or the literal 'unassigned'. */
  ownerId?: string
  status?: PipelineCardStatus | 'all'
  /** Expected-close window, days from now; 0 means "already overdue". */
  closeWithinDays?: number
  /** Matches title, organization, or the person's name/email. */
  q?: string
}

export const OPPORTUNITY_LIST_LIMIT = 100

/**
 * The filterable opportunity list behind /sales/opportunities.
 *
 * The person-name half of `q` cannot ride the same OR as the card columns —
 * PostgREST's or= filter only sees the parent row — so matching contacts are
 * resolved first and their ids joined into the OR.
 */
export async function listOpportunities(
  filters: OpportunityFilters,
  now = new Date(),
): Promise<OpportunityListItem[]> {
  const supabase = await createClient()

  let contactIds: string[] | null = null
  const cleaned = filters.q ? sanitizeSearchTerm(filters.q) : ''
  if (cleaned.length >= 2) {
    const { data: matches, error } = await supabase
      .from('contacts')
      .select('id')
      .is('deleted_at', null)
      .or(`full_name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,organization_name.ilike.%${cleaned}%`)
      .limit(200)
    if (error) throw error
    contactIds = (matches ?? []).map((row) => row.id)
  }

  let query = supabase
    .from('pipeline_cards')
    .select(OPPORTUNITY_SELECT)
    .is('contact.deleted_at', null)
    .limit(OPPORTUNITY_LIST_LIMIT)

  const status = filters.status ?? 'open'
  if (status !== 'all') query = query.eq('status', status)
  if (filters.pipelineId) query = query.eq('pipeline_id', filters.pipelineId)
  if (filters.stageId) query = query.eq('stage_id', filters.stageId)
  if (filters.ownerId === 'unassigned') query = query.is('owner_id', null)
  else if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)

  if (filters.closeWithinDays !== undefined) {
    const today = now.toISOString().slice(0, 10)
    if (filters.closeWithinDays === 0) {
      query = query.lt('expected_close_on', today)
    } else {
      const until = new Date(now.getTime() + filters.closeWithinDays * 86_400_000)
      query = query
        .gte('expected_close_on', today)
        .lte('expected_close_on', until.toISOString().slice(0, 10))
    }
  }

  if (cleaned.length >= 2) {
    const parts = [`title.ilike.%${cleaned}%`, `organization_name.ilike.%${cleaned}%`]
    if (contactIds && contactIds.length > 0) {
      parts.push(`contact_id.in.(${contactIds.join(',')})`)
    }
    query = query.or(parts.join(','))
  }

  // Open work sorts by the nearest expected close; closed work by recency.
  query =
    status === 'open'
      ? query
          .order('expected_close_on', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
      : query.order('closed_at', { ascending: false, nullsFirst: false })

  const { data, error } = await query.overrideTypes<OpportunityListItem[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

/** The figures band and closing-soon list on the Sales overview. */
export interface SalesOverview {
  open_count: number
  open_value_cents: number
  closing_soon: OpportunityListItem[]
  won_this_quarter: number
}

export async function getSalesOverview(now = new Date()): Promise<SalesOverview> {
  const supabase = await createClient()
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)

  const [openResult, closingSoon, wonResult] = await Promise.all([
    supabase
      .from('pipeline_cards')
      .select('value_cents, pipeline:pipelines!inner(tracks_value), contact:contacts!inner(id)')
      .eq('status', 'open')
      .is('contact.deleted_at', null)
      .overrideTypes<
        { value_cents: number | null; pipeline: { tracks_value: boolean } | null }[],
        { merge: false }
      >(),
    listOpportunities({ status: 'open', closeWithinDays: 30 }, now),
    supabase
      .from('pipeline_cards')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'won')
      .gte('closed_at', quarterStart.toISOString()),
  ])

  if (openResult.error) throw openResult.error
  if (wonResult.error) throw wonResult.error

  const open = openResult.data ?? []
  return {
    open_count: open.length,
    open_value_cents: open.reduce(
      (total, card) => total + (card.pipeline?.tracks_value ? (card.value_cents ?? 0) : 0),
      0,
    ),
    closing_soon: closingSoon.slice(0, 6),
    won_this_quarter: wonResult.count ?? 0,
  }
}

/** A person's opportunities, open first, for the record's Sales section. */
export async function getContactOpportunities(contactId: string): Promise<OpportunityListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipeline_cards')
    .select(OPPORTUNITY_SELECT)
    .eq('contact_id', contactId)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .overrideTypes<OpportunityListItem[], { merge: false }>()

  if (error) throw error
  // Postgres enum order is declaration order (open < won < lost < archived),
  // which happens to be exactly the display order wanted here.
  return data ?? []
}

/** One opportunity with its joins, for the detail/edit page. */
export async function getOpportunity(id: string): Promise<OpportunityListItem | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipeline_cards')
    .select(OPPORTUNITY_SELECT)
    .eq('id', id)
    .maybeSingle()
    .overrideTypes<OpportunityListItem, { merge: false }>()

  if (error) throw error
  return data
}

/* ------------------------------------------------------------------------- */
/* Pipeline management                                                       */
/* ------------------------------------------------------------------------- */

export interface ManagedPipeline {
  id: string
  slug: string
  name: string
  description: string | null
  tracks_value: boolean
  is_default: boolean
  is_active: boolean
  sort_order: number
  stage_count: number
  open_count: number
  /** Any card at all — the delete guard triggers on these, not just open ones. */
  card_count: number
}

/** Every pipeline, live and archived alike, with the counts the editor needs. */
export async function listPipelinesForManage(): Promise<ManagedPipeline[]> {
  const supabase = await createClient()

  const [pipelinesResult, stagesResult, cardsResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, name, description, tracks_value, is_default, is_active, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase.from('pipeline_stages').select('id, pipeline_id').is('archived_at', null),
    supabase.from('pipeline_cards').select('id, pipeline_id, status'),
  ])

  if (pipelinesResult.error) throw pipelinesResult.error
  if (stagesResult.error) throw stagesResult.error
  if (cardsResult.error) throw cardsResult.error

  const stageCounts = new Map<string, number>()
  for (const stage of stagesResult.data ?? []) {
    stageCounts.set(stage.pipeline_id, (stageCounts.get(stage.pipeline_id) ?? 0) + 1)
  }
  const cardCounts = new Map<string, { open: number; total: number }>()
  for (const card of cardsResult.data ?? []) {
    const counts = cardCounts.get(card.pipeline_id) ?? { open: 0, total: 0 }
    counts.total += 1
    if (card.status === 'open') counts.open += 1
    cardCounts.set(card.pipeline_id, counts)
  }

  return (pipelinesResult.data ?? []).map((pipeline) => ({
    ...pipeline,
    stage_count: stageCounts.get(pipeline.id) ?? 0,
    open_count: cardCounts.get(pipeline.id)?.open ?? 0,
    card_count: cardCounts.get(pipeline.id)?.total ?? 0,
  }))
}

export interface ManagedStage extends StageRow {
  open_count: number
  card_count: number
}

export interface PipelineForManage {
  id: string
  slug: string
  name: string
  description: string | null
  tracks_value: boolean
  is_default: boolean
  is_active: boolean
  stages: ManagedStage[]
  archived_stages: ManagedStage[]
  card_count: number
}

export async function getPipelineForManage(slug: string): Promise<PipelineForManage | null> {
  const supabase = await createClient()

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .select('id, slug, name, description, tracks_value, is_default, is_active')
    .eq('slug', slug)
    .maybeSingle()

  if (pipelineError) throw pipelineError
  if (!pipeline) return null

  const [stagesResult, cardsResult] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select(STAGE_FIELDS)
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true }),
    supabase.from('pipeline_cards').select('id, stage_id, status').eq('pipeline_id', pipeline.id),
  ])

  if (stagesResult.error) throw stagesResult.error
  if (cardsResult.error) throw cardsResult.error

  const cards = cardsResult.data ?? []
  const counts = new Map<string, { open: number; total: number }>()
  for (const card of cards) {
    const entry = counts.get(card.stage_id) ?? { open: 0, total: 0 }
    entry.total += 1
    if (card.status === 'open') entry.open += 1
    counts.set(card.stage_id, entry)
  }

  const withCounts = (stagesResult.data ?? []).map((stage) => ({
    ...stage,
    open_count: counts.get(stage.id)?.open ?? 0,
    card_count: counts.get(stage.id)?.total ?? 0,
  }))

  return {
    ...pipeline,
    stages: withCounts.filter((stage) => stage.archived_at === null),
    archived_stages: withCounts.filter((stage) => stage.archived_at !== null),
    card_count: cards.length,
  }
}

/** Active pipelines with their live stages — pickers on the create forms. */
export interface PipelineOption {
  id: string
  slug: string
  name: string
  tracks_value: boolean
  has_stages: boolean
}

export async function listPipelineOptions(): Promise<PipelineOption[]> {
  const supabase = await createClient()
  const [pipelinesResult, stagesResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, name, tracks_value')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase.from('pipeline_stages').select('pipeline_id').is('archived_at', null),
  ])

  if (pipelinesResult.error) throw pipelinesResult.error
  if (stagesResult.error) throw stagesResult.error

  const withStages = new Set((stagesResult.data ?? []).map((stage) => stage.pipeline_id))
  return (pipelinesResult.data ?? []).map((pipeline) => ({
    ...pipeline,
    has_stages: withStages.has(pipeline.id),
  }))
}
