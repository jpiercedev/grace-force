import type { SupabaseClient } from '@supabase/supabase-js'
import { MailchimpClient, isMailchimpError } from '@/lib/mailchimp/client'
import { MAILCHIMP_JOBS, type MailchimpJob } from '@/lib/mailchimp/jobs'
import {
  campaignActivityDedupeKey,
  campaignTimelineDedupeKey,
  canonicalTimestamp,
  matchContact,
  memberStatusDedupeKey,
  type ContactCandidate,
  type ContactDraft,
  type MatchMethod,
} from '@/lib/mailchimp/matching'
import type {
  MailchimpCampaign,
  MailchimpCampaignReport,
  MailchimpMember,
} from '@/lib/mailchimp/types'
import { chunk, normalizeEmail } from '@/lib/utils'
import type {
  Database,
  Json,
  MailchimpAction,
  MailchimpMemberStatus,
  SyncStatus,
} from '@/types/database'

/**
 * The Mailchimp sync engine.
 *
 * Every job takes its collaborators — the API client and a Supabase client
 * with service-role rights — as arguments, so the whole engine can be run
 * against fakes. The wiring that supplies the real ones lives in `./run`,
 * which is the only server-only module in this folder.
 *
 * The governing requirement is idempotency: running any job twice against the
 * same provider payload must leave the database identical. That is structural
 * rather than careful, and it rests on three things:
 *
 *  - Provider rows are upserted on the provider's own natural key.
 *  - Timeline entries carry a deterministic `activities.dedupe_key`, whose
 *    unique index is what actually prevents the second copy.
 *  - Nothing here writes an activity the database already writes by trigger;
 *    creating a `newsletter` engagement, for instance, logs itself.
 */

export type SyncDatabase = SupabaseClient<Database>

export interface SyncOptions {
  /** Restricts every job to one Mailchimp list. Null syncs everything. */
  audienceId?: string | null
  autoCreateContacts: boolean
  /** The profile that asked for the sync; null for a scheduled run. */
  triggeredBy?: string | null
  now?: () => Date
}

export interface SyncDeps {
  client: MailchimpClient
  db: SyncDatabase
  options: SyncOptions
}

export interface SyncRunResult {
  job: MailchimpJob
  status: SyncStatus
  stats: Record<string, number>
  warnings: string[]
  error: string | null
  runId: string | null
}

// --- Tuning -----------------------------------------------------------------

/** Rows per write. Small enough that one bad row costs little to isolate. */
const WRITE_CHUNK = 200

/** Values per `.in()` filter, which travels in the query string. */
const FILTER_CHUNK = 100

/** Emails per `or=` filter; each term is long, and the URL has a ceiling. */
const OR_FILTER_CHUNK = 40

/** Kept bounded so a pathological run cannot fill the stats column. */
const MAX_WARNINGS = 25

/**
 * Overlap applied to incremental member pulls. Provider and database clocks
 * are not the same clock, and re-reading a minute of members is free next to
 * missing one.
 */
const MEMBER_OVERLAP_SECONDS = 60

/**
 * How far back the campaign watermark reaches. Opens and clicks keep arriving
 * for weeks after a send, so recent campaigns are refetched rather than frozen
 * at whatever their numbers were the first time they were seen.
 */
const CAMPAIGN_REFRESH_DAYS = 30

/** Ceiling on campaigns handled in one run; each one costs a report request. */
const CAMPAIGN_LIMIT = 100

/** Per-subscriber activity is the heaviest endpoint, so it is windowed hard. */
const ACTIVITY_WINDOW_DAYS = 30
const ACTIVITY_CAMPAIGN_LIMIT = 10

// --- Bookkeeping ------------------------------------------------------------

class SyncReport {
  readonly stats: Record<string, number> = {}
  readonly warnings: string[] = []
  private truncated = false

  count(key: string, amount = 1): void {
    this.stats[key] = (this.stats[key] ?? 0) + amount
  }

  /**
   * A recoverable problem: one row that could not be written, one report that
   * was unavailable. Warnings downgrade the run to `partial` so the failure is
   * visible without pretending the whole job died.
   */
  warn(message: string): void {
    this.count('warnings')
    if (this.warnings.length < MAX_WARNINGS) {
      this.warnings.push(message)
    } else if (!this.truncated) {
      this.truncated = true
      this.warnings.push('Further warnings were suppressed.')
    }
  }
}

interface WriteError {
  message: string
  code?: string
}

type WriteResult = { error: WriteError | null }

/** Postgres' unique violation. The only conflict this module ever expects. */
function isUniqueViolation(error: WriteError | null): boolean {
  return error?.code === '23505'
}

/**
 * Writes rows in batches, falling back to one row at a time when a batch is
 * rejected. Without the fallback, a single unwritable member would discard the
 * other 199 in its chunk and the run would report far more damage than it did.
 */
async function writeAll<T>(
  rows: readonly T[],
  write: (batch: T[]) => PromiseLike<WriteResult>,
  report: SyncReport,
  describe: (row: T) => string,
  options: { ignoreConflicts?: boolean } = {},
): Promise<number> {
  let written = 0

  for (const batch of chunk(rows, WRITE_CHUNK)) {
    const { error } = await write(batch)
    if (!error) {
      written += batch.length
      continue
    }
    if (options.ignoreConflicts && isUniqueViolation(error) && batch.length === 1) continue

    for (const row of batch) {
      const single = await write([row])
      if (!single.error) {
        written += 1
        continue
      }
      // An already-present row is the expected outcome of a replay, not a fault.
      if (options.ignoreConflicts && isUniqueViolation(single.error)) continue
      report.warn(`${describe(row)}: ${single.error.message}`)
    }
  }

  return written
}

