'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { applyContactRows, type ApplyResult } from '@/lib/csv/apply'
import {
  CONTACT_IMPORT_FIELDS,
  collectContactKeys,
  planContactImport,
  type ContactImportPlan,
} from '@/lib/csv/contacts'
import { resolveAssignments } from '@/lib/csv/mapping'
import { parseCsv } from '@/lib/csv/parse'
import { createContactStore, loadContactMatchIndex } from '@/lib/csv/store'
import {
  CONTACT_IMPORT_PROBLEM_LIMIT,
  IMPORT_MAX_FILE_BYTES,
  type ContactImportProblem,
  type ContactImportState,
} from '@/lib/csv/ui'
import { requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/utils'
import type { Json } from '@/types/database'

/**
 * The one-step import behind the People tab's "Import CSV" dialog.
 *
 * The `/import` page stages a file and asks for a second click; this one
 * writes as soon as the operator has confirmed the column mapping, because
 * that is the whole point of doing it from the list. It runs the same
 * planner and the same store, so what a row does — update the person it
 * matches, create one otherwise, never blank a field the file left empty —
 * is identical, and re-importing the file changes nothing the second time.
 *
 * The batch is still recorded, after the fact, so the import shows up in the
 * history with every row's outcome and the mapping that produced it.
 */

/** Staging rows per insert. Large enough to be few round-trips, small enough to be a modest statement. */
const WRITE_CHUNK = 200

/** The dialog has no field for it; the `/import` page does. */
const EXTERNAL_SOURCE = 'csv'

const mappingSchema = z.record(z.string(), z.string())

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function importContacts(
  _prev: ContactImportState,
  formData: FormData,
): Promise<ContactImportState> {
  const profile = await requireWriteAccess()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file to import.', fieldErrors: { file: 'Choose a CSV file' } }
  }
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return {
      error: 'That file is larger than 5 MB. Split it and import the parts.',
      fieldErrors: { file: 'File is too large' },
    }
  }

  let submitted: Record<string, string>
  try {
    submitted = mappingSchema.parse(JSON.parse(text(formData, 'mapping')))
  } catch {
    return { error: 'The column mapping could not be read. Close this dialog and try again.' }
  }

  const parsed = parseCsv(await file.text())
  if (parsed.headers.length === 0) {
    return { error: parsed.errors[0] ?? 'That file has no columns to read.' }
  }
  if (parsed.rows.length === 0) {
    return { error: 'That file has a header row but no data.' }
  }
  // A broken quote shifts every value after it into the wrong column, and the
  // file still looks importable. Refusing beats writing a garbled batch.
  if (parsed.errors.length > 0) {
    return { error: parsed.errors.join(' ') }
  }

  const resolved = resolveAssignments(submitted, parsed.headers, CONTACT_IMPORT_FIELDS)
  if (resolved.error !== undefined) return { error: resolved.error }
  const { fields, ignored } = resolved.mapping
  if (Object.keys(fields).length === 0) {
    return { error: 'Choose at least one column to import.' }
  }

  const supabase = await createClient()

  let plan: ContactImportPlan
  let applied: ApplyResult
  try {
    const index = await loadContactMatchIndex(
      supabase,
      collectContactKeys(parsed.rows, fields),
      EXTERNAL_SOURCE,
    )
    plan = planContactImport(parsed.rows, { fields, index, externalSource: EXTERNAL_SOURCE })
    const store = createContactStore(supabase, profile.id, EXTERNAL_SOURCE, index)
    applied = await applyContactRows(plan.rows, store, { externalSource: EXTERNAL_SOURCE })
  } catch (error) {
    return { error: `The file could not be imported. ${message(error)}` }
  }

  const outcomes = new Map(applied.rows.map((row) => [row.number, row]))

  const problems: ContactImportProblem[] = []
  for (const row of plan.rows) {
    const problem = outcomes.get(row.number)?.error ?? row.errors[0] ?? null
    if (problem !== null) problems.push({ row: row.number, message: problem })
  }

  const caveat = await recordBatch(supabase, {
    filename: file.name,
    actorId: profile.id,
    fields,
    ignored,
    truncated: parsed.truncated,
    plan,
    applied,
  })

  revalidatePath('/contacts')
  revalidatePath('/dashboard')
  revalidatePath('/import')

  return {
    result: {
      batchId: caveat.batchId,
      filename: file.name,
      total: plan.counts.total,
      created: applied.created,
      updated: applied.updated,
      skipped: plan.counts.skip,
      failed: plan.counts.error + applied.failed,
      problems: problems.slice(0, CONTACT_IMPORT_PROBLEM_LIMIT),
      problemCount: problems.length,
      truncated: parsed.truncated,
      caveat: caveat.message,
    },
  }
}

/**
 * Writes the batch and its rows the way the two-phase import would have left
 * them after a commit, so the history and the batch page need no special
 * case. The people are already written by the time this runs: a failure here
 * is reported as a caveat, never as a failed import.
 */
async function recordBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    filename: string
    actorId: string
    fields: Record<string, string>
    ignored: string[]
    truncated: boolean
    plan: ContactImportPlan
    applied: ApplyResult
  },
): Promise<{ batchId: string | null; message: string | null }> {
  const { plan, applied } = input
  const outcomes = new Map(applied.rows.map((row) => [row.number, row]))
  const written = applied.created + applied.updated

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      kind: 'contacts',
      filename: input.filename,
      status: written === 0 && applied.failed > 0 ? 'failed' : 'committed',
      total_rows: plan.counts.total,
      valid_rows: plan.counts.create + plan.counts.update,
      error_rows: plan.counts.error + applied.failed,
      created_rows: applied.created,
      updated_rows: applied.updated,
      skipped_rows: plan.counts.skip,
      column_mapping: { fields: input.fields, ignored: input.ignored },
      options: {
        external_source: EXTERNAL_SOURCE,
        truncated: input.truncated,
        planned: { ...plan.counts },
        // Distinguishes a dialog import from a reviewed one in the history.
        via: 'people',
      },
      error: applied.rows.find((row) => row.error !== null)?.error ?? null,
      created_by: input.actorId,
      committed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return {
      batchId: null,
      message: `The people were imported, but the import could not be added to the history. ${batchError?.message ?? ''}`.trim(),
    }
  }

  const rows = plan.rows.map((row) => {
    const outcome = outcomes.get(row.number)
    return {
      batch_id: batch.id,
      row_number: row.number,
      raw: row.raw as Json,
      normalized: { ...row.values, matched_by: row.matchedBy, contact_id: row.contactId } as Json,
      errors: outcome?.error ? [outcome.error] : row.errors,
      action: row.action,
      applied: outcome !== undefined && outcome.outcome !== 'failed',
      contact_id: outcome?.contactId ?? null,
    }
  })

  for (const batchRows of chunk(rows, WRITE_CHUNK)) {
    const { error } = await supabase.from('import_rows').insert(batchRows)
    if (error) {
      return {
        batchId: batch.id,
        message: `The people were imported, but the row-by-row record is incomplete. ${error.message}`,
      }
    }
  }

  return { batchId: batch.id, message: null }
}
