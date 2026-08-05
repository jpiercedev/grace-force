'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { applyContactRows, applyGiftRows, type ApplyResult } from '@/lib/csv/apply'
import {
  collectContactKeys,
  mapContactColumns,
  planContactImport,
  type ContactMatchIndex,
} from '@/lib/csv/contacts'
import {
  collectGiftKeys,
  mapGiftColumns,
  planGiftImport,
} from '@/lib/csv/gifts'
import { MAX_IMPORT_ROWS, parseCsv, type CsvRow } from '@/lib/csv/parse'
import {
  createContactStore,
  createGiftStore,
  loadContactMatchIndex,
  loadGiftMatchIndex,
} from '@/lib/csv/store'
import type { ImportAction } from '@/lib/csv/types'
import { IMPORT_KIND_LABELS, isImportKind, type ImportActionState } from '@/lib/csv/ui'
import { isAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/utils'
import type { Json } from '@/types/database'

/**
 * Import is two-phase on purpose.
 *
 * Uploading validates every row and stores what it decided; committing then
 * applies only what the preview promised. Nobody should have to discover what
 * a spreadsheet was going to do by watching it happen to their contacts.
 *
 * Both phases run through the caller's own Supabase client, so Row Level
 * Security governs what an import can read and write — including the
 * admin-only `gifts` policies, which is why a giving import says so up front
 * rather than failing halfway down the file.
 */

/** Bounded so a runaway upload cannot exhaust the request's memory. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Staging rows per insert. Large enough to be few round-trips, small enough to be a modest statement. */
const WRITE_CHUNK = 200

/** Preview and commit both read the whole batch; PostgREST caps a page at 1000. */
const READ_CHUNK = 500

const uploadSchema = z.object({
  kind: z.string().refine(isImportKind, 'Choose what this file contains'),
  external_source: z
    .string()
    .trim()
    .max(40, 'Keep the source name to 40 characters or fewer')
    .transform((value) => (value === '' ? 'csv' : value))
    .refine((value) => /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(value), {
      message: 'Use letters, digits, spaces, dots, dashes or underscores',
    }),
})

const commitSchema = z.object({
  batch_id: z.string().uuid('That import could not be found'),
})

const cellsSchema = z.record(z.string(), z.string())
const mappingSchema = z.object({ fields: z.record(z.string(), z.string()) })
const optionsSchema = z.object({
  external_source: z.string().min(1),
  planned: z.object({ error: z.number() }).optional(),
})

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key !== '' && !(key in errors)) errors[key] = issue.message
  }
  return errors
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function revalidateBatch(batchId: string): void {
  revalidatePath('/import')
  revalidatePath(`/import/${batchId}`)
}

interface StagedRow {
  row_number: number
  raw: Json
  normalized: Json
  errors: Json
  action: ImportAction
  contact_id: string | null
}

/**
 * Validates an uploaded file and stages every row for review.
 *
 * Redirects to the preview on success, so the browser's back button does not
 * re-post the file.
 */
