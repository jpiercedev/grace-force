import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PipelineAddForm } from '@/components/domain/pipeline-add-form'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { Input, Label } from '@/components/ui/form'
import { requireWriteAccess } from '@/lib/auth'
import { getContactForFollowUp } from '@/lib/queries/follow-ups'
import {
  getPipelineBySlug,
  listAssignableProfiles,
  searchContactsForPipeline,
} from '@/lib/queries/pipelines'
import { contactDisplayName } from '@/lib/utils'
import { addContactToPipeline } from '../../actions'

export const metadata = { title: 'Add to pipeline' }

type RouteParams = Promise<{ slug: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function AddToPipelinePage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const profile = await requireWriteAccess()
  const { slug } = await params
  const query = await searchParams

  const pipeline = await getPipelineBySlug(slug)
  if (!pipeline || !pipeline.is_active) notFound()

  const contactId = single(query.contact)
  const term = single(query.q) ?? ''
  const contact = contactId ? await getContactForFollowUp(contactId) : null

  const header = (
    <PageHeader
      title={`Add to ${pipeline.name}`}
      description="One open card per contact per pipeline — close the old one before starting another."
      action={
        <LinkButton href={`/pipelines/${pipeline.slug}`} variant="secondary">
          Back to board
        </LinkButton>
      }
    />
  )

  if (contact) {
    const team = await listAssignableProfiles()
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        <Card>
          <CardBody>
            <PipelineAddForm
              action={addContactToPipeline}
              pipelineId={pipeline.id}
              pipelineName={pipeline.name}
              contact={contact}
              team={team}
              tracksValue={pipeline.tracks_value}
              defaultOwnerId={profile.id}
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const matches = term ? await searchContactsForPipeline(pipeline.id, term) : []

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {header}

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
          <form
            method="get"
            action={`/pipelines/${pipeline.slug}/add`}
            className="flex flex-wrap items-end gap-3"
          >
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
              description="Try part of a surname, an email address or an organisation."
            />
          ) : null}

          {matches.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {matches.map((match) => (
                <li key={match.id} className="px-3 py-2.5 text-sm">
                  {match.has_open_card ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-500">
                        {contactDisplayName(match)}
                      </span>
                      <span className="text-xs text-slate-500">Already on this pipeline</span>
                    </div>
                  ) : (
                    <Link
                      href={`/pipelines/${pipeline.slug}/add?contact=${match.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 hover:underline"
                    >
                      <span className="font-medium text-slate-900">
                        {contactDisplayName(match)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {match.email ?? match.organization_name ?? 'No email on file'}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