/**
 * The provider's payloads are JSON by construction — they came out of
 * `response.json()`. The declared response types name only the fields the sync
 * reads, so this is what lets the untouched object be mirrored into `raw`.
 */
function toJson(value: unknown): Json {
  return value as Json
}

function describeError(error: unknown): string {
  if (isMailchimpError(error)) {
    return `Mailchimp ${error.status} on ${error.path}: ${error.detail ?? error.title ?? 'no detail given'}`.slice(
      0,
      2000,
    )
  }
  if (error instanceof Error) return error.message.slice(0, 2000)
  return String(error).slice(0, 2000)
}

function nowOf(deps: SyncDeps): Date {
  return deps.options.now?.() ?? new Date()
}

function isoMinusSeconds(iso: string, seconds: number): string | undefined {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return undefined
  return new Date(parsed.getTime() - seconds * 1000).toISOString()
}

/** `started_on` is a DATE column, and the ISO prefix is already UTC-correct. */
function toDateOnly(value: string | null | undefined, fallback: string): string {
  const iso = canonicalTimestamp(value)
  return iso === '' ? fallback : iso.slice(0, 10)
}

/**
 * Records the run, then runs the work.
 *
 * A job never throws at its caller: `all` must be able to attempt campaigns
 * even when members failed, and every outcome is already durable in
 * `integration_sync_runs`.
 */
async function withRun(
  deps: SyncDeps,
  job: MailchimpJob,
  work: (report: SyncReport) => Promise<void>,
): Promise<SyncRunResult> {
  const report = new SyncReport()
  const startedAt = nowOf(deps).toISOString()

  const { data: run, error: runError } = await deps.db
    .from('integration_sync_runs')
    .insert({
      integration: 'mailchimp',
      job,
      status: 'running',
      started_at: startedAt,
      triggered_by: deps.options.triggeredBy ?? null,
    })
    .select('id')
    .single()

  const runId = run?.id ?? null
  // Losing the audit row is worth a warning, not a cancelled sync: the data is
  // what the ministry needs, and the run is only how we explain it afterwards.
  if (runError) report.warn(`Could not record the sync run: ${runError.message}`)

  try {
    await work(report)
  } catch (error) {
    const message = describeError(error)
    await finishRun(deps, runId, 'failed', report, message)
    return { job, status: 'failed', stats: report.stats, warnings: report.warnings, error: message, runId }
  }

  const status: SyncStatus = report.warnings.length > 0 ? 'partial' : 'succeeded'
  await finishRun(deps, runId, status, report, null)
  return { job, status, stats: report.stats, warnings: report.warnings, error: null, runId }
}

async function finishRun(
  deps: SyncDeps,
  runId: string | null,
  status: SyncStatus,
  report: SyncReport,
  error: string | null,
): Promise<void> {
  if (!runId) return
  const stats: Json = {
    ...report.stats,
    ...(report.warnings.length > 0 ? { warnings: report.warnings } : {}),
  }
  await deps.db
    .from('integration_sync_runs')
    .update({
      status,
      finished_at: nowOf(deps).toISOString(),
      stats,
      error,
    })
    .eq('id', runId)
}

// --- Audiences --------------------------------------------------------------

/**
 * Mirrors every list the key can see, or just the configured one.
 *
 * `last_synced_at` is deliberately not written here. It means "when this
 * audience's members were last pulled", and the members job both reads it as
 * its incremental watermark and stamps it afterwards.
 */
export async function syncAudiences(deps: SyncDeps): Promise<SyncRunResult> {
  return withRun(deps, 'audiences', async (report) => {
    const lists = await deps.client.listAudiences()
    const wanted = deps.options.audienceId
      ? lists.filter((list) => list.id === deps.options.audienceId)
      : lists

    report.count('fetched', wanted.length)
    if (deps.options.audienceId && wanted.length === 0) {
      report.warn(
        `MAILCHIMP_AUDIENCE_ID is set to ${deps.options.audienceId}, which this API key cannot see.`,
      )
      return
    }
    if (wanted.length === 0) return

    const known = await existingKeys(
      wanted.map((list) => list.id),
      async (batch) => {
        const { data, error } = await deps.db
          .from('mailchimp_audiences')
          .select('mailchimp_list_id')
          .in('mailchimp_list_id', batch)
        if (error) throw new Error(`Could not read stored audiences: ${error.message}`)
        return (data ?? []).map((row) => row.mailchimp_list_id)
      },
    )

    const rows = wanted.map((list) => ({
      mailchimp_list_id: list.id,
      name: list.name?.trim() || list.id,
      web_id: list.web_id === undefined ? null : String(list.web_id),
      permission_reminder: list.permission_reminder ?? null,
      member_count: list.stats?.member_count ?? 0,
      unsubscribe_count: list.stats?.unsubscribe_count ?? 0,
      cleaned_count: list.stats?.cleaned_count ?? 0,
      is_active: true,
      raw: toJson(list),
    }))

    await writeAll(
      rows,
      (batch) =>
        deps.db.from('mailchimp_audiences').upsert(batch, { onConflict: 'mailchimp_list_id' }),
      report,
      (row) => `audience ${row.mailchimp_list_id}`,
    )

    report.count('created', wanted.filter((list) => !known.has(list.id)).length)
    report.count('updated', wanted.filter((list) => known.has(list.id)).length)
  })
}

// --- Members ----------------------------------------------------------------

interface LocalAudience {
  id: string
  mailchimp_list_id: string
  name: string
  last_synced_at: string | null
}

interface PriorMember {
  id: string
  contact_id: string | null
  match_method: string | null
  matched_at: string | null
  status: MailchimpMemberStatus
  last_changed_at: string | null
}

interface Resolution {
  contactId: string | null
  method: MatchMethod | null
}

