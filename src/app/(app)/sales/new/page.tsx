import Link from 'next/link'
import { PipelineAddForm } from '@/components/domain/pipeline-add-form'
import { Button, LinkButton } from '@/components/ui/button'
import {
  Avatar,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/display'
import { Input, Label } from '@/components/ui/form'
import { requireWriteAccess } from '@/lib/auth'
import { getContactForFollowUp, searchContactsForFollowUp } from '@/lib/queries/follow-ups'
import { listAssignableProfiles, listPipelineOptions } from '@/lib/queries/pipelines'
import { contactDisplayName } from '@/lib/utils'
import { createOpportunity } from '../actions'

export const metadata = { title: 'New opportunity' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Creating an opportunity from anywhere: pick the person, pick the pipeline.
 * A person's record links here with `?contact=<id>&from=contact`, which skips
 * the search and returns there after creating.
 */
export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await requireWriteAccess()
  const query = await searchParams

  const contactId = single(query.contact)
  const fromContact = single(query.from) === 'contact'
  const term = single(query.q) ?? ''
  const contact = contactId ? await getContactForFollowUp(contactId) : null

  const header = (
    <PageHeader
      eyebrow="Sales"
      title="New opportunity"
      description="A sales conversation, attached to the person it is with."
      action={
        <LinkButton
          href={fromContact && contact ? `/contacts/${contact.id}` : '/sales'}
          variant="secondary"
        >
          {fromContact && contact ? 'Back to person' : 'Back to Sales'}
        </LinkButton>
      }
    />
  )

  if (contact) {
    const [team, pipelines] = await Promise.all([listAssignableProfiles(), listPipelineOptions()])
    const usable = pipelines.filter((pipeline) => pipeline.has_stages)

    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        {usable.length === 0 ? (
          <Card>
            <EmptyState
              title="No pipeline can hold this yet"
              description="Every active pipeline needs at least one stage before it can hold opportunities."
              action={<LinkButton href="/sales/manage">Manage pipelines</LinkButton>}
            />
          </Card>
        ) : (
          <Card>
            <CardBody className="py-5">
              <PipelineAddForm
                action={createOpportunity}
                pipelines={pipelines}
                contact={contact}
                team={team}
                defaultOwnerId={profile.id}
                returnToContact={fromContact}
              />
            </CardBody>
          </Card>
        )}
      </div>
    )
  }

  const matches = term ? await searchContactsForFollowUp(term) : []

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {header}

      {contactId && !contact ? (
        <Callout tone="danger" role="alert">
          That person could not be found. Search for someone else below.
        </Callout>
      ) : null}

      <Card>
        <CardHeader title="Who is this opportunity with?" description="Search by name, email or organization." />
        <CardBody className="space-y-4">
          <form method="get" action="/sales/new" className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="contact-search">Search</Label>
              <Input
                id="contact-search"
                name="q"
                type="search"
                defaultValue={term}
                autoFocus
                placeholder="e.g. Ruth Alvarez"
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {term && matches.length === 0 ? (
            <EmptyState
              title="No matches"
              description="Try part of a surname, an email address or an organization."
            />
          ) : null}

          {matches.length > 0 ? (
            <ul className="divide-y divide-slate-200/70 overflow-hidden rounded-lg border border-slate-200">
              {matches.map((match) => {
                const name = contactDisplayName(match)
                return (
                  <li key={match.id}>
                    <Link
                      href={`/sales/new?contact=${match.id}`}
                      className="group flex items-center gap-3 px-3.5 py-3 text-sm transition-colors duration-150 hover:bg-slate-100/70"
                    >
                      <Avatar name={name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900">{name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {match.email ?? match.organization_name ?? 'No email on file'}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="text-slate-400 transition-colors duration-150 group-hover:text-brand-700"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
