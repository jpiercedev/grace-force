import { LeadFilters } from '@/app/(app)/leads/lead-filters'
import { LeadQueue } from '@/app/(app)/leads/lead-queue'
import { LinkButton } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { leadStatusCounts, listLeads } from '@/lib/leads/queries'
import {
  ASSIGNEE_ME,
  LEAD_STATUS_EMPTY_MESSAGES,
  LEAD_STATUS_LABELS,
  STATUS_ANY,
  parseLeadAssigneeFilter,
  parseLeadStatusFilter,
} from '@/lib/leads/triage'
import { listAssignableProfiles } from '@/lib/queries/follow-ups'
import { pluralize } from '@/lib/utils'

export const metadata = { title: 'Leads' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The triage queue for everything the public form has sent in.
 *
 * The queue is shared reading (20260814000400 opened `leads_select` to every
 * active user); triage controls belong to writers only, and the server
 * actions re-check that regardless of what the interface offers.
 */
export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile()
  const params = await searchParams

  const status = parseLeadStatusFilter(single(params.status))
  const assignee = parseLeadAssigneeFilter(single(params.assignee))

  // One clock for the whole render, so every relative age agrees.
  const now = new Date()

  const [leads, team, counts] = await Promise.all([
    listLeads({ status, assignee: assignee === ASSIGNEE_ME ? profile.id : assignee }),
    listAssignableProfiles(),
    leadStatusCounts(),
  ])

  const heading = status === STATUS_ANY ? 'All leads' : LEAD_STATUS_LABELS[status]

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Leads"
        description="Enquiries from the public form, waiting to become relationships."
        action={
          <LinkButton href="/intake" variant="secondary">
            View the public form
          </LinkButton>
        }
      />

      <LeadFilters status={status} assignee={assignee} team={team} counts={counts} />

      <Card>
        <CardHeader title={heading} description={pluralize(leads.length, 'lead')} />
        {leads.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description={
              status === STATUS_ANY
                ? 'No enquiries have arrived yet. Share the intake form and they will land here.'
                : LEAD_STATUS_EMPTY_MESSAGES[status]
            }
          />
        ) : (
          <LeadQueue
            leads={leads}
            team={team}
            statusFilter={status}
            nowIso={now.toISOString()}
            canTriage={canWrite(profile)}
          />
        )}
      </Card>
    </div>
  )
}