const MEMBER_STATUSES: readonly MailchimpMemberStatus[] = [
  'subscribed',
  'unsubscribed',
  'cleaned',
  'pending',
  'transactional',
  'archived',
]

function toMemberStatus(value: string | undefined): MailchimpMemberStatus | null {
  const found = MEMBER_STATUSES.find((status) => status === value)
  return found ?? null
}

/**
 * Pulls subscribers, resolves them to contacts, and records what changed.
 *
 * The contact resolution cache spans the whole job rather than one audience:
 * the same person on two lists must land on one contact, including when that
 * contact is created during this very run.
 */
export async function syncMembers(deps: SyncDeps): Promise<SyncRunResult> {
  return withRun(deps, 'members', async (report) => {
    const audiences = await listLocalAudiences(deps)
    if (audiences.length === 0) {
      report.warn('No audiences are stored yet. Run the audiences job first.')
      return
    }

    const newsletterTypeId = await findEngagementTypeId(deps, 'newsletter')
    if (!newsletterTypeId) {
      report.warn('No engagement type with slug "newsletter" exists, so none were recorded.')
    }

    const resolved = new Map<string, Resolution>()

    for (const audience of audiences) {
      await syncAudienceMembers(deps, audience, newsletterTypeId, resolved, report)
    }
  })
}

async function syncAudienceMembers(
  deps: SyncDeps,
  audience: LocalAudience,
  newsletterTypeId: string | null,
  resolved: Map<string, Resolution>,
  report: SyncReport,
): Promise<void> {
  const nowIso = nowOf(deps).toISOString()
  const sinceLastChanged = audience.last_synced_at
    ? isoMinusSeconds(audience.last_synced_at, MEMBER_OVERLAP_SECONDS)
    : undefined

  const members = await deps.client.listMembers(audience.mailchimp_list_id, { sinceLastChanged })
  report.count('fetched', members.length)

  if (members.length === 0) {
    await stampAudienceSync(deps, audience.id, nowIso)
    return
  }

  const prior = await loadPriorMembers(deps, audience.id, members)
  await resolveMemberContacts(deps, audience, members, prior, resolved, report)

  const rows: MemberUpsert[] = []
  const links = new Map<string, string>()

  for (const member of members) {
    const status = toMemberStatus(member.status)
    const email = normalizeEmail(member.email_address)
    if (!status) {
      report.warn(`Subscriber ${member.id} has an unrecognised status "${member.status}".`)
      continue
    }
    if (!email || !member.email_address) {
      report.warn(`Subscriber ${member.id} has no email address.`)
      continue
    }

    const previous = prior.get(member.id)
    // An existing link wins, always. An admin may have corrected it by hand,
    // and a nightly job must not quietly undo that.
    const link: Resolution = previous?.contact_id
      ? { contactId: previous.contact_id, method: asMatchMethod(previous.match_method) }
      : (resolved.get(email) ?? { contactId: null, method: null })

    if (link.contactId) links.set(member.id, link.contactId)

    const lastChanged = canonicalTimestamp(member.last_changed) || null

    rows.push({
      audience_id: audience.id,
      mailchimp_member_id: member.id,
      email_address: member.email_address,
      status,
      contact_id: link.contactId,
      match_method: link.contactId ? link.method : null,
      matched_at: link.contactId ? (previous?.matched_at ?? nowIso) : null,
      merge_fields: toJson(member.merge_fields ?? {}),
      tags: toJson(member.tags ?? []),
      member_rating: member.member_rating ?? null,
      is_vip: member.vip ?? false,
      opt_in_at: canonicalTimestamp(member.timestamp_opt) || null,
      last_changed_at: lastChanged,
      // Mailchimp exposes no unsubscribe timestamp of its own; the moment the
      // record last changed is the closest honest answer.
      unsubscribed_at: status === 'unsubscribed' ? lastChanged : null,
      raw: toJson(member),
      synced_at: nowIso,
    })
  }

  const written = await writeAll(
    rows,
    (batch) =>
      deps.db
        .from('mailchimp_members')
        .upsert(batch, { onConflict: 'audience_id,mailchimp_member_id' }),
    report,
    (row) => `subscriber ${row.email_address}`,
  )
  report.count('members_upserted', written)

  await recordStatusChanges(deps, audience, members, prior, links, report)

  if (newsletterTypeId) {
    await ensureNewsletterEngagements(deps, audience, newsletterTypeId, members, links, report)
  }

  await stampAudienceSync(deps, audience.id, nowIso)
}

type MemberUpsert = {
  audience_id: string
  mailchimp_member_id: string
  email_address: string
  status: MailchimpMemberStatus
  contact_id: string | null
  match_method: string | null
  matched_at: string | null
  merge_fields: Json
  tags: Json
  member_rating: number | null
  is_vip: boolean
  opt_in_at: string | null
  last_changed_at: string | null
  unsubscribed_at: string | null
  raw: Json
  synced_at: string
}

function asMatchMethod(value: string | null): MatchMethod | null {
  const known: readonly MatchMethod[] = ['email', 'secondary_email', 'created', 'manual']
  return known.find((method) => method === value) ?? null
}

/**
 * Fills the resolution cache for every subscriber that is not already linked.
 *
 * Candidates for the whole page are fetched in two queries rather than one per
 * member, and `matchContact` — a pure function — decides. Auto-creation happens
 * one contact at a time because each needs its new id back.
 */
