import { buttonClasses } from '@/components/ui/button'
import { Badge, Callout, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display'
import {
  MANIFEST_DESCRIPTION,
  MANIFEST_KEY,
  MANIFEST_LABEL,
  availableDatasets,
  dependencyLabels,
  exportEndpoint,
} from '@/lib/export/bundle'
import type { ExportDataset } from '@/lib/export/datasets'
import { canViewGiving, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { pluralize } from '@/lib/utils'

export const metadata = { title: 'Export' }

export default async function ExportPage() {
  const profile = await requireWriteAccess()
  const access = { canViewGiving: canViewGiving(profile) }
  const datasets = availableDatasets(access)
  const supabase = await createClient()

  // A count is a convenience, not the point of the page: if one fails the
  // downloads still work, so the number simply goes missing.
  const counts = await Promise.all(
    datasets.map(async (dataset) => {
      try {
        return await dataset.countRows(supabase)
      } catch {
        return null
      }
    }),
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Export"
        description="Every dataset as CSV, with the relationships between them intact."
      />

      <Callout tone="info" title="These files stand on their own">
        Every row carries its own <code className="font-mono text-xs">id</code> — the same one it
        has had since it was created — and every child row carries its parent&rsquo;s id in a plain{' '}
        <code className="font-mono text-xs">contact_id</code> or{' '}
        <code className="font-mono text-xs">engagement_id</code> column. A spreadsheet, a database
        or a script can rebuild the whole picture from the CSVs alone.
      </Callout>

      {/* Sits directly above the list it qualifies, so someone scanning the
          datasets for giving sees why it is missing without scrolling on. */}
      {access.canViewGiving ? null : (
        <Callout tone="warning" title="Giving history is not included">
          Exporting gifts needs the giving permission, which your account does not have. An
          administrator can grant it or run that export for you.
        </Callout>
      )}

      <Card>
        <CardHeader
          title="Datasets"
          description="Listed in the order they depend on each other. Load contacts first; everything else points back at them."
        />
        <ul className="divide-y divide-slate-100">
          {datasets.map((dataset, index) => (
            <DatasetRow key={dataset.key} dataset={dataset} rowCount={counts[index] ?? null} />
          ))}
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-slate-100/60">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{MANIFEST_LABEL}</p>
              <p className="mt-0.5 text-sm text-slate-600">{MANIFEST_DESCRIPTION}</p>
            </div>
            <a
              href={exportEndpoint(MANIFEST_KEY)}
              download
              aria-label={`Download the ${MANIFEST_LABEL.toLowerCase()} as CSV`}
              className={buttonClasses('secondary', 'md')}
            >
              Download CSV
            </a>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Why the order matters" />
        <CardBody className="space-y-3 text-sm text-slate-600">
          <p>
            An engagement points at a contact; an activity points at a contact and sometimes at an
            engagement or a pipeline card. Load them the other way round and half the references
            name records that are not there yet.
          </p>
          <p>
            Re-importing follows the same rule: bring contacts back first, and every child row will
            find the parent it names. The manifest lists each dataset&rsquo;s columns and the
            datasets it references, so nothing has to be inferred from the files themselves.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function DatasetRow({ dataset, rowCount }: { dataset: ExportDataset; rowCount: number | null }) {
  const references = dependencyLabels(dataset)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-slate-100/60">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          {dataset.label}
          {dataset.requires === 'giving' ? (
            <span className="ml-2 align-middle">
              <Badge tone="amber">Giving access</Badge>
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">{dataset.description}</p>
        <p className="mt-1 text-xs tabular-nums text-slate-500">
          {rowCount === null ? 'Row count unavailable' : pluralize(rowCount, 'row')} ·{' '}
          {pluralize(dataset.columns.length, 'column')}
          {references.length > 0 ? ` · references ${references.join(' and ')}` : ' · references nothing'}
        </p>
      </div>
      <a
        href={exportEndpoint(dataset.key)}
        download
        aria-label={`Download ${dataset.label.toLowerCase()} as CSV`}
        className={buttonClasses('secondary', 'md')}
      >
        Download CSV
      </a>
    </li>
  )
}
