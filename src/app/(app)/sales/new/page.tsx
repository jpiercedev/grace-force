import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { Input, Label, Select } from '@/components/ui/form'
import { canWrite, requireProfile } from '@/lib/auth'
import { getContactForFollowUp } from '@/lib/queries/follow-ups'
import {
  listAssignableProfiles,
  listSalesPipelineOptions,
  searchContactsForPipeline,
} from '@/lib/queries/pipelines'
import { addContactToPipeline } from '@/app/(app)/pipelines/actions'
import { contactDisplayName } from '@/lib/utils'

export const metadata = { title: 'New opportunity' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  // Readers land back on the overview rather than the generic denied screen —
  // they were one click away from it and lose nothing.
  if (!canWrite(profile)) redirect('/sales')

  const params = await searchParams
  const contactParam = single(params.contact)
  const contactId = contactParam && UUID_PATTERN.test(contactParam) ? contactParam : undefined
  const pipelineSlug = single(params.pipeline)
  const term = single(params.q) ?? ''

  const pipelines = await listSalesPipelineOptions()
  const chosen = pipelines.find((option) => option.slug === pipelineSlug) ?? pipelines[0]

  const header = (
    <PageHeader
      eyebrow={
        <Link href="/sales" className="hover:text-brand-700 hover:underline">
          Sales
        </Link>
      }
      title="New opportunity"
      description="One open opportunity per person per pipeline — close the old one before starting another."
      action={
        <LinkButton href="/sales" variant="secondary">
          Back to Sales
        </LinkButton>
      }
    />
  )

  if (!chosen) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        <Card>
          <EmptyState
            title="No active pipelines"
            description="An opportunity needs a pipeline to live on. Create one first."
            action={
              <LinkButton href="/sales/pipelines" variant="secondary">
                Manage pipelines
              </LinkButton>
            }
          />
        </Card>
      </div>
    )
  }

  const contact = contactId ? await getContactForFollowUp(contactId) : null

  if (contact) {
    const team = await listAssignableProfiles()
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {header}
        <Card>
          <CardBody className="py-5">
            <PipelineAddForm
              action={addContactToPipeline}
              pipelines={pipelines}
              defaultPipelineId={chosen.id}
              contact={contact}
              team={team}
              defaultOwnerId={profile.id}
              submitLabel="Create opportunity"
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const matches = term ? await searchContactsForPipeline(chosen.id, term) : []
  // Search links keep the pipeline choice so it survives the two-phase flow.
  const pipelineQuery = pipelineSlug ? `&pipeline=${encodeURIComponent(pipelineSlug)}` : ''

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {header}

      {contactParam && !contact ? (
        <Callout tone="danger" role="alert">
          That contact could not be found. Search for someone else below.
        </Callout>
      ) : null}

      <Card>
        <CardHeader
          title="Who is this opportunity with?"
          description="Search by name, email or organisation."
        />
        <CardBody className="space-y-4">
          {/* Label and Input rather than Field: this page stays a Server
              Component, and Field's render prop cannot cross into one. */}
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
            {/* The pipeline is chooseable here because the search's
                "already on this pipeline" flags depend on it. */}
            <div className="space-y-1.5">
              <Label htmlFor="pipeline-choice">Pipeline</Label>
              <Select id="pipeline-choice" name="pipeline" defaultValue={chosen.slug}>
                {pipelines.map((option) => (
                  <option key={option.id} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </Select>
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
            <ul className="divide-y divide-slate-200/70 overflow-hidden rounded-lg border border-slate-200">
              {matches.map((match) => {
                const name = contactDisplayName(match)
                return (
                  <li key={match.id}>
                    {match.has_open_card ? (
                      <div className="flex items-center gap-3 px-3.5 py-3 text-sm">
                        <Avatar name={name} size="md" className="opacity-50 saturate-50" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-500">{name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          Already on {chosen.name}
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={`/sales/new?contact=${match.id}${pipelineQuery}`}
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
                    )}
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
