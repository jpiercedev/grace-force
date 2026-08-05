import { addDays } from 'date-fns'
import Link from 'next/link'
import { FollowUpForm } from '@/components/domain/follow-up-form'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { Input, Label } from '@/components/ui/form'
import { requireWriteAccess } from '@/lib/auth'
import {
  getContactForFollowUp,
  listAssignableProfiles,
  searchContactsForFollowUp,
} from '@/lib/queries/follow-ups'
import { contactDisplayName } from '@/lib/utils'
import { toDateTimeLocalValue } from '@/lib/validation/follow-up'
import { createFollowUp } from '../actions'

export const metadata = { title: 'New follow-up' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Tomorrow morning: far enough away to be actionable, near enough to matter. */
function defaultDueAt(): string {
  const due = addDays(new Date(), 1)
  due.setHours(9, 0, 0, 0)
  return toDateTimeLocalValue(due)
}

export default async function NewFollowUpPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireWriteAccess()
  const params = await searchParams
  const contactId = single(params.contact)
  const query = single(params.q) ?? ''

  const contact = contactId ? await getContactForFollowUp(contactId) : null

  if (contact) {
    const team = await listAssignableProfiles()
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title="New follow-up"
          description="Commitments show up in the queue until someone closes them out."
          action={
            <LinkButton href="/follow-ups" variant="secondary">
              Back to queue
            </LinkButton>
          }
        />
        <Card>
          <CardBody>
            <FollowUpForm
              action={createFollowUp}
              contact={contact}
              team={team}
              defaultAssigneeId={profile.id}
              defaultDueAt={defaultDueAt()}
              redirectTo="/follow-ups"
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const matches = query ? await searchContactsForFollowUp(query) : []

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="New follow-up"
        description="Start by choosing who it is about."
        action={
          <LinkButton href="/follow-ups" variant="secondary">
            Back to queue
          </LinkButton>
        }
      />

      {contactId && !contact ? (
        <Card>
          <CardBody>
            <p className="text-sm text-red-700">
              That contact could not be found. Search for someone else below.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Find a contact" description="Search by name, email or organisation." />
        <CardBody className="space-y-4">
          {/* Label and Input rather than Field: this page stays a Server
              Component, and Field's render prop is a function, which cannot
              cross into a Client Component. There is one search box, so a
              fixed id is unambiguous. */}
          <form method="get" action="/follow-ups/new" className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="contact-search">Search</Label>
              <Input
                id="contact-search"
                name="q"
                type="search"
                defaultValue={query}
                autoFocus
                placeholder="Ruth Alvarez"
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {query && matches.length === 0 ? (
            <EmptyState
              title="No matches"
              description="Try part of a surname, an email address or an organisation."
            />
          ) : null}

          {matches.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {matches.map((match) => (
                <li key={match.id}>
                  <Link
                    href={`/follow-ups/new?contact=${match.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5 text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">
                      {contactDisplayName(match)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {match.email ?? match.organization_name ?? 'No email on file'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
