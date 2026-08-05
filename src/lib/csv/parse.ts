import { parse } from 'papaparse'

/**
 * CSV reading for imports.
 *
 * Rows are keyed by their header text rather than by position, because the
 * mapping layer works in field names and an operator reorders columns in a
 * spreadsheet without thinking about it.
 *
 * Parsing is deliberately tolerant of what real files contain — a byte order
 * mark from Excel, CRLF line endings, quoted commas and newlines inside a
 * cell, and the blank line almost every editor leaves at the end — and
 * intolerant of nothing except an entirely empty file.
 */

export interface CsvRow {
  /**
   * 1-based position among the data rows, header excluded. Blank lines are
   * dropped before numbering, so this is what the preview counts, not the
   * line number in the file.
   */
  number: number
  cells: Record<string, string>
}

export interface ParsedCsv {
  headers: string[]
  rows: CsvRow[]
  /** Repeated header text; only the first column with a given name is read. */
  duplicateHeaders: string[]
  /** True when the file held more data rows than `maxRows`. */
  truncated: boolean
  /** Structural problems worth showing the operator, not per-cell validation. */
  errors: string[]
}

/**
 * Ceiling on one import. Committing resolves existing records with chunked
 * `in` filters, so the cost of a batch is super-linear in practice; a file
 * larger than this is better split than left to time out half-applied.
 */
export const MAX_IMPORT_ROWS = 5_000

const BYTE_ORDER_MARK = '﻿'

export function parseCsv(text: string, options: { maxRows?: number } = {}): ParsedCsv {
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS
  // Excel writes a BOM on "CSV UTF-8"; left in place it becomes part of the
  // first header, and every mapping against that column silently fails.
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text

  const result = parse<string[]>(body, { skipEmptyLines: 'greedy' })

  const [headerRow, ...dataRows] = result.data
  if (!headerRow || headerRow.every((cell) => cell.trim() === '')) {
    return {
      headers: [],
      rows: [],
      duplicateHeaders: [],
      truncated: false,
      errors: ['That file has no header row, so there is nothing to map.'],
    }
  }

  const headers: string[] = []
  const duplicateHeaders: string[] = []
  const seen = new Set<string>()
  for (const raw of headerRow) {
    const header = raw.trim()
    if (header === '') {
      // Keeps column positions aligned; an unnamed column maps to nothing.
      headers.push('')
      continue
    }
    if (seen.has(header)) {
      duplicateHeaders.push(header)
      headers.push('')
      continue
    }
    seen.add(header)
    headers.push(header)
  }

  const rows: CsvRow[] = []
  for (const cells of dataRows) {
    if (rows.length >= maxRows) break
    const record: Record<string, string> = {}
    for (const [index, header] of headers.entries()) {
      if (header === '') continue
      record[header] = (cells[index] ?? '').trim()
    }
    rows.push({ number: rows.length + 1, cells: record })
  }

  return {
    headers: headers.filter((header) => header !== ''),
    rows,
    duplicateHeaders,
    truncated: dataRows.length > rows.length,
    errors: structuralErrors(result.errors),
  }
}

/**
 * Ragged rows are normal — a trailing empty column, a short last line — and
 * are already handled by filling with ''. Only a broken quote actually
 * corrupts the reading, so that is all the operator is told about.
 */
function structuralErrors(errors: readonly { code: string; message: string; row?: number }[]): string[] {
  const messages: string[] = []
  for (const error of errors) {
    if (error.code !== 'MissingQuotes' && error.code !== 'InvalidQuotes') continue
    const where = typeof error.row === 'number' ? ` near row ${error.row + 1}` : ''
    messages.push(`A quoted value is not closed${where}. Check for a stray " in the file.`)
    if (messages.length >= 3) break
  }
  return messages
}
