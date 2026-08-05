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

const STAGE_FIELDS = 'id, pipeline_id, slug, name, description, position, is_won, is_lost, color'

type StageRow = Pick<
  PipelineStageRow,
  'id' | 'pipeline_id' | 'slug' | 'name' | 'description' | 'position' | 'is_won' | 'is_lost' | 'color'
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
      supabase.from('pipeline_stages').select(STAGE_FIELDS).order('position', { ascending: true }),
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
  status, owner_id, expected_close_on, position, created_at,
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
