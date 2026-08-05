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
