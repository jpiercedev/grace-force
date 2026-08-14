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
  organization_name: string | null
  next_step: string | null
  value_cents: number | null
  currency: string
  status: PipelineCardStatus
  owner_id: string | null
  expected_close_on: string | null
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
  id, pipeline_id, stage_id, contact_id, title, details, organization_name, next_step,
  value_cents, currency, status, owner_id, expected_close_on, position, created_at,
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
      // Archived stages can hold no open cards (trigger-enforced), so hiding
      // them drops nothing from the board.
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

// --- Sales overview ----------------------------------------------------------

export interface OpportunityStageRef {
  id: string
  name: string
  color: string
  is_won: boolean
  is_lost: boolean
}

export interface OpportunityPipelineRef {
  id: string
  slug: string
  name: string
  tracks_value: boolean
}

export interface OpportunityListItem {
  id: string
  contact_id: string
  title: string
  organization_name: string | null
  next_step: string | null
  value_cents: number | null
  currency: string
  status: PipelineCardStatus
  owner_id: string | null
  expected_close_on: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  contact: ContactSummary | null
  owner: TeamProfile | null
  stage: OpportunityStageRef | null
  pipeline: OpportunityPipelineRef | null
}

export interface OpportunityFilters {
  /** Pipeline id. */
  pipeline?: string
  /** Stage id — only meaningful alongside its pipeline, but harmless without. */
  stage?: string
  /** Assigned team member id. */
  owner?: string
  /** Expected close horizon in days from today; 0 means already due. */
  closeWithin?: number
  /** Free text matched against title, organization and the person's name/email. */
  q?: string
  status?: PipelineCardStatus
}

export const OPPORTUNITY_LIST_LIMIT = 200

const OPPORTUNITY_SELECT = `
  id, contact_id, title, organization_name, next_step, value_cents, currency,
  status, owner_id, expected_close_on, closed_at, created_at, updated_at,
  contact:contacts!inner(
    id, full_name, preferred_name, first_name, last_name, organization_name, email
  ),
  owner:profiles!pipeline_cards_owner_id_fkey(id, full_name, email),
  stage:pipeline_stages(id, name, color, is_won, is_lost),
  pipeline:pipelines(id, slug, name, tracks_value)
`

/**
 * The cross-pipeline opportunity list behind /sales. Search cannot express
 * "title OR the joined contact's name" in one PostgREST disjunction, so
 * matching contacts are resolved to ids first and folded into the same or().
 */
