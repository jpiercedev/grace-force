import { NextResponse, type NextRequest } from 'next/server'
import {
  MANIFEST_COLUMNS,
  MANIFEST_KEY,
  availableDatasets,
  createManifestReader,
} from '@/lib/export/bundle'
import { createCsvStream, exportFilename } from '@/lib/export/csv'
import { findExportDataset, type ExportPageReader } from '@/lib/export/datasets'
import { canViewGiving, canWrite, getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * CSV downloads, one dataset per request.
 *
 * The query runs through the caller's own Supabase client, so an export can
 * never contain a row the interface would have hidden: Row Level Security is
 * the same boundary here as everywhere else, and the checks below only decide
 * how the refusal is phrased.
 *
 * Rows are streamed a page at a time. A ministry's whole timeline does not
 * belong in one server's memory just because someone clicked "download".
 */

export const dynamic = 'force-dynamic'

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<Response> {
  const profile = await getCurrentProfile()
  if (!profile || !profile.is_active) return refuse(401, 'Sign in to export data.')
  // Mirrors the navigation, which offers exports to staff and admins only.
  if (!canWrite(profile)) return refuse(403, 'Your role does not include exporting data.')

  const { dataset: key } = await params
  const supabase = await createClient()
  const access = { canViewGiving: canViewGiving(profile) }

  let columns: readonly string[]
  let read: ExportPageReader

  if (key === MANIFEST_KEY) {
    columns = MANIFEST_COLUMNS
    read = await createManifestReader(supabase, availableDatasets(access))
  } else {
    const dataset = findExportDataset(key)
    if (!dataset) return refuse(404, 'There is no dataset by that name.')
    if (dataset.requires === 'giving' && !access.canViewGiving) {
      return refuse(403, 'Giving records need the giving permission.')
    }
    columns = dataset.columns
    read = await dataset.createReader(supabase)
  }

  let body: ReadableStream<Uint8Array>
  try {
    body = await createCsvStream(columns, read)
  } catch (error) {
    // Nothing has been sent yet, so this can still be an honest failure
    // rather than a truncated file that looks like the whole export.
    return refuse(500, error instanceof Error ? error.message : 'The export could not be read.')
  }

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(key, new Date())}"`,
      // Exports are a point-in-time snapshot of data the caller is entitled
      // to; no shared cache should ever hold one.
      'cache-control': 'no-store, private',
    },
  })
}
