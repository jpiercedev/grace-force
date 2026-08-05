import Link from 'next/link'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { CONTACT_IMPORT_FIELDS } from '@/lib/csv/contacts'
import { GIFT_IMPORT_FIELDS } from '@/lib/csv/gifts'
import {
  IMPORT_KIND_LABELS,
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_TONES,
  isImportKind,
} from '@/lib/csv/ui'
import { isAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime, pluralize } from '@/lib/utils'
import { startImport } from './actions'
import { ImportForm } from './import-form'

export const metadata = { title: 'Import' }

const HISTORY_LIMIT = 20

export default async function ImportPage() {
  const profile = await requireWriteAccess()
  const supabase = await createClient()

  const { data: batches } = await supabase
    .from('import_batches')
    .select(
      'id, kind, filename, status, total_rows, valid_rows, error_rows, created_rows, updated_rows, skipped_rows, created_at, committed_at',
    )
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Import"
        description="Bring contacts or giving history in from a spreadsheet, one reviewable batch at a time."
      />

      <ImportForm action={startImport} canImportGifts={isAdmin(profile)} />

      <Card>
        <CardHeader
          title="How matching works"
          description="Re-importing the same file changes nothing the second time."
        />
        <CardBody className="space-y-3 text-sm text-slate-600">
          <p>
            Each row is matched against what is already here — first by the CRM&rsquo;s own{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">id</code>, then by your
            external ID, then by email address. A match updates that record in place; anything
            unmatched is created.
          </p>
          <p>
            An empty cell means &ldquo;leave this as it is&rdquo;, never &ldquo;clear it&rdquo;, so a
            partial spreadsheet cannot wipe fields it does not carry. Duplicates inside the file
            itself are skipped rather than applied twice.
          </p>
        </CardBody>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RecognisedColumns
          title="Contact columns"
          fields={CONTACT_IMPORT_FIELDS.map((field) => field.label)}
        />
        <RecognisedColumns
          title="Giving columns"
          fields={GIFT_IMPORT_FIELDS.map((field) => field.label)}
        />
      </div>

      <Card>
        <CardHeader title="Past imports" description={`The ${HISTORY_LIMIT} most recent batches.`} />
        {!batches || batches.length === 0 ? (
          <EmptyState
            title="Nothing imported yet"
            description="Upload a CSV above and you will get a preview of exactly what it would do."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Past import batches</caption>
              <thead className="bg-slate-50">
                <tr>
                  <Th>File</Th>
                  <Th>Contains</Th>
                  <Th>State</Th>
                  <Th align="right">Rows</Th>
                  <Th>Outcome</Th>
                  <Th>Uploaded</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((batch) => (
                  <tr key={batch.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/import/${batch.id}`}
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                      >
                        {batch.filename ?? 'Untitled file'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {isImportKind(batch.kind) ? IMPORT_KIND_LABELS[batch.kind] : batch.kind}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={IMPORT_STATUS_TONES[batch.status]}>
                        {IMPORT_STATUS_LABELS[batch.status]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {batch.total_rows.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {batch.committed_at
                        ? `${batch.created_rows} created · ${batch.updated_rows} updated`
                        : `${batch.valid_rows} ready · ${batch.error_rows} with errors`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      <time dateTime={batch.created_at}>{formatDateTime(batch.created_at)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function RecognisedColumns({ title, fields }: { title: string; fields: string[] }) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={`${pluralize(fields.length, 'field')} matched by name, ignoring case, spacing and punctuation.`}
      />
      <CardBody>
        <ul className="flex flex-wrap gap-1.5">
          {fields.map((field) => (
            <li key={field}>
              <Badge tone="slate">{field}</Badge>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}
