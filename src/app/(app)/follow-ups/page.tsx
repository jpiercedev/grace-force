import { FollowUpFilters } from '@/components/domain/follow-up-filters'
import { FollowUpQueue } from '@/components/domain/follow-up-queue'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/display'
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

      <FollowUpFilters
        segment={segment}
        assignee={assignee}
        priority={priority}
        team={team}
        activeCount={items.length}
      />

      <Card>
        {/* An eyebrow rule, not a second title: the segmented control already
            says where we are, so the ledger header just restates it quietly
            and carries the count. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <h2 className="text-xs font-medium text-slate-500">
            {SEGMENT_LABELS[segment]}
          </h2>
          <p className="text-sm tabular-nums text-slate-500">{pluralize(items.length, 'follow-up')}</p>
        </div>
        {items.length === 0 ? (
          <EmptyState title="All clear" description={SEGMENT_EMPTY_MESSAGES[segment]} />
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
