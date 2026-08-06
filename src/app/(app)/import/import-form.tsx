'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/display'
import { Field, Input, Select } from '@/components/ui/form'
import { IMPORT_KINDS, IMPORT_KIND_LABELS, type ImportActionState, type ImportKind } from '@/lib/csv/ui'

/**
 * The upload half of an import.
 *
 * Nothing here writes a contact. Submitting stages the file and moves to a
 * preview, and the wording says so — an operator should never wonder whether
 * choosing a file has already changed something.
 */

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Checking the file…' : 'Upload and preview'}
    </Button>
  )
}

export function ImportForm({
  action,
  canImportGifts,
}: {
  action: (state: ImportActionState, formData: FormData) => Promise<ImportActionState>
  canImportGifts: boolean
}) {
  const [state, formAction] = useActionState<ImportActionState, FormData>(action, {})
  const [kind, setKind] = useState<ImportKind>('contacts')

  const giftsBlocked = kind === 'gifts' && !canImportGifts

  return (
    <Card>
      <CardHeader
        title="Upload a CSV"
        description="The file is checked and previewed first. Nothing is written until you commit it."
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What this file contains" error={state.fieldErrors?.kind}>
              {(props) => (
                <Select
                  {...props}
                  name="kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ImportKind)}
                >
                  {IMPORT_KINDS.map((option) => (
                    <option key={option} value={option}>
                      {IMPORT_KIND_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="External ID source"
              hint="Names the system your ID column came from, so two systems' IDs cannot collide. Defaults to “csv”."
              error={state.fieldErrors?.external_source}
            >
              {(props) => (
                <Input {...props} name="external_source" defaultValue="csv" maxLength={40} />
              )}
            </Field>
          </div>

          <Field
            label="CSV file"
            hint="Up to 5 MB and 5,000 rows. Dates are read month-first, so 03/04/2026 is 4 March."
            error={state.fieldErrors?.file}
            required
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                // The browser-default bezel button clashes with the design
                // system; file: modifiers restyle it without a custom picker.
                className="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            )}
          </Field>

          {giftsBlocked ? (
            <Callout tone="warning" title="Giving imports are admin-only" role="status">
              Giving records can only be written by an administrator, so this file would be refused
              row by row. Ask an admin to run it.
            </Callout>
          ) : null}

          {state.error ? (
            <Callout tone="danger" role="alert">
              {state.error}
            </Callout>
          ) : null}

          <SubmitButton disabled={giftsBlocked} />
        </form>
      </CardBody>
    </Card>
  )
}
