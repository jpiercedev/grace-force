'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/display'
import type { ImportActionState } from '@/lib/csv/ui'

/**
 * The commit half of an import.
 *
 * The button says how many rows it will write, because "Commit" on its own
 * asks someone to remember a number from further up the page.
 */

function SubmitButton({
  label,
  pendingLabel,
  variant,
  disabled,
}: {
  label: string
  pendingLabel: string
  variant: 'primary' | 'secondary'
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function CommitPanel({
  batchId,
  commitAction,
  discardAction,
  validRows,
  errorRows,
  blockedReason,
}: {
  batchId: string
  commitAction: (state: ImportActionState, formData: FormData) => Promise<ImportActionState>
  discardAction: (state: ImportActionState, formData: FormData) => Promise<ImportActionState>
  validRows: number
  errorRows: number
  blockedReason: string | null
}) {
  const [commitState, commit] = useActionState<ImportActionState, FormData>(commitAction, {})
  const [discardState, discard] = useActionState<ImportActionState, FormData>(discardAction, {})

  return (
    <Card>
      <CardHeader
        title="Apply this import"
        description={
          errorRows > 0
            ? `Rows with errors are left alone — fix them in the file and upload it again.`
            : 'Every row passed validation.'
        }
      />
      <CardBody className="space-y-4">
        {blockedReason ? (
          <Callout tone="warning" title="This import cannot be applied by you" role="status">
            {blockedReason}
          </Callout>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <form action={commit}>
            <input type="hidden" name="batch_id" value={batchId} />
            <SubmitButton
              label={`Write ${validRows.toLocaleString()} ${validRows === 1 ? 'row' : 'rows'}`}
              pendingLabel="Applying…"
              variant="primary"
              disabled={blockedReason !== null || validRows === 0}
            />
          </form>

          <form action={discard}>
            <input type="hidden" name="batch_id" value={batchId} />
            <SubmitButton label="Discard" pendingLabel="Discarding…" variant="secondary" />
          </form>
        </div>

        {commitState.notice ? (
          <Callout tone="success" role="status">
            {commitState.notice}
          </Callout>
        ) : null}

        {commitState.error ? (
          <Callout tone="danger" role="alert">
            {commitState.error}
          </Callout>
        ) : null}

        {discardState.error ? (
          <Callout tone="danger" role="alert">
            {discardState.error}
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  )
}
