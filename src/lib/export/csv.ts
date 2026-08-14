import { format } from 'date-fns'
import { unparse } from 'papaparse'
import { EXPORT_PAGE_SIZE, type ExportPageReader, type ExportRow } from '@/lib/export/datasets'

/**
 * CSV writing for exports.
 *
 * Quoting is left to papaparse rather than hand-rolled, because the failure
 * mode of getting it wrong is silent: a value containing a comma, a quote or
 * a newline splits into extra columns, and the file still opens.
 */

/** RFC 4180's line ending. Every spreadsheet reads it; so does the importer. */
const CRLF = '\r\n'

/**
 * Excel decides a CSV is not UTF-8 unless it starts with a byte order mark,
 * and mangles every accented name. The import parser strips it again.
 */
const BYTE_ORDER_MARK = '﻿'

export function csvHeaderLine(columns: readonly string[]): string {
  return unparse([[...columns]], { newline: CRLF }) + CRLF
}

export function csvRowLines(columns: readonly string[], rows: readonly ExportRow[]): string {
  if (rows.length === 0) return ''
  return unparse([...rows], { columns: [...columns], header: false, newline: CRLF }) + CRLF
}

/** Whole document in memory — for tests and for anything already paged. */
export function csvDocument(columns: readonly string[], rows: readonly ExportRow[]): string {
  return csvHeaderLine(columns) + csvRowLines(columns, rows)
}

export function exportFilename(key: string, now: Date): string {
  return `grace-lead-management-${key.replace(/_/g, '-')}-${format(now, 'yyyy-MM-dd')}.csv`
}

/**
 * Streams a dataset a page at a time, so a large export never holds the whole
 * table in memory.
 *
 * The first page is read before the stream is handed back: once a 200 and its
 * headers have gone out, a failure can only truncate the download, and a
 * half-file that looks complete is worse than an error page.
 */
export async function createCsvStream(
  columns: readonly string[],
  read: ExportPageReader,
  pageSize: number = EXPORT_PAGE_SIZE,
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()
  const firstPage = await read(0, pageSize)

  let offset = firstPage.length
  let exhausted = firstPage.length < pageSize

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(BYTE_ORDER_MARK + csvHeaderLine(columns) + csvRowLines(columns, firstPage)),
      )
      if (exhausted) controller.close()
    },
    async pull(controller) {
      if (exhausted) {
        controller.close()
        return
      }
      const rows = await read(offset, pageSize)
      offset += rows.length
      if (rows.length > 0) controller.enqueue(encoder.encode(csvRowLines(columns, rows)))
      if (rows.length < pageSize) {
        exhausted = true
        controller.close()
      }
    },
  })
}