export async function startImport(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const profile = await requireWriteAccess()

  const parsedForm = uploadSchema.safeParse({
    kind: text(formData, 'kind'),
    external_source: text(formData, 'external_source'),
  })
  if (!parsedForm.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrors(parsedForm.error) }
  }
  const { kind, external_source: externalSource } = parsedForm.data

  // The `gifts` policies only permit an admin to write, so refusing here turns
  // a confusing wall of per-row failures into one sentence.
  if (kind === 'gifts' && !isAdmin(profile)) {
    return { error: 'Only an administrator can import giving history.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file to import.', fieldErrors: { file: 'Choose a CSV file' } }
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error: 'That file is larger than 5 MB. Split it and import the parts.',
      fieldErrors: { file: 'File is too large' },
    }
  }

  const parsed = parseCsv(await file.text())
  if (parsed.headers.length === 0) {
    return { error: parsed.errors[0] ?? 'That file has no columns to read.' }
  }
  if (parsed.rows.length === 0) {
    return { error: 'That file has a header row but no data.' }
  }
  // A broken quote shifts every value after it into the wrong column, and the
  // file still looks importable. Refusing beats staging a garbled preview.
  if (parsed.errors.length > 0) {
    return { error: parsed.errors.join(' ') }
  }

  const mapping =
    kind === 'contacts' ? mapContactColumns(parsed.headers) : mapGiftColumns(parsed.headers)
  if (Object.keys(mapping.fields).length === 0) {
    return {
      error: `None of those columns match a ${IMPORT_KIND_LABELS[kind].toLowerCase()} field. Check the header row.`,
    }
  }

  const supabase = await createClient()

  let staged: StagedRow[]
  let counts: { create: number; update: number; skip: number; error: number }
  try {
    const planned =
      kind === 'contacts'
        ? await stageContacts(supabase, parsed.rows, mapping.fields, externalSource)
        : await stageGifts(supabase, parsed.rows, mapping.fields, externalSource)
    staged = planned.staged
    counts = planned.counts
  } catch (error) {
    return { error: `The file could not be checked against existing records. ${message(error)}` }
  }

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      kind,
      filename: file.name,
      status: 'pending',
      total_rows: staged.length,
      valid_rows: counts.create + counts.update,
      error_rows: counts.error,
      skipped_rows: counts.skip,
      column_mapping: { fields: mapping.fields, ignored: mapping.ignored },
      options: {
        external_source: externalSource,
        truncated: parsed.truncated,
        // The create/update split the preview promised. `created_rows` and
        // `updated_rows` record what actually happened, and stay zero until
        // the batch is committed.
        planned: counts,
      },
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return { error: `The import could not be started. ${batchError?.message ?? ''}`.trim() }
  }

  for (const batchRows of chunk(staged, WRITE_CHUNK)) {
    const { error } = await supabase
      .from('import_rows')
      .insert(batchRows.map((row) => ({ ...row, batch_id: batch.id })))
    if (error) {
      // The batch is useless without its rows, so it does not get to linger
      // in the history pretending to be reviewable.
      await supabase.from('import_batches').delete().eq('id', batch.id)
      return { error: `The rows could not be staged. ${error.message}` }
    }
  }

  revalidatePath('/import')
  redirect(`/import/${batch.id}`)
}

async function stageContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly CsvRow[],
  fields: Record<string, string>,
  externalSource: string,
): Promise<{ staged: StagedRow[]; counts: { create: number; update: number; skip: number; error: number } }> {
  const index = await loadContactMatchIndex(
    supabase,
    collectContactKeys(rows, fields),
    externalSource,
  )
  const plan = planContactImport(rows, { fields, index, externalSource })

  return {
    staged: plan.rows.map((row) => ({
      row_number: row.number,
      raw: row.raw,
      normalized: { ...row.values, matched_by: row.matchedBy, contact_id: row.contactId },
      errors: row.errors,
      action: row.action,
      contact_id: row.contactId,
    })),
    counts: plan.counts,
  }
}

async function stageGifts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly CsvRow[],
  fields: Record<string, string>,
  externalSource: string,
): Promise<{ staged: StagedRow[]; counts: { create: number; update: number; skip: number; error: number } }> {
  const keys = collectGiftKeys(rows, fields)
  const [gifts, contacts] = await Promise.all([
    loadGiftMatchIndex(
      supabase,
      { ids: keys.giftIds, externalIds: keys.giftExternalIds },
      externalSource,
    ),
    loadContactMatchIndex(
      supabase,
      { ids: keys.contactIds, externalIds: keys.contactExternalIds, emails: keys.contactEmails },
      externalSource,
    ),
  ])
  const plan = planGiftImport(rows, { fields, gifts, contacts, externalSource })

  return {
    staged: plan.rows.map((row) => ({
      row_number: row.number,
      raw: row.raw,
      normalized: { ...row.values, matched_by: row.contactMatchedBy, gift_id: row.giftId },
      errors: row.errors,
      action: row.action,
      contact_id: row.contactId,
    })),
    counts: plan.counts,
  }
}