export async function listOpportunities(
  filters: OpportunityFilters = {},
): Promise<OpportunityListItem[]> {
  const supabase = await createClient()

  let contactIds: string[] | null = null
  const cleaned = filters.q ? sanitizeSearchTerm(filters.q) : ''
  if (cleaned.length >= 2) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id')
      .is('deleted_at', null)
      .or(`full_name.ilike.%${cleaned}%,email.ilike.%${cleaned}%`)
      .limit(50)
    if (error) throw error
    contactIds = (data ?? []).map((row) => row.id)
  }

  let query = supabase
    .from('pipeline_cards')
    .select(OPPORTUNITY_SELECT)
    .eq('status', filters.status ?? 'open')
    .is('contact.deleted_at', null)

  if (filters.pipeline) query = query.eq('pipeline_id', filters.pipeline)
  if (filters.stage) query = query.eq('stage_id', filters.stage)
  if (filters.owner) query = query.eq('owner_id', filters.owner)
  if (typeof filters.closeWithin === 'number') {
    const horizon = new Date()
    horizon.setDate(horizon.getDate() + filters.closeWithin)
    query = query
      .not('expected_close_on', 'is', null)
      .lte('expected_close_on', horizon.toISOString().slice(0, 10))
  }
  if (cleaned.length >= 2) {
    const clauses = [`title.ilike.%${cleaned}%`, `organization_name.ilike.%${cleaned}%`]
    if (contactIds && contactIds.length > 0) {
      clauses.push(`contact_id.in.(${contactIds.join(',')})`)
    }
    query = query.or(clauses.join(','))
  }

  const { data, error } = await query
    .order('expected_close_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(OPPORTUNITY_LIST_LIMIT)
    .overrideTypes<OpportunityListItem[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

export interface SalesPipelineOption {
  id: string
  slug: string
  name: string
  tracks_value: boolean
  is_active: boolean
  stages: { id: string; name: string; position: number }[]
}

type SalesPipelineOptionRow = Omit<SalesPipelineOption, 'stages'> & {
  stages: { id: string; name: string; position: number; archived_at: string | null }[]
}

/** Active pipelines with their live stages, for filter rows and create forms. */
export async function listSalesPipelineOptions(): Promise<SalesPipelineOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipelines')
    .select('id, slug, name, tracks_value, is_active, stages:pipeline_stages(id, name, position, archived_at)')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .overrideTypes<SalesPipelineOptionRow[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map((pipeline) => ({
    id: pipeline.id,
    slug: pipeline.slug,
    name: pipeline.name,
    tracks_value: pipeline.tracks_value,
    is_active: pipeline.is_active,
    stages: (pipeline.stages ?? [])
      .filter((stage) => stage.archived_at === null)
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({ id: stage.id, name: stage.name, position: stage.position })),
  }))
}

export interface ContactOpportunity {
  id: string
  title: string
  organization_name: string | null
  next_step: string | null
  value_cents: number | null
  currency: string
  status: PipelineCardStatus
  expected_close_on: string | null
  closed_at: string | null
  owner: TeamProfile | null
  stage: OpportunityStageRef | null
  pipeline: OpportunityPipelineRef | null
}

const CONTACT_OPPORTUNITY_SELECT = `
  id, title, organization_name, next_step, value_cents, currency, status,
  expected_close_on, closed_at,
  owner:profiles!pipeline_cards_owner_id_fkey(id, full_name, email),
  stage:pipeline_stages(id, name, color, is_won, is_lost),
  pipeline:pipelines(id, slug, name, tracks_value)
`

/** A person's open opportunities, plus their most recently settled few. */
export async function getContactOpportunities(contactId: string): Promise<{
  open: ContactOpportunity[]
  settled: ContactOpportunity[]
}> {
  const supabase = await createClient()
  const [openResult, settledResult] = await Promise.all([
    supabase
      .from('pipeline_cards')
      .select(CONTACT_OPPORTUNITY_SELECT)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .overrideTypes<ContactOpportunity[], { merge: false }>(),
    supabase
      .from('pipeline_cards')
      .select(CONTACT_OPPORTUNITY_SELECT)
      .eq('contact_id', contactId)
      .neq('status', 'open')
      .order('closed_at', { ascending: false })
      .limit(3)
      .overrideTypes<ContactOpportunity[], { merge: false }>(),
  ])

  if (openResult.error) throw openResult.error
  if (settledResult.error) throw settledResult.error
  return { open: openResult.data ?? [], settled: settledResult.data ?? [] }
}

// --- Pipeline management -----------------------------------------------------

export interface ManagedStage extends StageRow {
  open_count: number
  total_count: number
}

export interface ManagedPipeline {
  id: string
  slug: string
  name: string
  description: string | null
  tracks_value: boolean
  is_default: boolean
  is_active: boolean
  sort_order: number
  stages: ManagedStage[]
  open_count: number
  total_count: number
}

/**
 * Every pipeline — archived included — with per-stage card counts, so the
 * editor can say which stages and pipelines can be archived or deleted.
 * Counting scans all cards' (pipeline_id, stage_id) pairs; card volume is
 * bounded by the team's working set, like the board aggregation above.
 */
export async function listPipelinesForManage(): Promise<ManagedPipeline[]> {
  const supabase = await createClient()
  const [pipelinesResult, stagesResult, cardsResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, name, description, tracks_value, is_default, is_active, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase.from('pipeline_stages').select(STAGE_FIELDS).order('position', { ascending: true }),
    supabase.from('pipeline_cards').select('pipeline_id, stage_id, status'),
  ])

  if (pipelinesResult.error) throw pipelinesResult.error
  if (stagesResult.error) throw stagesResult.error
  if (cardsResult.error) throw cardsResult.error

  const openByStage = new Map<string, number>()
  const totalByStage = new Map<string, number>()
  const openByPipeline = new Map<string, number>()
  const totalByPipeline = new Map<string, number>()
  for (const card of cardsResult.data ?? []) {
    totalByStage.set(card.stage_id, (totalByStage.get(card.stage_id) ?? 0) + 1)
    totalByPipeline.set(card.pipeline_id, (totalByPipeline.get(card.pipeline_id) ?? 0) + 1)
    if (card.status === 'open') {
      openByStage.set(card.stage_id, (openByStage.get(card.stage_id) ?? 0) + 1)
      openByPipeline.set(card.pipeline_id, (openByPipeline.get(card.pipeline_id) ?? 0) + 1)
    }
  }

  return (pipelinesResult.data ?? []).map((pipeline) => ({
    ...pipeline,
    stages: (stagesResult.data ?? [])
      .filter((stage) => stage.pipeline_id === pipeline.id)
      .map((stage) => ({
        ...stage,
        open_count: openByStage.get(stage.id) ?? 0,
        total_count: totalByStage.get(stage.id) ?? 0,
      })),
    open_count: openByPipeline.get(pipeline.id) ?? 0,
    total_count: totalByPipeline.get(pipeline.id) ?? 0,
  }))
}

export async function getPipelineForManage(slug: string): Promise<ManagedPipeline | null> {
  const pipelines = await listPipelinesForManage()
  return pipelines.find((pipeline) => pipeline.slug === slug) ?? null
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
