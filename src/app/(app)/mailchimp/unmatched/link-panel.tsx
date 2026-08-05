'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, LinkButton } from '@/components/ui/button'
import { Callout, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/display'
import { Input, Label } from '@/components/ui/form'
import type { LinkCandidate, UnmatchedMember } from '@/lib/mailchimp/queries'
import type { MailchimpActionState } from '@/lib/mailchimp/ui'

/**
 * The linking panel for one unmatched subscriber.
 *
 * Each candidate carries its own submit button holding the contact id, so
 * linking is a single keystroke and every control names the person it links —
 * twenty buttons all called "Link" would be unusable from a screen reader's
 * element list.
 */
function CandidateButton({ candidate }: { candidate: LinkCandidate }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" name="contact_id" value={candidate.id} size="sm" disabled={pending}>
      Link<span className="sr-only"> to {candidate.name}</span>
    </Button>
  )
}

export function LinkPanel({
  member,
  term,
  candidates,
  action,
}: {
  member: UnmatchedMember
  term: string
  candidates: LinkCandidate[]
  action: (state: MailchimpActionState, formData: FormData) => Promise<MailchimpActionState>
}) {
  const [state, formAction] = useActionState<MailchimpActionState, FormData>(action, {})
  const router = useRouter()

  // The panel is opened by a link, so Escape has to unwind the same navigation
  // that the Cancel control does.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') router.push('/mailchimp/unmatched')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [router])

  return (
    <Card id="link-panel">
      <CardHeader
        title={`Link ${member.email_address}`}
        description={
          member.audience
            ? `Subscribed to ${member.audience.name}.`
            : 'Subscriber with no audience on file.'
        }
        action={
          <LinkButton href="/mailchimp/unmatched" variant="ghost" size="sm">
            Cancel
          </LinkButton>
        }
      />
      <CardBody className="space-y-4">
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

        {/* A GET form, so the search term lives in the URL and the panel stays
            reloadable and shareable. */}
        <form method="get" action="/mailchimp/unmatched" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="member" value={member.id} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="contact-search">Find a contact</Label>
            <Input
              id="contact-search"
              name="q"
              type="search"
              defaultValue={term}
              autoFocus
              placeholder="Name, email or organisation"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {term === '' ? (
          <p className="text-sm text-slate-600">
            Search for the person this address belongs to. Linking records the match as manual, so
            the next sync leaves it alone.
          </p>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No matches"
            description="Try part of a surname, an email address or an organisation."
          />
        ) : (
          <form action={formAction}>
            <input type="hidden" name="member_id" value={member.id} />
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">
                      {candidate.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {candidate.email ?? candidate.organization_name ?? 'No email on file'}
                    </span>
                  </span>
                  <CandidateButton candidate={candidate} />
                </li>
              ))}
            </ul>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
