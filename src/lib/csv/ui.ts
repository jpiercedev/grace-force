import type { BadgeTone } from '@/components/ui/display'
import type { ImportAction } from '@/lib/csv/types'
import type { ImportStatus } from '@/types/database'

/** Shared between the import screens and the server actions behind them. */

export type ImportKind = 'contacts' | 'gifts'

export const IMPORT_KINDS = ['contacts', 'gifts'] as const satisfies readonly ImportKind[]

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  contacts: 'Contacts',
  gifts: 'Giving history',
}

export interface ImportActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

/** Tone is paired with the label everywhere it is used; colour never stands alone. */
export const IMPORT_ACTION_TONES: Record<ImportAction, BadgeTone> = {
  create: 'emerald',
  update: 'sky',
  skip: 'zinc',
  error: 'red',
}

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  pending: 'Awaiting commit',
  validated: 'Validated',
  committed: 'Committed',
  failed: 'Failed',
}

export const IMPORT_STATUS_TONES: Record<ImportStatus, BadgeTone> = {
  pending: 'amber',
  validated: 'sky',
  committed: 'emerald',
  failed: 'red',
}

export function isImportKind(value: string): value is ImportKind {
  return value === 'contacts' || value === 'gifts'
}

/** Bounded so a runaway upload cannot exhaust the request's memory. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024

/**
 * Row problems shown inside the People-tab import dialog. Enough to see what
 * kind of thing went wrong; the batch record holds the rest.
 */
export const CONTACT_IMPORT_PROBLEM_LIMIT = 20

export interface ContactImportProblem {
  row: number
  message: string
}

export interface ContactImportResult {
  /** Null only when the records were written but the audit record could not be. */
  batchId: string | null
  filename: string
  total: number
  created: number
  updated: number
  /** Rows a row earlier in the same file already covered. */
  skipped: number
  /** Rows that failed validation or could not be written. */
  failed: number
  /** In file order, capped at `CONTACT_IMPORT_PROBLEM_LIMIT`; `problemCount` is the true number. */
  problems: ContactImportProblem[]
  problemCount: number
  /** The file held more than `MAX_IMPORT_ROWS`, and only the first that many were read. */
  truncated: boolean
  /** The people were written but the batch record is missing or incomplete. */
  caveat: string | null
}

export interface ContactImportState {
  error?: string
  fieldErrors?: Record<string, string>
  result?: ContactImportResult
}
