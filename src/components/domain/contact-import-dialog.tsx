'use client'

import { Upload } from 'lucide-react'
import Link from 'next/link'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog, type DialogController } from '@/components/ui/dialog'
import { Callout } from '@/components/ui/display'
import { Field, Input, Select } from '@/components/ui/form'
import {
  CONTACT_IMPORT_FIELDS,
  mapContactColumns,
  type ContactImportField,
} from '@/lib/csv/contacts'
import {
  assignmentsFromMapping,
  conflictingAssignments,
  type ColumnAssignments,
} from '@/lib/csv/mapping'
import { MAX_IMPORT_ROWS, parseCsv, type CsvRow } from '@/lib/csv/parse'
import {
  IMPORT_MAX_FILE_BYTES,
  type ContactImportResult,
  type ContactImportState,
} from '@/lib/csv/ui'
import { pluralize } from '@/lib/utils'

/**
 * "Import CSV" on the People tab: choose a file, match its columns to People
 * fields, import.
 *
 * Three decisions shape it:
 *
 * 1. **The file is read in the browser.** Parsing happens here so the mapping
 *    step can show real column names and real example values without a round
 *    trip, and so a file with a broken quote is refused before anyone has
 *    mapped anything. The server parses it again with the same code; the
 *    mapping refers to headers, and the same bytes give the same headers.
 * 2. **The auto-mapping is a suggestion.** Every column gets a select,
 *    pre-set to the field its heading looked like. Two columns cannot feed
 *    one field — the screen says which two and waits, because silently
 *    dropping one is how a phone number lands in the wrong column.
 * 3. **There is no `<form>`.** React resets a form's controls once its action
 *    completes, error or not: an uncontrolled file picker is emptied, and a
 *    controlled `<select>` snaps back to its first option because React never
 *    marks the chosen one as the default. After a server error that would
 *    turn "try again" into "find the file and redo the mapping". So the file
 *    and the mapping live in state, and Import builds the FormData itself.
 */

type Step = 'upload' | 'map' | 'done'

interface ParsedFile {
  file: File
  headers: string[]
  rows: CsvRow[]
  truncated: boolean
}

const NAME_FIELDS: readonly ContactImportField[] = ['first_name', 'last_name', 'organization_name']

/** How many rows to look through for an example value per column. */
const SAMPLE_DEPTH = 25

// The browser-default bezel button clashes with the design system; file:
// modifiers restyle it without a custom picker, and the dashed tint makes the
// drop target read as a place.
const FILE_INPUT_CLASSES =
  'cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50/60 py-4 shadow-none ring-0 transition-colors sm:py-4 hover:border-brand-400 hover:bg-brand-50/40 file:mr-3.5 file:cursor-pointer file:rounded-md file:border-0 file:bg-white file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-brand-800 file:shadow-sm hover:file:bg-brand-50'

/** `File.text()` is missing from jsdom, and `FileReader` is everywhere. */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

function sampleValue(rows: readonly CsvRow[], header: string): string {
  for (const row of rows.slice(0, SAMPLE_DEPTH)) {
    const value = row.cells[header]
    if (value) return value
  }
  return ''
}

export function ContactImportDialog({
  action,
  variant = 'secondary',
  size = 'md',
}: {
  action: (state: ContactImportState, formData: FormData) => Promise<ContactImportState>
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}) {
  const dialog = useDialog()

  return (
    <>
      <Button
        ref={dialog.triggerRef}
        type="button"
        variant={variant}
        size={size}
        onClick={dialog.openDialog}
      >
        <Upload aria-hidden="true" className="h-4 w-4" />
        Import CSV
      </Button>
      {/* Mounted per opening so every state — step, file, mapping, the last
          import's result — starts from nothing each time. */}
      {dialog.open ? <ImportPanel controller={dialog} action={action} /> : null}
    </>
  )
}

