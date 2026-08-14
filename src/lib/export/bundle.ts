import {
  EXPORT_DATASETS,
  type ExportClient,
  type ExportDataset,
  type ExportDatasetKey,
  type ExportPageReader,
  type ExportRow,
} from '@/lib/export/datasets'

/**
 * The whole dataset, taken elsewhere with its relationships intact.
 *
 * Grace owns this data. Analysis in a spreadsheet, a backup on someone
 * else's disk, a hand-off to an accountant — none of that should require this
 * application to still be running, or anyone to reverse-engineer how it
 * stores things.
 *
 * Three properties make the CSVs stand on their own:
 *
 *  - every row carries its own `id`, the same uuid the record has always had
 *    and will keep for as long as it exists;
 *  - every child row carries its parents' ids in plainly named `contact_id` /
 *    `engagement_id` columns, so the graph rebuilds from the files alone;
 *  - the datasets are listed in dependency order, so re-importing them in
 *    that order never asks for a parent that has not arrived yet.
 */

export const MANIFEST_KEY = 'manifest'

export const MANIFEST_COLUMNS = [
  'dataset',
  'label',
  'row_count',
  'columns',
  'references',
  'endpoint',
] as const

export const MANIFEST_LABEL = 'Manifest'

export const MANIFEST_DESCRIPTION =
  'One row per dataset: how many records it holds, what its columns are, and which datasets it points at.'

export interface ExportAccess {
  canViewGiving: boolean
}

/**
 * Already in dependency order — `EXPORT_DATASETS` is defined that way, and
 * this is the assertion that keeps it honest.
 */
export const BUNDLE_DATASETS: readonly ExportDataset[] = EXPORT_DATASETS

/** Datasets this person may actually download; the rest would return nothing. */
export function availableDatasets(access: ExportAccess): ExportDataset[] {
  return BUNDLE_DATASETS.filter(
    (dataset) => dataset.requires !== 'giving' || access.canViewGiving,
  )
}

export function exportEndpoint(key: string): string {
  return `/api/export/${key}`
}

export interface ManifestEntry {
  dataset: ExportDataset
  rowCount: number
}

export function manifestRows(entries: readonly ManifestEntry[]): ExportRow[] {
  return entries.map(({ dataset, rowCount }) => ({
    dataset: dataset.key,
    label: dataset.label,
    row_count: rowCount,
    columns: dataset.columns.join(', '),
    references: dataset.references.join(', '),
    endpoint: exportEndpoint(dataset.key),
  }))
}

export async function countDatasets(
  db: ExportClient,
  datasets: readonly ExportDataset[],
): Promise<ManifestEntry[]> {
  const counts = await Promise.all(datasets.map((dataset) => dataset.countRows(db)))
  return datasets.map((dataset, index) => ({ dataset, rowCount: counts[index] ?? 0 }))
}

/**
 * The manifest is one short page rather than a table read, so it satisfies
 * the same reader contract by returning everything first and nothing after.
 */
export async function createManifestReader(
  db: ExportClient,
  datasets: readonly ExportDataset[],
): Promise<ExportPageReader> {
  const rows = manifestRows(await countDatasets(db, datasets))
  return async (offset) => (offset === 0 ? rows : [])
}

/**
 * The datasets a given one depends on having been loaded first. Used to
 * explain the order on screen rather than leaving it to be inferred.
 */
export function dependencyLabels(dataset: ExportDataset): string[] {
  const labels = new Map<ExportDatasetKey, string>(
    BUNDLE_DATASETS.map((entry) => [entry.key, entry.label]),
  )
  return dataset.references.map((key) => labels.get(key) ?? key)
}
