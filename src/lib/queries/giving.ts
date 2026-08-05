import 'server-only'

import { format, isValid, parseISO, startOfMonth, startOfYear, subDays } from 'date-fns'
import {
  CONTACT_REF_FIELDS,
  toContactRef,
  type ContactRef,
  type ContactRefRow,
} from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/server'
import type { GiftMethod } from '@/types/database'

/**
 * Reads for giving context.
 *
 * `gifts` is readable only to profiles that pass `can_view_giving()`, so a
 * viewer without the capability reads nothing here rather than being refused.
 * Callers still check the capability first, so the page is absent rather than
 * empty-and-broken.
 *
 * Totals are summed in TypeScript over a bounded scan rather than pushed into
 * SQL aggregates: PostgREST aggregate functions are a server setting this app
 * cannot assume, and a scan of one ministry-year of giving is small. The scan
 * is capped, and `truncated` says so honestly instead of quietly reporting a
 * short total.
 *
 * Amounts are integer cents and are summed across whatever currencies are
 * present — the same assumption `contact_giving_summary` makes in the database.
 */

export const GIFT_SCAN_LIMIT = 5000
export const DONOR_SCAN_LIMIT = 5000
export const RECENT_GIFT_LIMIT = 25
export const BREAKDOWN_LIMIT = 5
export const TOP_GIVER_LIMIT = 10
export const SNAPSHOT_GIFT_LIMIT = 5

/** Gifts with no designation still belong in the fund breakdown; they are undesignated giving. */
export const UNDESIGNATED_LABEL = 'Undesignated'

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

// --- Dates ------------------------------------------------------------------

/** `given_on` is a DATE column, so every bound is a plain `yyyy-MM-dd` string. */
export function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseDateParam(value: string | null | undefined): string | null {
  if (!value || !DATE_PATTERN.test(value)) return null
  return isValid(parseISO(value)) ? value : null
}

export interface GivingFilters {
  from: string | null
  to: string | null
  fund: string | null
}

export interface GivingRange {
  from: string
  to: string
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function parseGivingFilters(
  params: Record<string, string | string[] | undefined>,
): GivingFilters {
  return {
    from: parseDateParam(first(params.from)),
    to: parseDateParam(first(params.to)),
    fund: first(params.fund),
  }
}

export function hasGivingFilters(filters: GivingFilters): boolean {
  return Boolean(filters.from || filters.to || filters.fund)
}

/** Matches the 365-day window `contact_giving_summary.trailing_12mo_cents` uses. */
export function trailingWindowStart(now: Date): string {
  return toDateParam(subDays(now, 365))
}

/** Defaults to the trailing twelve months, and quietly rights a reversed range. */
export function resolveGivingRange(filters: GivingFilters, now: Date = new Date()): GivingRange {
  const from = filters.from ?? trailingWindowStart(now)
  const to = filters.to ?? toDateParam(now)
  return from <= to ? { from, to } : { from: to, to: from }
}

// --- Shapes -----------------------------------------------------------------

export interface GivingGift {
  id: string
  amount_cents: number
  currency: string
  given_on: string
  method: GiftMethod
  fund: string | null
  campaign: string | null
  is_recurring: boolean
  is_anonymous: boolean
  contact: ContactRef | null
}

export interface GivingBreakdownItem {
  label: string
  total_cents: number
  gift_count: number
}

export interface GivingTotals {
  monthToDateCents: number
  yearToDateCents: number
  trailing12moCents: number
}

export interface GivingRangeSummary extends GivingRange {
  totalCents: number
  giftCount: number
  averageCents: number
}

export interface TopGiver {
  contact: ContactRef
  trailing12moCents: number
  totalCents: number
  giftCount: number
  lastGiftOn: string | null
}

export interface GivingOverview {
  range: GivingRangeSummary
  totals: GivingTotals
  topFunds: GivingBreakdownItem[]
  topCampaigns: GivingBreakdownItem[]
  recent: GivingGift[]
  topGivers: TopGiver[]
  /** Fund names offered by the filter, drawn from the scanned window. */
  funds: string[]
  /** True when a scan hit its ceiling, so the totals cover the most recent gifts only. */
  truncated: boolean
}

export interface GivingSnapshot {
  monthToDateCents: number
  yearToDateCents: number
  recent: GivingGift[]
}

interface GiftRowShape {
  id: string
  amount_cents: number
  currency: string
  given_on: string
  method: GiftMethod
  fund: string | null
  campaign: string | null
  is_recurring: boolean
  is_anonymous: boolean
  contact: ContactRefRow | null
}

const GIFT_SELECT = `
  id, amount_cents, currency, given_on, method, fund, campaign,
  is_recurring, is_anonymous,
  contact:contacts!inner(${CONTACT_REF_FIELDS})
`

function toGift(row: GiftRowShape): GivingGift {
  return {
    id: row.id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    given_on: row.given_on,
    method: row.method,
    fund: row.fund,
    campaign: row.campaign,
    is_recurring: row.is_recurring,
    is_anonymous: row.is_anonymous,
    contact: toContactRef(row.contact),
  }
}

// --- Scans ------------------------------------------------------------------

/**
 * Gifts in a date window, newest first.
 *
 * Soft-deleted contacts are excluded so these totals agree with every other
 * screen; a person removed from the CRM should not still be reported on.
 */
async function scanGifts(
  range: GivingRange,
  fund: string | null,
  limit: number = GIFT_SCAN_LIMIT,
): Promise<{ gifts: GivingGift[]; truncated: boolean }> {
  const supabase = await createClient()
  let query = supabase
    .from('gifts')
    .select(GIFT_SELECT, { count: 'exact' })
    .gte('given_on', range.from)
    .lte('given_on', range.to)
    .is('contact.deleted_at', null)

  if (fund) query = query.eq('fund', fund)

  const { data, error, count } = await query
    .order('given_on', { ascending: false })
    // Stable tiebreaker: a whole batch of gifts shares one `given_on` date.
    .order('id', { ascending: true })
    .range(0, limit - 1)
    .overrideTypes<GiftRowShape[], { merge: false }>()

  if (error) fail('giving history', error)

  const rows = data ?? []
  return { gifts: rows.map(toGift), truncated: (count ?? rows.length) > rows.length }
}

async function listFundNames(range: GivingRange): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('gifts')
    .select('fund')
    .gte('given_on', range.from)
    .lte('given_on', range.to)
    .not('fund', 'is', null)
    .limit(GIFT_SCAN_LIMIT)

