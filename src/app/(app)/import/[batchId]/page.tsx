import { notFound } from 'next/navigation'
import { z } from 'zod'
import { LinkButton } from '@/components/ui/button'
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/display'
import { CONTACT_IMPORT_FIELDS } from '@/lib/csv/contacts'
import { GIFT_IMPORT_FIELDS } from '@/lib/csv/gifts'
import { fieldLabels } from '@/lib/csv/mapping'
import { IMPORT_ACTIONS, IMPORT_ACTION_LABELS, type ImportAction } from '@/lib/csv/types'
import {
  IMPORT_ACTION_TONES,
  IMPORT_KIND_LABELS,
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_TONES,
  isImportKind,
  type ImportKind,
} from '@/lib/csv/ui'
import { isAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { cn, formatCurrency, formatDateTime, pluralize } from '@/lib/utils'
import { commitImport, discardImport } from '../actions'
import { CommitPanel } from './commit-panel'

export const metadata = { title: 'Import preview' }

/** Enough to see the shape of a file without turning the page into the file. */
const PREVIEW_LIMIT = 25

const mappingSchema = z.object({
  fields: z.record(z.string(), z.string()),
  ignored: z.array(z.string()).default([]),
})

const errorsSchema = z.array(z.string())

const plannedSchema = z.object({
  planned: z.object({ create: z.number(), update: z.number() }).optional(),
})

const summarySchema = z
  .object({
    first_name: z.string(),
    last_name: z.string(),
    organization_name: z.string(),
    email: z.string(),
    amount_cents: z.number(),
    amount: z.number(),
    currency: z.string(),
    given_on: z.string(),
    contact_email: z.string(),
    contact_external_id: z.string(),
    external_id: z.string(),
  })
  .partial()
  .passthrough()

function isAction(value: string): value is ImportAction {
  return (IMPORT_ACTIONS as readonly string[]).includes(value)
}

/** A one-line "who or what is this row about", so a preview reads as records. */
function summarise(kind: ImportKind, normalized: unknown): string {
  const parsed = summarySchema.safeParse(normalized)
  if (!parsed.success) return '—'
  const values = parsed.data

  if (kind === 'contacts') {
    const name = [values.first_name, values.last_name].filter(Boolean).join(' ').trim()
    return name || values.organization_name || values.email || values.external_id || '—'
  }

  const cents = values.amount_cents ?? values.amount
  const parts = [
    cents === undefined ? null : formatCurrency(cents, values.currency ?? 'USD'),
    values.given_on ?? null,
    values.contact_email ?? values.contact_external_id ?? null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const profile = await requireWriteAccess()
  const { batchId } = await params
  const supabase = await createClient()

  const { data: batch } = await supabase
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle()

  // Row Level Security also hides a batch this person may not read, which is
  // indistinguishable from one that never existed — and should be.
  if (!batch || !isImportKind(batch.kind)) notFound()

  const [{ data: previewRows }, { data: errorRows }] = await Promise.all([
    supabase
      .from('import_rows')
      .select('id, row_number, action, errors, normalized')
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true })
      .limit(PREVIEW_LIMIT),
    supabase
      .from('import_rows')
      .select('id, row_number, errors, normalized')
      .eq('batch_id', batchId)
      .eq('action', 'error')
      .order('row_number', { ascending: true })
      .limit(PREVIEW_LIMIT),
  ])

  const mapping = mappingSchema.safeParse(batch.column_mapping)
  const planned = plannedSchema.safeParse(batch.options).data?.planned
  const labels = fieldLabels(batch.kind === 'contacts' ? CONTACT_IMPORT_FIELDS : GIFT_IMPORT_FIELDS)
  const kindLabel = IMPORT_KIND_LABELS[batch.kind]
  // A failed batch also carries `committed_at`, but its rows are still
  // waiting, so only a genuine commit closes the panel.
  const committed = batch.status === 'committed'
  const giftsBlocked = batch.kind === 'gifts' && !isAdmin(profile)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={batch.filename ?? 'Untitled file'}
        description={
          <>
            {kindLabel} · uploaded{' '}
            <time dateTime={batch.created_at}>{formatDateTime(batch.created_at)}</time> ·{' '}
            {pluralize(batch.total_rows, 'row')}
          </>
        }
        action={
          <>
            <Badge tone={IMPORT_STATUS_TONES[batch.status]}>
              {IMPORT_STATUS_LABELS[batch.status]}
            </Badge>
            <LinkButton href="/import" variant="secondary" size="sm">
              All imports
            </LinkButton>
          </>
        }
      />

      {/* One quiet band of serif figures — what the batch will do (or did),
          readable at a glance rather than four identical widgets. */}
      <Card>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 px-5 py-5 sm:px-6 lg:grid-cols-4">
          <BatchFigure
            label={committed ? 'Created' : 'To create'}
            value={committed ? batch.created_rows : (planned?.create ?? batch.valid_rows)}
            hint="No existing record matched"
            tone="emerald"
          />
          <BatchFigure
            label={committed ? 'Updated' : 'To update'}
            value={committed ? batch.updated_rows : (planned?.update ?? 0)}
            hint="Matched a record already here"
            tone="brand"
          />
          <BatchFigure label="Skipped" value={batch.skipped_rows} hint="Duplicated inside the file" />
          <BatchFigure
            label="Errors"
            value={batch.error_rows}
            hint="Left alone until the file is fixed"
            tone={batch.error_rows > 0 ? 'red' : undefined}
          />
        </dl>
      </Card>

      {batch.error ? (
        <Callout tone="danger" title="This import reported a problem" role="alert">
          {batch.error}
        </Callout>
      ) : null}

      {committed ? (
        <Callout tone="success" title="Applied" role="status">
          Committed{' '}
          <time dateTime={batch.committed_at ?? undefined}>
            {formatDateTime(batch.committed_at)}
          </time>
          . Re-uploading the same file would now match every row and change nothing.
        </Callout>
      ) : (
        <CommitPanel
          batchId={batch.id}
          commitAction={commitImport}
          discardAction={discardImport}
          validRows={batch.valid_rows}
          errorRows={batch.error_rows}
          blockedReason={
            giftsBlocked ? 'Only an administrator can write giving records.' : null
          }
        />
      )}

      <Card>
        <CardHeader
          title="Column mapping"
          description="How each column in the file was read. Nothing else was looked at."
        />
        {!mapping.success ? (
          <EmptyState
            title="Column mapping unavailable"
            description="This batch was staged in a format this version cannot display. The rows themselves are unaffected."
          />
        ) : (
          <CardBody className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">Columns in the file and the fields they filled</caption>
                <thead>
                  <tr>
                    <Th>Column in the file</Th>
                    <Th>Field it filled</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(mapping.data.fields).map(([field, header]) => (
                    <tr key={field} className="transition-colors hover:bg-slate-100/60">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{header}</td>
                      <td className="px-3 py-2.5 text-slate-600">{labels[field] ?? field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mapping.data.ignored.length > 0 ? (
              <p className="text-xs text-slate-500">
                Ignored: {mapping.data.ignored.join(', ')}. Nothing in these columns was read.
              </p>
            ) : null}
          </CardBody>
        )}
      </Card>

      {errorRows && errorRows.length > 0 ? (
        <Card>
          <CardHeader
            title="Rows that need fixing"
            description={
              batch.error_rows > errorRows.length
                ? `The first ${errorRows.length} of ${batch.error_rows.toLocaleString()}.`
                : pluralize(errorRows.length, 'row')
            }
          />
          <ul className="divide-y divide-slate-100">
            {errorRows.map((row) => (
              <li key={row.id} className="px-5 py-3.5">
                <p className="text-sm font-semibold text-slate-900">
                  Row {row.row_number} · {summarise(batch.kind, row.normalized)}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
                  {(errorsSchema.safeParse(row.errors).data ?? ['Could not be read']).map(
                    (messageText, position) => (
                      <li key={position}>{messageText}</li>
                    ),
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Preview"
          // "The first 0 of 240 rows" is nonsense — with nothing staged the
          // empty state below explains, and the header stays quiet.
          description={
            !previewRows || previewRows.length === 0
              ? undefined
              : batch.total_rows > previewRows.length
                ? `The first ${previewRows.length} of ${batch.total_rows.toLocaleString()} rows.`
                : pluralize(previewRows.length, 'row')
          }
        />
        {!previewRows || previewRows.length === 0 ? (
          <EmptyState
            title="No rows were staged"
            description="There are no staged rows to preview for this batch."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">The first rows of the file and what each will do</caption>
              <thead>
                <tr>
                  <Th align="right" className="pl-5">
                    Row
                  </Th>
                  <Th>Will do</Th>
                  <Th>Record</Th>
                  <Th className="pr-5">Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-slate-100/60">
                    <td className="whitespace-nowrap py-3 pl-5 pr-3 text-right tabular-nums text-slate-500">
                      {row.row_number}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {isAction(row.action) ? (
                        <Badge tone={IMPORT_ACTION_TONES[row.action]}>
                          {IMPORT_ACTION_LABELS[row.action]}
                        </Badge>
                      ) : (
                        row.action
                      )}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {summarise(batch.kind, row.normalized)}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-slate-600">
                      {(errorsSchema.safeParse(row.errors).data ?? []).join(' ') || '—'}
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

/** Label eyebrow + serif figure + one hint line; tone only when it means something. */
function BatchFigure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint: string
  tone?: 'emerald' | 'brand' | 'red'
}) {
  const dots = { emerald: 'bg-emerald-500', brand: 'bg-brand-500', red: 'bg-red-600' }
  const figures = { emerald: 'text-emerald-800', brand: 'text-brand-700', red: 'text-red-700' }
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {tone ? (
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dots[tone])} />
        ) : null}
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1.5 font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums',
          tone ? figures[tone] : 'text-slate-900',
        )}
      >
        {value.toLocaleString()}
      </dd>
      <dd className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</dd>
    </div>
  )
}

function Th({
  children,
  align,
  className,
}: {
  children: React.ReactNode
  align?: 'right'
  className?: string
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}