async function resolveMemberContacts(
  deps: SyncDeps,
  audience: LocalAudience,
  members: readonly MailchimpMember[],
  prior: Map<string, PriorMember>,
  resolved: Map<string, Resolution>,
  report: SyncReport,
): Promise<void> {
  const pending: string[] = []
  for (const member of members) {
    const email = normalizeEmail(member.email_address)
    if (!email) continue
    if (prior.get(member.id)?.contact_id) continue
    if (resolved.has(email) || pending.includes(email)) continue
    pending.push(email)
  }
  if (pending.length === 0) return

  const [byEmail, bySecondary] = await Promise.all([
    findContactsByEmail(deps, pending),
    findContactsBySecondaryEmail(deps, pending),
  ])

  for (const member of members) {
    const email = normalizeEmail(member.email_address)
    if (!email || resolved.has(email) || !pending.includes(email)) continue

    const candidates = [...(byEmail.get(email) ?? []), ...(bySecondary.get(email) ?? [])]
    const match = matchContact(member, candidates, {
      autoCreateContacts: deps.options.autoCreateContacts,
    })

    if (match.kind === 'matched') {
      resolved.set(email, { contactId: match.contactId, method: match.method })
      report.count('matched')
      continue
    }

    if (match.kind === 'create') {
      const contactId = await createContactForMember(deps, match.draft, member, audience, report)
      resolved.set(email, contactId ? { contactId, method: 'created' } : { contactId: null, method: null })
      if (contactId) report.count('contacts_created')
      else report.count('unmatched')
      continue
    }

    resolved.set(email, { contactId: null, method: null })
    report.count('unmatched')
  }
}

async function createContactForMember(
  deps: SyncDeps,
  draft: ContactDraft,
  member: MailchimpMember,
  audience: LocalAudience,
  report: SyncReport,
): Promise<string | null> {
  const { data, error } = await deps.db
    .from('contacts')
    .insert({
      first_name: draft.first_name,
      last_name: draft.last_name,
      email: draft.email,
      source: 'mailchimp',
      source_detail: audience.name,
      // The subscriber hash is md5 of the lowercased address, so it is stable
      // across audiences and across re-syncs: a natural key the CRM can own.
      external_source: 'mailchimp',
      external_id: member.id,
    })
    .select('id')
    .single()

  if (!error && data) return data.id

  if (error && isUniqueViolation(error)) {
    // Either a concurrent run got there first, or the address belongs to a
    // contact the candidate queries could not see. Adopt whichever exists.
    const existing = await findContactByEmailOrExternalId(deps, draft.email, member.id)
    if (existing) return existing
  }

  report.warn(`Could not create a contact for ${draft.email}: ${error?.message ?? 'no row returned'}`)
  return null
}

async function findContactByEmailOrExternalId(
  deps: SyncDeps,
  email: string,
  externalId: string,
): Promise<string | null> {
  const normalized = normalizeEmail(email)
  if (normalized) {
    const { data } = await deps.db
      .from('contacts')
      .select('id')
      .eq('email_normalized', normalized)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
    if (data && data[0]) return data[0].id
  }

  const { data } = await deps.db
    .from('contacts')
    .select('id')
    .eq('external_source', 'mailchimp')
    .eq('external_id', externalId)
    .limit(1)
  return data?.[0]?.id ?? null
}

async function findContactsByEmail(
  deps: SyncDeps,
  emails: readonly string[],
): Promise<Map<string, ContactCandidate[]>> {
  const found = new Map<string, ContactCandidate[]>()

  for (const batch of chunk(emails, FILTER_CHUNK)) {
    const { data, error } = await deps.db
      .from('contacts')
      .select('id, email_normalized, secondary_email, created_at')
      .in('email_normalized', batch)
      .is('deleted_at', null)

    if (error) throw new Error(`Could not read contacts by email: ${error.message}`)

    for (const row of data ?? []) {
      const key = row.email_normalized
      if (!key) continue
      const bucket = found.get(key)
      if (bucket) bucket.push(row)
      else found.set(key, [row])
    }
  }

  return found
}

/**
 * `contacts.secondary_email` has no generated normal form, so the comparison
 * has to be case-insensitive in SQL. PostgREST's `or=` is delimited by commas
 * and parentheses, so an address containing either is skipped rather than
 * allowed to rewrite the filter — the address still matches on the primary
 * pass, or ends up in the review queue, both of which are safe.
 */