  if (error) fail('fund names', error)

  const names = new Set<string>()
  for (const row of data ?? []) {
    const fund = row.fund?.trim()
    if (fund) names.add(fund)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * Biggest supporters over the trailing twelve months.
 *
 * The rollup view holds no contact columns, so names are resolved in a second
 * query rather than through an embed — a view's relationships are not something
 * to rely on.
 */
export async function listTopGivers(limit: number = TOP_GIVER_LIMIT): Promise<TopGiver[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_giving_summary')
    .select('contact_id, gift_count, total_cents, trailing_12mo_cents, last_gift_on')
    .gt('trailing_12mo_cents', 0)
    .order('trailing_12mo_cents', { ascending: false })
    .limit(limit)

  if (error) fail('top givers', error)

  const summaries = data ?? []
  if (summaries.length === 0) return []

  const { data: contacts, error: contactError } = await supabase
    .from('contacts')
    .select(CONTACT_REF_FIELDS)
    .in(
      'id',
      summaries.map((row) => row.contact_id),
    )
    .is('deleted_at', null)

  if (contactError) fail('top givers', contactError)

  const byId = new Map((contacts ?? []).map((row) => [row.id, row]))

  return summaries.flatMap((summary) => {
    const contact = toContactRef(byId.get(summary.contact_id) ?? null)
    // A soft-deleted contact drops out rather than appearing as an unlinkable row.
    if (!contact) return []
    return [
      {
        contact,
        trailing12moCents: summary.trailing_12mo_cents,
        totalCents: summary.total_cents,
        giftCount: summary.gift_count,
        lastGiftOn: summary.last_gift_on,
      },
    ]
  })
}

// --- Aggregation ------------------------------------------------------------

function sumWithin(gifts: GivingGift[], from: string, to: string): number {
  return gifts.reduce(
    (total, gift) =>
      gift.given_on >= from && gift.given_on <= to ? total + gift.amount_cents : total,
    0,
  )
}

/**
 * Groups gifts by a label column. Fund-less gifts are undesignated giving and
 * belong in that breakdown; campaign-less gifts are simply not part of a
 * campaign, so they are left out of it.
 */
function breakdown(
  gifts: GivingGift[],
  key: 'fund' | 'campaign',
  limit: number = BREAKDOWN_LIMIT,
): GivingBreakdownItem[] {
  const totals = new Map<string, GivingBreakdownItem>()

  for (const gift of gifts) {
    const raw = gift[key]?.trim()
    if (!raw && key === 'campaign') continue
    const label = raw || UNDESIGNATED_LABEL
    const entry = totals.get(label) ?? { label, total_cents: 0, gift_count: 0 }
    entry.total_cents += gift.amount_cents
    entry.gift_count += 1
    totals.set(label, entry)
  }

  return [...totals.values()]
    .sort((a, b) => b.total_cents - a.total_cents || a.label.localeCompare(b.label))
    .slice(0, limit)
}

// --- Page reads -------------------------------------------------------------

export async function getGivingOverview(
  filters: GivingFilters,
  now: Date = new Date(),
): Promise<GivingOverview> {
  const range = resolveGivingRange(filters, now)
  const today = toDateParam(now)
  const trailingStart = trailingWindowStart(now)
  const trailingRange: GivingRange = { from: trailingStart, to: today }

  // The headline windows are fixed, so they need their own scan unless the
  // selected range already contains them.
  const rangeCoversTrailing = range.from <= trailingStart && range.to >= today

  const [rangeScan, trailingScan, funds, topGivers] = await Promise.all([
    scanGifts(range, filters.fund),
    rangeCoversTrailing ? null : scanGifts(trailingRange, filters.fund),
    listFundNames({
      from: range.from < trailingStart ? range.from : trailingStart,
      to: range.to > today ? range.to : today,
    }),
    listTopGivers(),
  ])

  const trailingGifts = trailingScan ? trailingScan.gifts : rangeScan.gifts
  const totalCents = rangeScan.gifts.reduce((total, gift) => total + gift.amount_cents, 0)
  const giftCount = rangeScan.gifts.length

  // A filtered-to fund that has no gifts in the scanned window would otherwise
  // vanish from the select and silently reset the filter on the next submit.
  const fundOptions =
    filters.fund && !funds.includes(filters.fund) ? [...funds, filters.fund].sort() : funds

  return {
    range: {
      ...range,
      totalCents,
      giftCount,
      averageCents: giftCount === 0 ? 0 : Math.round(totalCents / giftCount),
    },
    totals: {
      monthToDateCents: sumWithin(trailingGifts, toDateParam(startOfMonth(now)), today),
      yearToDateCents: sumWithin(trailingGifts, toDateParam(startOfYear(now)), today),
      trailing12moCents: sumWithin(trailingGifts, trailingStart, today),
    },
    topFunds: breakdown(rangeScan.gifts, 'fund'),
    topCampaigns: breakdown(rangeScan.gifts, 'campaign'),
    recent: rangeScan.gifts.slice(0, RECENT_GIFT_LIMIT),
    topGivers,
    funds: fundOptions,
    truncated: rangeScan.truncated || (trailingScan?.truncated ?? false),
  }
}

/**
 * The dashboard's giving strip.
 *
 * Year-to-date is summed from the per-contact rollup rather than from the gifts
 * themselves: one row per donor is a fraction of a year of gifts, and the
 * dashboard should not pay for an analytics scan it does not display.
 */
export async function getGivingSnapshot(now: Date = new Date()): Promise<GivingSnapshot> {
  const supabase = await createClient()
  const today = toDateParam(now)

  const [monthScan, ytd, recent] = await Promise.all([
    scanGifts({ from: toDateParam(startOfMonth(now)), to: today }, null),
    supabase
      .from('contact_giving_summary')
      .select('ytd_cents')
      .gt('ytd_cents', 0)
      .limit(DONOR_SCAN_LIMIT),
    supabase
      .from('gifts')
      .select(GIFT_SELECT)
      .is('contact.deleted_at', null)
      .order('given_on', { ascending: false })
      .order('id', { ascending: true })
      .limit(SNAPSHOT_GIFT_LIMIT)
      .overrideTypes<GiftRowShape[], { merge: false }>(),
  ])

  if (ytd.error) fail('the giving summary', ytd.error)
  if (recent.error) fail('recent gifts', recent.error)

  return {
    monthToDateCents: monthScan.gifts.reduce((total, gift) => total + gift.amount_cents, 0),
    yearToDateCents: (ytd.data ?? []).reduce((total, row) => total + row.ytd_cents, 0),
    recent: (recent.data ?? []).map(toGift),
  }
}
