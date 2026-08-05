import { FollowUpFilters } from '@/components/domain/follow-up-filters'
import { FollowUpQueue } from '@/components/domain/follow-up-queue'
import { LinkButton } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { listAssignableProfiles, listFollowUps } from '@/lib/queries/follow-ups'
import { pluralize } from '@/lib/utils'
import {
  ASSIGNEE_ME,
  SEGMENT_EMPTY_MESSAGES,
  SEGMENT_LABELS,
  parseAssignee,
  parsePriorityFilter,
  parseSegment,
} from '@/lib/validation/follow-up'
import { updateFollowUp } from './actions'

export const metadata = { title: 'Follow-ups' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function FollowUpsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile()
  const params = await searchParams

  const segment = parseSegment(single(params.segment))
  const assignee = parseAssignee(single(params.assignee))
  const priority = parsePriorityFilter(single(params.priority))

  // One clock for the whole render: the query windows, the "overdue" styling
  // and the relative labels all have to agree.
  const now = new Date()

  const [items, team] = await Promise.all([
    listFollowUps(
      { segment, assignee: assignee === ASSIGNEE_ME ? profile.id : assignee, priority },
      now,
    ),
    listAssignableProfiles(),
  ])

  const editable = canWrite(profile)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Follow-ups"
        description="What you owe people, and when you owe it."
        action={
          editable ? <LinkButton href="/follow-ups/new">New follow-up</LinkButton> : undefined
        }
      />

      <FollowUpFilters segment={segment} assignee={assignee} priority={priority} team={team} />

      <Card>
        <CardHeader
          title={SEGMENT_LABELS[segment]}
          description={pluralize(items.length, 'follow-up')}
        />
        {items.length === 0 ? (
          <EmptyState title="Nothing here" description={SEGMENT_EMPTY_MESSAGES[segment]} />
        ) : (
          <FollowUpQueue
            items={items}
            team={team}
            canEdit={editable}
            nowIso={now.toISOString()}
            action={updateFollowUp}
          />
        )}
      </Card>
    </div>
  )
}
