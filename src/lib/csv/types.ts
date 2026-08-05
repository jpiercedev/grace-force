/** Shapes shared by both importers and by the screens that render them. */

export type ImportAction = 'create' | 'update' | 'skip' | 'error'

export const IMPORT_ACTIONS = ['create', 'update', 'skip', 'error'] as const

export interface ImportCounts {
  total: number
  create: number
  update: number
  skip: number
  error: number
}

export const IMPORT_ACTION_LABELS: Record<ImportAction, string> = {
  create: 'New',
  update: 'Update',
  skip: 'Skipped',
  error: 'Error',
}

export const IMPORT_ACTION_DESCRIPTIONS: Record<ImportAction, string> = {
  create: 'No existing record matched, so one will be created.',
  update: 'Matched an existing record, which will be updated in place.',
  skip: 'A row earlier in the file already covers this record.',
  error: 'Something in the row has to be fixed before it can be applied.',
}

export function countActions(rows: readonly { action: ImportAction }[]): ImportCounts {
  const counts: ImportCounts = { total: rows.length, create: 0, update: 0, skip: 0, error: 0 }
  for (const row of rows) counts[row.action] += 1
  return counts
}