async function findContactsBySecondaryEmail(
  deps: SyncDeps,
  emails: readonly string[],
): Promise<Map<string, ContactCandidate[]>> {
  const found = new Map<string, ContactCandidate[]>()
  const safe = emails.filter((email) => !/[,()"'%*\\]/.test(email))

  for (const batch of chunk(safe, OR_FILTER_CHUNK)) {
    const { data, error } = await deps.db
      .from('contacts')
      .select('id, email_normalized, secondary_email, created_at')
      .not('secondary_email', 'is', null)
      .or(batch.map((email) => `secondary_email.ilike.${email}`).join(','))
      .is('deleted_at', null)

    if (error) throw new Error(`Could not read contacts by secondary email: ${error.message}`)

    for (const row of data ?? []) {
      const key = normalizeEmail(row.secondary_email)
      if (!key) continue
      const bucket = found.get(key)
      if (bucket) bucket.push(row)
      else found.set(key, [row])
    }
  }

  return found
}

async function loadPriorMembers(
  deps: SyncDeps,
  audienceId: string,
  members: readonly MailchimpMember[],
): Promise<Map<string, PriorMember>> {
  const prior = new Map<string, PriorMember>()

  for (const batch of chunk(
    members.map((member) => member.id),
    FILTER_CHUNK,
  )) {
    const { data, error } = await deps.db
      .from('mailchimp_members')
      .select('id, mailchimp_member_id, contact_id, match_method, matched_at, status, last_changed_at')
      .eq('audience_id', audienceId)
      .in('mailchimp_member_id', batch)

    if (error) throw new Error(`Could not read stored subscribers: ${error.message}`)

    for (const row of data ?? []) {
      prior.set(row.mailchimp_member_id, {
        id: row.id,
        contact_id: row.contact_id,
        match_method: row.match_method,
        matched_at: row.matched_at,
        status: row.status,
        last_changed_at: row.last_changed_at,
      })
    }
  }

  return prior
}

/**
 * Posts a timeline entry when someone joins or leaves a list.
 *
 * The insert is attempted only when something actually moved, and the
 * dedupe key makes it inert even when it is attempted anyway — belt and
 * braces, because this is the one place where a replay would otherwise be
 * visible to staff as a duplicated event.
 */
async function recordStatusChanges(
  deps: SyncDeps,
  audience: LocalAudience,
  members: readonly MailchimpMember[],
  prior: Map<string, PriorMember>,
  links: Map<string, string>,
  report: SyncReport,
): Promise<void> {
  const rows: TimelineInsert[] = []

  for (const member of members) {
    const status = toMemberStatus(member.status)
    if (status !== 'subscribed' && status !== 'unsubscribed') continue

    const contactId = links.get(member.id)
    // `activities.contact_id` is NOT NULL — an unmatched subscriber has no
    // timeline to post to, which is precisely why the review queue exists.
    if (!contactId) continue

    const previous = prior.get(member.id)
    const moved =
      !previous ||
      previous.status !== status ||
      canonicalTimestamp(previous.last_changed_at) !== canonicalTimestamp(member.last_changed)
    if (!moved) continue

    const occurredAt =
      canonicalTimestamp(member.last_changed) ||
      canonicalTimestamp(member.timestamp_opt) ||
      nowOf(deps).toISOString()

    rows.push({
      contact_id: contactId,
      type: status === 'subscribed' ? 'mailchimp_subscribed' : 'mailchimp_unsubscribed',
      direction: 'inbound',
      source: 'mailchimp',
      subject:
        status === 'subscribed'
          ? `Subscribed to ${audience.name}`
          : `Unsubscribed from ${audience.name}`,
      body: status === 'unsubscribed' ? (member.unsubscribe_reason ?? null) : null,
      occurred_at: occurredAt,
      actor_label: 'Mailchimp',
      metadata: toJson({
        list_id: audience.mailchimp_list_id,
        audience: audience.name,
        member_id: member.id,
        status,
      }),
      dedupe_key: memberStatusDedupeKey({
        status,
        listId: audience.mailchimp_list_id,
        memberHash: member.id,
        lastChanged: member.last_changed,
      }),
    })
  }

  const written = await insertNewActivities(deps, rows, report)
  report.count('timeline_entries', written)
}

type TimelineInsert = {
  contact_id: string
  type: 'mailchimp_subscribed' | 'mailchimp_unsubscribed' | 'mailchimp_campaign_opened' | 'mailchimp_campaign_clicked'
  direction: 'inbound'
  source: 'mailchimp'
  subject: string
  body: string | null
  occurred_at: string
  actor_label: string
  metadata: Json
  dedupe_key: string
}

/**
 * Inserts timeline entries whose dedupe key is not already present.
 *
 * The pre-filter is an optimisation, not the guarantee: the unique index on
 * `activities.dedupe_key` is what makes this safe under concurrency, and it is
 * partial, so a conflict has to be tolerated in application code rather than
 * declared as an `on conflict` target.
 */
async function insertNewActivities(
  deps: SyncDeps,
  rows: readonly TimelineInsert[],
  report: SyncReport,
): Promise<number> {
  if (rows.length === 0) return 0

  const present = await existingKeys(
    rows.map((row) => row.dedupe_key),
    async (batch) => {
      const { data, error } = await deps.db
        .from('activities')
        .select('dedupe_key')
        .in('dedupe_key', batch)
      if (error) throw new Error(`Could not read existing timeline entries: ${error.message}`)
      return (data ?? []).flatMap((row) => (row.dedupe_key ? [row.dedupe_key] : []))
    },
  )
  const fresh = rows.filter((row) => !present.has(row.dedupe_key))
  if (fresh.length === 0) return 0

  return writeAll(
    fresh,
    (batch) => deps.db.from('activities').insert(batch),
    report,
    (row) => `timeline entry ${row.dedupe_key}`,
    { ignoreConflicts: true },
  )
}

/**
 * Gives every subscribed, matched contact a `newsletter` engagement.
 *
 * This is what makes "who is on the list" answerable from the CRM side rather
 * than only from the mirror tables. The insert is guarded by a read and then
 * tolerates a conflict anyway: `engagements_one_live_per_type` is a partial
 * unique index, which cannot be named as an `on conflict` target. The database
 * writes the `engagement_started` activity by trigger, so nothing here does.
 */
async function ensureNewsletterEngagements(
  deps: SyncDeps,
  audience: LocalAudience,
  engagementTypeId: string,
  members: readonly MailchimpMember[],
  links: Map<string, string>,
  report: SyncReport,
): Promise<void> {
  const today = nowOf(deps).toISOString().slice(0, 10)
  const wanted = new Map<string, string>()

  for (const member of members) {
    if (toMemberStatus(member.status) !== 'subscribed') continue
    const contactId = links.get(member.id)
    if (!contactId || wanted.has(contactId)) continue
    wanted.set(contactId, toDateOnly(member.timestamp_opt || member.last_changed, today))
  }
  if (wanted.size === 0) return

  const live = new Set<string>()
  for (const batch of chunk([...wanted.keys()], FILTER_CHUNK)) {
    const { data, error } = await deps.db
      .from('engagements')
      .select('contact_id')
      .eq('engagement_type_id', engagementTypeId)
      .neq('status', 'ended')
      .in('contact_id', batch)

    if (error) throw new Error(`Could not read newsletter engagements: ${error.message}`)
    for (const row of data ?? []) live.add(row.contact_id)
  }

  const rows = [...wanted.entries()]
    .filter(([contactId]) => !live.has(contactId))
    .map(([contactId, startedOn]) => ({
      contact_id: contactId,
      engagement_type_id: engagementTypeId,
      status: 'active' as const,
      role_detail: audience.name,
      started_on: startedOn,
    }))

  const written = await writeAll(
    rows,
    (batch) => deps.db.from('engagements').insert(batch),
    report,
    (row) => `newsletter engagement for ${row.contact_id}`,
    { ignoreConflicts: true },
  )
  report.count('engagements_created', written)
}

async function listLocalAudiences(deps: SyncDeps): Promise<LocalAudience[]> {
  let query = deps.db
    .from('mailchimp_audiences')
    .select('id, mailchimp_list_id, name, last_synced_at')
    .eq('is_active', true)

  if (deps.options.audienceId) query = query.eq('mailchimp_list_id', deps.options.audienceId)

  const { data, error } = await query.order('name', { ascending: true })
  if (error) throw new Error(`Could not read stored audiences: ${error.message}`)
  return data ?? []
}

async function stampAudienceSync(deps: SyncDeps, audienceId: string, nowIso: string): Promise<void> {
  await deps.db.from('mailchimp_audiences').update({ last_synced_at: nowIso }).eq('id', audienceId)
}

async function findEngagementTypeId(deps: SyncDeps, slug: string): Promise<string | null> {
  const { data } = await deps.db.from('engagement_types').select('id').eq('slug', slug).limit(1)
  return data?.[0]?.id ?? null
}

// --- Campaigns --------------------------------------------------------------

/**
 * Mirrors sent campaigns and merges their report figures.
 *
 * The report is a second request per campaign, so the pull is watermarked
 * against the newest stored send. `report_summary`, which arrives inline with
 * the campaign, is the fallback when a report is not yet available.
 */
export async function syncCampaigns(deps: SyncDeps): Promise<SyncRunResult> {
  return withRun(deps, 'campaigns', async (report) => {
    const sinceSendTime = await campaignWatermark(deps)
    const campaigns = await deps.client.listCampaigns({ sinceSendTime })

    const wanted = deps.options.audienceId
      ? campaigns.filter((campaign) => campaign.recipients?.list_id === deps.options.audienceId)
      : campaigns

    report.count('fetched', wanted.length)
    if (wanted.length === 0) return

    const processed = wanted.slice(0, CAMPAIGN_LIMIT)
    if (processed.length < wanted.length) {
      report.warn(
        `${wanted.length} campaigns matched; the ${CAMPAIGN_LIMIT} most recent were processed. Run again to continue.`,
      )
    }

    const audienceIds = await mapListIdsToAudiences(deps, processed)
    const known = await existingKeys(
      processed.map((campaign) => campaign.id),
      async (batch) => {
        const { data, error } = await deps.db
          .from('mailchimp_campaigns')
          .select('mailchimp_campaign_id')
          .in('mailchimp_campaign_id', batch)
        if (error) throw new Error(`Could not read stored campaigns: ${error.message}`)
        return (data ?? []).map((row) => row.mailchimp_campaign_id)
      },
    )
    const nowIso = nowOf(deps).toISOString()

    const rows = []
    for (const campaign of processed) {
      const campaignReport = await fetchCampaignReport(deps, campaign.id, report)
      const listId = campaign.recipients?.list_id
      rows.push(
        toCampaignRow(campaign, campaignReport, listId ? (audienceIds.get(listId) ?? null) : null, nowIso),
      )
    }

    await writeAll(
      rows,
      (batch) =>
        deps.db.from('mailchimp_campaigns').upsert(batch, { onConflict: 'mailchimp_campaign_id' }),
      report,
      (row) => `campaign ${row.mailchimp_campaign_id}`,
    )

    report.count('created', processed.filter((campaign) => !known.has(campaign.id)).length)
    report.count('updated', processed.filter((campaign) => known.has(campaign.id)).length)
  })
}

async function campaignWatermark(deps: SyncDeps): Promise<string | undefined> {
  const { data } = await deps.db
    .from('mailchimp_campaigns')
    .select('send_time')
    .not('send_time', 'is', null)
    .order('send_time', { ascending: false })
    .limit(1)

  const latest = data?.[0]?.send_time
  if (!latest) return undefined
  return isoMinusSeconds(latest, CAMPAIGN_REFRESH_DAYS * 24 * 3600)
}

async function fetchCampaignReport(
  deps: SyncDeps,
  campaignId: string,
  report: SyncReport,
): Promise<MailchimpCampaignReport | null> {
  try {
    const result = await deps.client.getCampaignReport(campaignId)
    report.count('reports_fetched')
    return result
  } catch (error) {
    // A rejected key is fatal for the whole job; one missing report is not.
    if (isMailchimpError(error) && (error.status === 401 || error.status === 403)) throw error
    report.count('reports_missing')
    report.warn(`No report available for campaign ${campaignId}: ${describeError(error)}`)
    return null
  }
}

async function mapListIdsToAudiences(
  deps: SyncDeps,
  campaigns: readonly MailchimpCampaign[],
): Promise<Map<string, string>> {
  const listIds = [
    ...new Set(
      campaigns
        .map((campaign) => campaign.recipients?.list_id)
        .filter((listId): listId is string => typeof listId === 'string' && listId !== ''),
    ),
  ]
  const mapped = new Map<string, string>()
  if (listIds.length === 0) return mapped

  for (const batch of chunk(listIds, FILTER_CHUNK)) {
    const { data, error } = await deps.db
      .from('mailchimp_audiences')
      .select('id, mailchimp_list_id')
      .in('mailchimp_list_id', batch)

    if (error) throw new Error(`Could not read audiences for campaigns: ${error.message}`)
    for (const row of data ?? []) mapped.set(row.mailchimp_list_id, row.id)
  }

  return mapped
}

function toCampaignRow(
  campaign: MailchimpCampaign,
  campaignReport: MailchimpCampaignReport | null,
  audienceId: string | null,
  nowIso: string,
) {
  const summary = campaign.report_summary
  const opens = campaignReport?.opens
  const clicks = campaignReport?.clicks
  const bounces = campaignReport?.bounces

  return {
    mailchimp_campaign_id: campaign.id,
    audience_id: audienceId,
    web_id: campaign.web_id === undefined ? null : String(campaign.web_id),
    title: campaign.settings?.title ?? campaignReport?.campaign_title ?? null,
    subject_line: campaign.settings?.subject_line ?? null,
    preview_text: campaign.settings?.preview_text ?? null,
    from_name: campaign.settings?.from_name ?? null,
    reply_to: campaign.settings?.reply_to ?? null,
    campaign_type: campaign.type ?? null,
    status: campaign.status ?? null,
    send_time: canonicalTimestamp(campaign.send_time ?? campaignReport?.send_time) || null,
    emails_sent: campaignReport?.emails_sent ?? campaign.emails_sent ?? 0,
    opens_total: opens?.opens_total ?? summary?.opens ?? 0,
    unique_opens: opens?.unique_opens ?? summary?.unique_opens ?? 0,
    clicks_total: clicks?.clicks_total ?? summary?.clicks ?? 0,
    subscriber_clicks: clicks?.unique_subscriber_clicks ?? summary?.subscriber_clicks ?? 0,
    unsubscribed: campaignReport?.unsubscribed ?? 0,
    bounces:
      (bounces?.hard_bounces ?? 0) + (bounces?.soft_bounces ?? 0) + (bounces?.syntax_errors ?? 0),
    open_rate: opens?.open_rate ?? summary?.open_rate ?? null,
    click_rate: clicks?.click_rate ?? summary?.click_rate ?? null,
    archive_url: campaign.archive_url ?? null,
    raw: toJson({ campaign, report: campaignReport }),
    synced_at: nowIso,
  }
}

// --- Campaign activity ------------------------------------------------------

interface LocalCampaign {
  id: string
  mailchimp_campaign_id: string
  audience_id: string | null
  title: string | null
  subject_line: string | null
}

interface ActivityAccumulator {
  action: MailchimpAction
  email: string
  emailAddress: string
  url: string | null
  count: number
  firstAt: string | null
  lastAt: string | null
}

const TRACKED_ACTIONS: readonly MailchimpAction[] = ['open', 'click', 'bounce']

function toAction(value: string | undefined): MailchimpAction | null {
  return TRACKED_ACTIONS.find((action) => action === value) ?? null
}

/**
 * Mirrors per-subscriber engagement for recent campaigns, and posts opens and
 * clicks to the contact timeline.
 *
 * Mailchimp reports repeated opens as separate entries; they collapse onto one
 * row per (campaign, action, address, url) with a count, which is both what the
 * table's dedupe key expresses and what makes a re-sync a no-op.
 */
export async function syncCampaignActivity(deps: SyncDeps): Promise<SyncRunResult> {
  return withRun(deps, 'activity', async (report) => {
    const campaigns = await recentCampaigns(deps)
    if (campaigns.length === 0) {
      report.warn('No recently sent campaigns are stored. Run the campaigns job first.')
      return
    }

    for (const campaign of campaigns) {
      await syncOneCampaignActivity(deps, campaign, report)
    }
  })
}

async function recentCampaigns(deps: SyncDeps): Promise<LocalCampaign[]> {
  const windowStart = new Date(
    nowOf(deps).getTime() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000,
  ).toISOString()

  const { data, error } = await deps.db
    .from('mailchimp_campaigns')
    .select('id, mailchimp_campaign_id, audience_id, title, subject_line')
    .gte('send_time', windowStart)
    .order('send_time', { ascending: false })
    .limit(ACTIVITY_CAMPAIGN_LIMIT)

  if (error) throw new Error(`Could not read recent campaigns: ${error.message}`)
  return data ?? []
}

async function syncOneCampaignActivity(
  deps: SyncDeps,
  campaign: LocalCampaign,
  report: SyncReport,
): Promise<void> {
  const records = await deps.client.listCampaignEmailActivity(campaign.mailchimp_campaign_id)
  report.count('fetched', records.length)
  if (records.length === 0) return

  const accumulated = new Map<string, ActivityAccumulator>()

  for (const record of records) {
    const emailAddress = record.email_address?.trim()
    const email = normalizeEmail(emailAddress)
    if (!email || !emailAddress) continue

    for (const entry of record.activity ?? []) {
      const action = toAction(entry.action)
      if (!action) continue

      const url = action === 'click' ? (entry.url?.trim() || null) : null
      const key = campaignActivityDedupeKey({
        campaignId: campaign.mailchimp_campaign_id,
        action,
        email,
        url,
      })
      const at = canonicalTimestamp(entry.timestamp) || null

      const existing = accumulated.get(key)
      if (!existing) {
        accumulated.set(key, {
          action,
          email,
          emailAddress,
          url,
          count: 1,
          firstAt: at,
          lastAt: at,
        })
        continue
      }
      existing.count += 1
      if (at && (!existing.firstAt || at < existing.firstAt)) existing.firstAt = at
      if (at && (!existing.lastAt || at > existing.lastAt)) existing.lastAt = at
    }
  }

  if (accumulated.size === 0) return

  const emails = [...new Set([...accumulated.values()].map((entry) => entry.email))]
  const members = await loadMembersByEmail(deps, emails, campaign.audience_id)

  const rows = [...accumulated.entries()].map(([dedupeKey, entry]) => {
    const member = members.get(entry.email)
    return {
      campaign_id: campaign.id,
      member_id: member?.id ?? null,
      contact_id: member?.contact_id ?? null,
      email_address: entry.emailAddress,
      action: entry.action,
      action_at: entry.lastAt,
      url: entry.url,
      event_count: entry.count,
      dedupe_key: dedupeKey,
    }
  })

  const written = await writeAll(
    rows,
    (batch) =>
      deps.db.from('mailchimp_campaign_activity').upsert(batch, { onConflict: 'dedupe_key' }),
    report,
    (row) => `${row.action} by ${row.email_address}`,
  )
  report.count('activity_upserted', written)

  await postEngagementToTimeline(deps, campaign, accumulated, members, report)
}

interface MemberLink {
  id: string
  contact_id: string | null
}

/**
 * One timeline entry per person per campaign per kind of engagement.
 *
 * Clicking four links is four rows in the mirror table and one line on the
 * timeline; the timeline answers "did this campaign reach them", and the
 * detail is a click away in the activity table.
 */
async function postEngagementToTimeline(
  deps: SyncDeps,
  campaign: LocalCampaign,
  accumulated: Map<string, ActivityAccumulator>,
  members: Map<string, MemberLink>,
  report: SyncReport,
): Promise<void> {
  const label = campaign.title?.trim() || campaign.subject_line?.trim() || 'a campaign'
  const perContact = new Map<string, TimelineInsert>()

  for (const entry of accumulated.values()) {
    if (entry.action !== 'open' && entry.action !== 'click') continue
    const contactId = members.get(entry.email)?.contact_id
    if (!contactId) continue

    const dedupeKey = campaignTimelineDedupeKey({
      campaignId: campaign.mailchimp_campaign_id,
      action: entry.action,
      email: entry.email,
    })

    const occurredAt = entry.firstAt ?? entry.lastAt ?? nowOf(deps).toISOString()
    const existing = perContact.get(dedupeKey)
    if (existing) {
      // Several clicked URLs collapse to the earliest moment of engagement.
      if (occurredAt < existing.occurred_at) existing.occurred_at = occurredAt
      continue
    }

    perContact.set(dedupeKey, {
      contact_id: contactId,
      type: entry.action === 'open' ? 'mailchimp_campaign_opened' : 'mailchimp_campaign_clicked',
      direction: 'inbound',
      source: 'mailchimp',
      subject: entry.action === 'open' ? `Opened “${label}”` : `Clicked a link in “${label}”`,
      body: null,
      occurred_at: occurredAt,
      actor_label: 'Mailchimp',
      metadata: toJson({
        campaign_id: campaign.mailchimp_campaign_id,
        campaign: label,
        action: entry.action,
      }),
      dedupe_key: dedupeKey,
    })
  }

  const written = await insertNewActivities(deps, [...perContact.values()], report)
  report.count('timeline_entries', written)
}

/**
 * Resolves addresses to stored subscribers. A person on several lists has a
 * row per audience; the campaign's own audience wins so the link points at the
 * list the email actually went to.
 */
async function loadMembersByEmail(
  deps: SyncDeps,
  emails: readonly string[],
  audienceId: string | null,
): Promise<Map<string, MemberLink>> {
  const found = new Map<string, MemberLink>()

  for (const batch of chunk(emails, FILTER_CHUNK)) {
    const { data, error } = await deps.db
      .from('mailchimp_members')
      .select('id, audience_id, email_normalized, contact_id')
      .in('email_normalized', batch)

    if (error) throw new Error(`Could not read subscribers for campaign activity: ${error.message}`)

    for (const row of data ?? []) {
      const key = row.email_normalized
      if (!key) continue
      // A row from the campaign's own audience always displaces one from
      // another list; anything else is first-seen and stays.
      const preferred = audienceId !== null && row.audience_id === audienceId
      if (found.has(key) && !preferred) continue
      found.set(key, { id: row.id, contact_id: row.contact_id })
    }
  }

  return found
}

// --- Shared reads -----------------------------------------------------------

/**
 * Which of these natural keys already exist.
 *
 * Used both to report created against updated honestly, and to skip timeline
 * inserts that would do nothing but conflict. The read is a callback so each
 * caller keeps its own table's types; a generic version loses them.
 */
async function existingKeys(
  values: readonly string[],
  read: (batch: string[]) => Promise<string[]>,
): Promise<Set<string>> {
  const found = new Set<string>()
  if (values.length === 0) return found

  for (const batch of chunk([...new Set(values)], FILTER_CHUNK)) {
    for (const key of await read(batch)) found.add(key)
  }

  return found
}

// --- Orchestration ----------------------------------------------------------

const JOB_RUNNERS: Record<MailchimpJob, (deps: SyncDeps) => Promise<SyncRunResult>> = {
  audiences: syncAudiences,
  members: syncMembers,
  campaigns: syncCampaigns,
  activity: syncCampaignActivity,
}

/**
 * Runs jobs in dependency order, whatever order they were asked for.
 *
 * A failed job does not stop the rest: campaigns can succeed while members are
 * failing, and each outcome is recorded separately, so stopping early would
 * only hide working parts of the integration.
 */
export async function runMailchimpJobs(
  deps: SyncDeps,
  jobs: readonly MailchimpJob[],
): Promise<SyncRunResult[]> {
  const results: SyncRunResult[] = []
  for (const job of MAILCHIMP_JOBS) {
    if (!jobs.includes(job)) continue
    results.push(await JOB_RUNNERS[job](deps))
  }
  return results
}
