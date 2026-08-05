/**
 * Header auto-mapping.
 *
 * Spreadsheets in the wild spell the same field a dozen ways — "First Name",
 * "first_name", "FIRSTNAME", "Given name". Headers and aliases are both
 * reduced to letters and digits before comparison, so casing, spacing and
 * punctuation stop mattering and the alias tables only have to carry
 * genuinely different words.
 */

export interface FieldDefinition<Field extends string> {
  field: Field
  /** How the field is named back to the operator in errors and the preview. */
  label: string
  aliases: readonly string[]
}

export type MappedColumn<Field extends string> = {
  header: string
  field: Field | null
  /** Why an unmapped column was ignored — shown so nothing looks arbitrary. */
  reason: 'unknown' | 'already-mapped' | null
}

export interface ColumnMapping<Field extends string> {
  /** Every header in the file's own order, mapped or not. */
  columns: MappedColumn<Field>[]
  /** The mapping that will actually be used: field → header. */
  fields: Record<string, string>
  ignored: string[]
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function buildMapping<Field extends string>(
  headers: readonly string[],
  definitions: readonly FieldDefinition<Field>[],
): ColumnMapping<Field> {
  const lookup = new Map<string, Field>()
  for (const definition of definitions) {
    // The field name and its label are aliases of themselves, which is what
    // lets a file exported from this CRM re-import without any configuration.
    for (const alias of [definition.field, definition.label, ...definition.aliases]) {
      const key = normalizeHeader(alias)
      if (key !== '' && !lookup.has(key)) lookup.set(key, definition.field)
    }
  }

  const columns: MappedColumn<Field>[] = []
  const fields: Record<string, string> = {}
  const ignored: string[] = []

  for (const header of headers) {
    const field = lookup.get(normalizeHeader(header)) ?? null
    if (field === null) {
      columns.push({ header, field: null, reason: 'unknown' })
      ignored.push(header)
      continue
    }
    if (field in fields) {
      // Two columns claiming one field: the first wins, because guessing
      // which of them the operator meant is worse than ignoring one visibly.
      columns.push({ header, field: null, reason: 'already-mapped' })
      ignored.push(header)
      continue
    }
    fields[field] = header
    columns.push({ header, field, reason: null })
  }

  return { columns, fields, ignored }
}

/**
 * Pulls the mapped cells out of a row, dropping empties.
 *
 * An empty cell is treated as "not supplied" rather than "set this to blank",
 * so a partial spreadsheet cannot wipe fields it never intended to carry.
 * Clearing a value stays a deliberate act in the UI.
 */
export function mapCells<Field extends string>(
  cells: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, string>>,
  definitions: readonly FieldDefinition<Field>[],
): Partial<Record<Field, string>> {
  const mapped: Partial<Record<Field, string>> = {}
  for (const definition of definitions) {
    const header = fields[definition.field]
    if (header === undefined) continue
    const value = cells[header]
    if (value === undefined) continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    mapped[definition.field] = trimmed
  }
  return mapped
}

export function fieldLabels<Field extends string>(
  definitions: readonly FieldDefinition<Field>[],
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const definition of definitions) labels[definition.field] = definition.label
  return labels
}