function ImportPanel({
  controller,
  action,
}: {
  controller: DialogController
  action: (state: ContactImportState, formData: FormData) => Promise<ContactImportState>
}) {
  const [state, dispatch, pending] = useActionState<ContactImportState, FormData>(action, {})
  const [step, setStep] = useState<Step>('upload')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<ColumnAssignments<ContactImportField>>({})
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Picking a second file while the first is still being read must not let
  // the slower read win.
  const readSequence = useRef(0)

  useEffect(() => {
    if (state.result) setStep('done')
  }, [state.result])

  // The dialog focuses its first control on open; each later step moves
  // focus to its own heading so a keyboard user hears where they are, rather
  // than landing on whatever the browser picks once the old button is gone.
  useEffect(() => {
    if (step !== 'upload') headingRef.current?.focus()
  }, [step])

  const conflicts = useMemo(() => conflictingAssignments(assignments), [assignments])
  const mappedFields = useMemo(
    () => Object.values(assignments).filter((field): field is ContactImportField => field !== null),
    [assignments],
  )
  const hasNameColumn = mappedFields.some((field) => NAME_FIELDS.includes(field))
  const canImport = parsed !== null && mappedFields.length > 0 && conflicts.size === 0

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    const sequence = ++readSequence.current
    setParsed(null)
    setFileError(null)
    if (!chosen) return

    if (chosen.size > IMPORT_MAX_FILE_BYTES) {
      setFileError('That file is larger than 5 MB. Split it and import the parts.')
      return
    }

    let text: string
    try {
      text = await readFileText(chosen)
    } catch {
      if (sequence === readSequence.current) setFileError('That file could not be read.')
      return
    }
    if (sequence !== readSequence.current) return

    const result = parseCsv(text)
    if (result.headers.length === 0) {
      setFileError(result.errors[0] ?? 'That file has no columns to read.')
      return
    }
    if (result.rows.length === 0) {
      setFileError('That file has a header row but no data.')
      return
    }
    if (result.errors.length > 0) {
      setFileError(result.errors.join(' '))
      return
    }

    setParsed({
      file: chosen,
      headers: result.headers,
      rows: result.rows,
      truncated: result.truncated,
    })
    setAssignments(assignmentsFromMapping(mapContactColumns(result.headers)))
  }

  function submit() {
    if (!parsed) return
    const mapping: Record<string, string> = {}
    for (const header of parsed.headers) mapping[header] = assignments[header] ?? ''
    const formData = new FormData()
    formData.set('file', parsed.file, parsed.file.name)
    formData.set('mapping', JSON.stringify(mapping))
    startTransition(() => dispatch(formData))
  }

  const rowCount = parsed?.rows.length ?? 0

  return (
    <Dialog
      controller={controller}
      title="Import people from a CSV"
      description="Choose a file, match its columns to People fields, then import."
      wide
      footer={
        step === 'upload' ? (
          <>
            <Button type="button" onClick={() => setStep('map')} disabled={parsed === null}>
              Next: match columns
            </Button>
            <Button type="button" variant="ghost" onClick={controller.close}>
              Cancel
            </Button>
          </>
        ) : step === 'map' ? (
          <>
            <Button type="button" onClick={submit} disabled={!canImport || pending}>
              {pending ? 'Importing…' : `Import ${pluralize(rowCount, 'row')}`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setStep('upload')}
            >
              Back
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={controller.close}>
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" onClick={controller.close}>
            Done
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {/* The picker stays mounted across steps so going back does not lose
            the choice; `hidden` keeps it out of the tab order. */}
        <section hidden={step !== 'upload'} className="space-y-4">
          <StepHeading ref={headingRef} step={1} title="Choose a file" />
          <Field
            label="CSV file"
            hint="Up to 5 MB and 5,000 rows, with column headings in the first row. Dates are read month-first, so 03/04/2026 is 4 March."
            error={fileError ?? state.fieldErrors?.file}
            required
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                accept=".csv,text/csv"
                onChange={onFileChange}
                className={FILE_INPUT_CLASSES}
              />
            )}
          </Field>
          {parsed ? (
            <p className="text-sm text-slate-700" role="status">
              <span className="font-medium text-slate-900">{parsed.file.name}</span> ·{' '}
              {pluralize(parsed.headers.length, 'column')} · {pluralize(parsed.rows.length, 'row')}
            </p>
          ) : null}
          {parsed?.truncated ? (
            <Callout tone="warning" title="Only part of this file will be imported">
              A single import reads the first {MAX_IMPORT_ROWS.toLocaleString()} rows. Split the
              file and import the rest separately.
            </Callout>
          ) : null}
          <p className="text-sm text-slate-600">
            Nothing is written until you click Import. A row whose email, Contact ID or External
            ID matches someone already here updates that person; every other row adds a new one.
          </p>
        </section>

        {step === 'map' && parsed ? (
          <section className="space-y-4">
            <StepHeading ref={headingRef} step={2} title="Match columns to People fields" />
            <p className="text-sm text-slate-600">
              Each column in the file is set to the field its heading looked like. Correct any
              that are wrong, and set a column to “Don&rsquo;t import” to leave it out. Empty cells
              never clear an existing value.
            </p>

            <MappingTable
              parsed={parsed}
              assignments={assignments}
              conflicts={conflicts}
              onChange={(header, field) =>
                setAssignments((current) => ({ ...current, [header]: field }))
              }
            />

            <p className="text-sm text-slate-600" role="status">
              {mappedFields.length === 0
                ? 'No columns are set to import yet.'
                : `${mappedFields.length} of ${pluralize(parsed.headers.length, 'column')} will be imported.`}
            </p>

            {!hasNameColumn ? (
              <Callout tone="warning" title="No name column is chosen">
                A new person needs a first name, a last name or an organisation. Rows that do not
                match someone already here by email or ID will be reported instead of added.
              </Callout>
            ) : null}

            {state.error ? (
              <Callout tone="danger" role="alert">
                {state.error}
              </Callout>
            ) : null}
          </section>
        ) : null}

        {step === 'done' && state.result ? (
          <section className="space-y-4">
            <StepHeading ref={headingRef} step={3} title="Imported" />
            <ImportSummary result={state.result} />
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}

function StepHeading({
  ref,
  step,
  title,
}: {
  ref: React.Ref<HTMLHeadingElement>
  step: number
  title: string
}) {
  return (
    <h3 ref={ref} tabIndex={-1} className="text-sm font-semibold text-slate-900 outline-none">
      <span className="text-slate-500">Step {step} of 3 · </span>
      {title}
    </h3>
  )
}

function MappingTable({
  parsed,
  assignments,
  conflicts,
  onChange,
}: {
  parsed: ParsedFile
  assignments: ColumnAssignments<ContactImportField>
  conflicts: ReadonlyMap<string, string>
  onChange: (header: string, field: ContactImportField | null) => void
}) {
  const idBase = useId()

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[32rem] text-sm">
        <thead className="bg-slate-50 text-left text-[13px] text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Column in file
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Example
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Import as
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {parsed.headers.map((header, index) => {
            const conflict = conflicts.get(header)
            const errorId = conflict ? `${idBase}-${index}-error` : undefined
            const example = sampleValue(parsed.rows, header)
            return (
              <tr key={header} className="align-top">
                <th scope="row" className="max-w-[12rem] break-words px-3 py-2 font-medium text-slate-900">
                  {header}
                </th>
                <td className="max-w-[12rem] truncate px-3 py-2 text-slate-500" title={example}>
                  {example || <span className="italic">empty</span>}
                </td>
                <td className="px-3 py-2">
                  <Select
                    aria-label={`Import “${header}” as`}
                    aria-describedby={errorId}
                    aria-invalid={conflict ? true : undefined}
                    invalid={conflict !== undefined}
                    value={assignments[header] ?? ''}
                    onChange={(event) =>
                      onChange(
                        header,
                        event.target.value === '' ? null : (event.target.value as ContactImportField),
                      )
                    }
                    className="min-w-[11rem]"
                  >
                    <option value="">Don&rsquo;t import</option>
                    {CONTACT_IMPORT_FIELDS.map((definition) => (
                      <option key={definition.field} value={definition.field}>
                        {definition.label}
                      </option>
                    ))}
                  </Select>
                  {conflict ? (
                    <p id={errorId} className="mt-1 text-[13px] font-medium text-red-600">
                      Also chosen for “{conflict}”. Pick one column for each field.
                    </p>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ImportSummary({ result }: { result: ContactImportResult }) {
  const written = result.created + result.updated
  const nothingWritten = written === 0

  return (
    <>
      <Callout
        tone={nothingWritten ? 'danger' : 'success'}
        role="status"
        title={
          nothingWritten
            ? `Nothing was imported from ${result.filename}`
            : `${pluralize(written, 'person', 'people')} imported from ${result.filename}`
        }
      >
        <ul className="mt-1 space-y-0.5">
          <li>{pluralize(result.created, 'new person', 'new people')} added</li>
          <li>{pluralize(result.updated, 'existing person', 'existing people')} updated</li>
          {result.skipped > 0 ? (
            <li>{pluralize(result.skipped, 'row')} skipped as a repeat of an earlier row</li>
          ) : null}
          {result.failed > 0 ? <li>{pluralize(result.failed, 'row')} not imported</li> : null}
        </ul>
      </Callout>

      {result.truncated ? (
        <Callout tone="warning">
          Only the first {MAX_IMPORT_ROWS.toLocaleString()} rows were read. Import the rest as a
          separate file.
        </Callout>
      ) : null}

      {result.caveat ? <Callout tone="warning">{result.caveat}</Callout> : null}

      {result.problems.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-900">Rows that need attention</h4>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {result.problems.map((problem) => (
              <li key={problem.row}>
                <span className="font-medium text-slate-900">Row {problem.row}:</span>{' '}
                {problem.message}
              </li>
            ))}
          </ul>
          {result.problemCount > result.problems.length ? (
            <p className="text-[13px] text-slate-500">
              And {result.problemCount - result.problems.length} more. The full list is on the
              import record.
            </p>
          ) : null}
          <p className="text-sm text-slate-600">
            Fix those rows in the file and import it again. Rows already imported are updated in
            place, not duplicated.
          </p>
        </div>
      ) : null}

      {result.batchId ? (
        <p className="text-sm">
          <Link
            href={`/import/${result.batchId}`}
            className="font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            See the full import record
          </Link>
        </p>
      ) : null}
    </>
  )
}