interface StoredRow {
  id: string
  row_number: number
  raw: Json
  action: string
  applied: boolean
}

/**
 * Applies a staged batch.
 *
 * Rows are re-validated and re-matched from what was stored, because the
 * database has moved on since the preview: a contact may have been created,
 * renamed or deleted in between. Only rows the preview promised to write are
 * attempted, so a row that has since become valid does not sneak in.
 */
export async function commitImport(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const profile = await requireWriteAccess()

  const parsedForm = commitSchema.safeParse({ batch_id: text(formData, 'batch_id') })
  if (!parsedForm.success) return { error: 'That import could not be found.' }
  const batchId = parsedForm.data.batch_id

  const supabase = await createClient()

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .select('id, kind, status, column_mapping, options, skipped_rows, error_rows')
    .eq('id', batchId)
    .maybeSingle()

  if (batchError) return { error: 'That import could not be loaded.' }
  if (!batch) return { error: 'That import no longer exists.' }
  if (batch.status === 'committed') return { error: 'This import has already been applied.' }
  if (!isImportKind(batch.kind)) return { error: 'That import has an unrecognised kind.' }
  if (batch.kind === 'gifts' && !isAdmin(profile)) {
    return { error: 'Only an administrator can apply a giving import.' }
  }

  const mapping = mappingSchema.safeParse(batch.column_mapping)
  const options = optionsSchema.safeParse(batch.options)
  if (!mapping.success || !options.success) {
    return { error: 'This import was staged in a format this version cannot read.' }
  }
  const fields = mapping.data.fields
  const externalSource = options.data.external_source

  let stored: StoredRow[]
  try {
    stored = await readStagedRows(supabase, batchId)
  } catch (error) {
    return { error: `The staged rows could not be read. ${message(error)}` }
  }

  const promised = new Map<number, StoredRow>()
  const csvRows: CsvRow[] = []
  for (const row of stored) {
    if (row.applied) continue
    if (row.action !== 'create' && row.action !== 'update') continue
    const cells = cellsSchema.safeParse(row.raw)
    if (!cells.success) continue
    promised.set(row.row_number, row)
    csvRows.push({ number: row.row_number, cells: cells.data })
  }

  if (csvRows.length === 0) {
    return { error: 'There is nothing left to apply in this import.' }
  }

  let result: ApplyResult
  try {
    result =
      batch.kind === 'contacts'
        ? await applyContacts(supabase, csvRows, fields, externalSource, profile.id)
        : await applyGifts(supabase, csvRows, fields, externalSource, profile.id)
  } catch (error) {
    return { error: `The import could not be applied. ${message(error)}` }
  }

  const touched = result.rows
    .map((outcome) => {
      const row = promised.get(outcome.number)
      if (!row) return null
      return {
        id: row.id,
        applied: outcome.outcome !== 'failed',
        contact_id: outcome.contactId,
        gift_id: outcome.giftId,
        errors: outcome.error === null ? [] : [outcome.error],
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  let unrecorded = 0
  for (const patch of chunk(touched, WRITE_CHUNK)) {
    // PostgREST has no bulk update by key, so each row is patched on its own;
    // they are chunked to keep the number of round-trips predictable.
    const patched = await Promise.all(
      patch.map((row) =>
        supabase
          .from('import_rows')
          .update({
            applied: row.applied,
            contact_id: row.contact_id,
            gift_id: row.gift_id,
            errors: row.errors,
          })
          .eq('id', row.id),
      ),
    )
    unrecorded += patched.filter((response) => response.error !== null).length
  }

  const applied = result.created + result.updated
  const { error: updateError } = await supabase
    .from('import_batches')
    .update({
      status: applied === 0 && result.failed > 0 ? 'failed' : 'committed',
      created_rows: result.created,
      updated_rows: result.updated,
      // Counted from what validation found rather than from the column, so
      // retrying a failed batch does not add its errors a second time.
      error_rows: (options.data.planned?.error ?? batch.error_rows) + result.failed,
      error: result.rows.find((row) => row.error !== null)?.error ?? null,
      committed_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  if (updateError) {
    return {
      error: `The rows were applied, but the batch could not be marked as committed. ${updateError.message}`,
    }
  }

  revalidateBatch(batchId)
  revalidatePath('/contacts')
  revalidatePath('/dashboard')
  if (batch.kind === 'gifts') revalidatePath('/giving')

  const parts = [`${result.created} created`, `${result.updated} updated`]
  if (result.failed > 0) parts.push(`${result.failed} failed`)
  // A row the preview promised can stop validating in the meantime — its
  // contact deleted, its id reassigned — and is then left untouched.
  const stale = csvRows.length - result.rows.length
  if (stale > 0) parts.push(`${stale} no longer valid and left alone`)
  // The records themselves are written; only the audit trail is incomplete,
  // and saying so beats a clean-looking summary that quietly is not.
  const caveat =
    unrecorded > 0 ? ` ${unrecorded} rows could not be marked as applied in the batch record.` : ''
  return { notice: `Import applied: ${parts.join(', ')}.${caveat}` }
}

async function readStagedRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
): Promise<StoredRow[]> {
  const rows: StoredRow[] = []
  for (let offset = 0; ; offset += READ_CHUNK) {
    const { data, error } = await supabase
      .from('import_rows')
      .select('id, row_number, raw, action, applied')
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true })
      .range(offset, offset + READ_CHUNK - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < READ_CHUNK) break
    if (rows.length >= MAX_IMPORT_ROWS) break
  }
  return rows
}

async function applyContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly CsvRow[],
  fields: Record<string, string>,
  externalSource: string,
  actorId: string,
): Promise<ApplyResult> {
  const index: ContactMatchIndex = await loadContactMatchIndex(
    supabase,
    collectContactKeys(rows, fields),
    externalSource,
  )
  const plan = planContactImport(rows, { fields, index, externalSource })
  const store = createContactStore(supabase, actorId, externalSource, index)
  return applyContactRows(plan.rows, store, { externalSource })
}

async function applyGifts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly CsvRow[],
  fields: Record<string, string>,
  externalSource: string,
  actorId: string,
): Promise<ApplyResult> {
  const keys = collectGiftKeys(rows, fields)
  const [gifts, contacts] = await Promise.all([
    loadGiftMatchIndex(
      supabase,
      { ids: keys.giftIds, externalIds: keys.giftExternalIds },
      externalSource,
    ),
    loadContactMatchIndex(
      supabase,
      { ids: keys.contactIds, externalIds: keys.contactExternalIds, emails: keys.contactEmails },
      externalSource,
    ),
  ])
  const plan = planGiftImport(rows, { fields, gifts, contacts, externalSource })
  const store = createGiftStore(supabase, actorId, externalSource, { gifts, contacts })
  return applyGiftRows(plan.rows, store, { externalSource })
}

/** Throws away a staged batch that is not worth committing. */
export async function discardImport(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  await requireWriteAccess()

  const parsedForm = commitSchema.safeParse({ batch_id: text(formData, 'batch_id') })
  if (!parsedForm.success) return { error: 'That import could not be found.' }

  const { data, error } = await supabaseDelete(parsedForm.data.batch_id)
  if (error) return { error: `That import could not be discarded. ${error}` }
  if (!data) {
    return {
      error:
        'That import could not be discarded. A committed batch is kept as the record of what it did, and only its owner or an admin may discard a pending one.',
    }
  }

  revalidatePath('/import')
  redirect('/import')
}

async function supabaseDelete(batchId: string): Promise<{ data: boolean; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('import_batches')
    .delete()
    .eq('id', batchId)
    // A committed batch is the only record of what an import changed.
    .is('committed_at', null)
    .select('id')
  if (error) return { data: false, error: error.message }
  return { data: (data ?? []).length > 0, error: null }
}
