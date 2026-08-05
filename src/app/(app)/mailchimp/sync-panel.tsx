'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/display'
import { Field, Select } from '@/components/ui/form'
import {
  MAILCHIMP_JOBS,
  MAILCHIMP_JOB_DESCRIPTIONS,
  MAILCHIMP_JOB_LABELS,
} from '@/lib/mailchimp/jobs'
import type { MailchimpActionState } from '@/lib/mailchimp/ui'

/**
 * The admin "Sync now" control.
 *
 * A sync of a large audience takes real time, so the button reports that it is
 * working and the result is announced rather than left for the reader to spot.
 */
function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Syncing…' : 'Sync now'}
    </Button>
  )
}

export function SyncPanel({
  action,
  lastSyncedAt,
}: {
  action: (state: MailchimpActionState, formData: FormData) => Promise<MailchimpActionState>
  lastSyncedAt: string | null
}) {
  const [state, formAction] = useActionState<MailchimpActionState, FormData>(action, {})

  return (
    <Card>
      <CardHeader
        title="Run a sync"
        description={
          lastSyncedAt
            ? 'Scheduled hourly. Run it now to pick up changes immediately.'
            : 'Nothing has been synced yet. Start with everything.'
        }
      />
      <CardBody className="space-y-4">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <Field label="What to sync" className="min-w-[14rem] flex-1">
            {(props) => (
              <Select {...props} name="job" defaultValue="all">
                <option value="all">Everything</option>
                {MAILCHIMP_JOBS.map((job) => (
                  <option key={job} value={job}>
                    {MAILCHIMP_JOB_LABELS[job]} — {MAILCHIMP_JOB_DESCRIPTIONS[job]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <SubmitButton />
        </form>

        {state.notice ? (
          <Callout tone="success" role="status">
            {state.notice}
          </Callout>
        ) : null}

        {state.error ? (
          <Callout tone="danger" role="alert">
            {state.error}
          </Callout>
        ) : null}

        <p className="text-xs text-slate-500">
          Re-running a sync changes nothing that is already up to date. Every mirrored record is
          keyed on Mailchimp&rsquo;s own identifier, and every timeline entry carries a
          deterministic key.
        </p>
      </CardBody>
    </Card>
  )
}
