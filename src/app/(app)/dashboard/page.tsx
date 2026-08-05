import { Callout, PageHeader, StatTile } from '@/components/ui/display'
import { canViewGiving, canWrite, requireProfile } from '@/lib/auth'
import {
  ATTENTION_LIMIT,
  getDashboardStats,
  listMyOverdueFollowUps,
  listMyPipelineCards,
  listMyUpcomingFollowUps,
  listRecentActivity,
} from '@/lib/queries/dashboard'
import { getGivingSnapshot } from '@/lib/queries/giving'
import {
  ActivityPanel,
  FollowUpPanel,
  GivingStrip,
  PipelinePanel,
} from './panels'

export const metadata = { title: 'Dashboard' }

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The auth guards redirect here with `?denied=…` rather than showing a bare
 * 403, so the reason has to be explained on arrival — otherwise the redirect
 * looks like a bug.
 */
const DENIED_MESSAGES: Record<string, string> = {
  write: 'That page is for staff and administrators. Your account has read-only access.',
  admin: 'That page is for administrators only.',
  giving: 'Giving records are limited to administrators and staff granted access to them.',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireProfile()
  const params = await searchParams

  // One clock for the whole render: the stat counts, the due-date windows and
  // every relative label have to agree with each other.
  const now = new Date()
  const writable = canWrite(profile)
  const showGiving = canViewGiving(profile)

  const [stats, overdue, upcoming, activity, pipelines, giving] = await Promise.all([
    getDashboardStats(profile.id, { includeLeads: writable }, now),
    listMyOverdueFollowUps(profile.id, ATTENTION_LIMIT, now),
    listMyUpcomingFollowUps(profile.id, ATTENTION_LIMIT, now),
    listRecentActivity(),
    listMyPipelineCards(profile.id),
    showGiving ? getGivingSnapshot(now) : null,
  ])

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? 'there'
  const denied = single(params.denied)
  const deniedMessage = denied ? DENIED_MESSAGES[denied] : undefined
  const nowIso = now.toISOString()

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your relationships at a glance."
      />

      {deniedMessage ? (
        <Callout tone="warning" title="You were sent back here">
          {deniedMessage}
        </Callout>
      ) : null}

      {/* Each StatTile is its own <dl>, so the grid around them is a plain div. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="My follow-ups"
          value={stats.openFollowUps}
          hint="Open and assigned to you"
          href="/follow-ups"
        />
        <StatTile
          label="Overdue"
          value={stats.overdueFollowUps}
          hint={stats.overdueFollowUps === 0 ? 'Nothing is late' : 'Past their due date'}
          href="/follow-ups?segment=overdue"
          tone={stats.overdueFollowUps > 0 ? 'red' : 'slate'}
        />
        <StatTile
          label="Contacts I own"
          value={stats.ownedContacts}
          hint="People you are responsible for"
          href={`/contacts?owner=${profile.id}`}
        />
        {stats.newLeadsThisWeek !== null ? (
          <StatTile
            label="New leads"
            value={stats.newLeadsThisWeek}
            hint="Submitted in the last seven days"
            href="/leads"
            tone={stats.newLeadsThisWeek > 0 ? 'brand' : 'slate'}
          />
        ) : null}
        <StatTile
          label="New contacts"
          value={stats.newContactsThisMonth}
          hint="Added this month"
          href="/contacts?sort=created"
        />
      </div>

      {giving ? <GivingStrip snapshot={giving} /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FollowUpPanel
          title="Needs attention"
          description="Overdue and assigned to you."
          items={overdue}
          emptyTitle="Nothing is overdue"
          emptyDescription="Everything you owe people is still in hand."
          href="/follow-ups?segment=overdue"
          linkLabel="Open queue"
          nowIso={nowIso}
        />
        <FollowUpPanel
          title="Due today and this week"
          description="The next seven days."
          items={upcoming}
          emptyTitle="Nothing is due this week"
          emptyDescription="Schedule a follow-up and it will appear here."
          href="/follow-ups?segment=week"
          linkLabel="Open queue"
          nowIso={nowIso}
        />
        <PipelinePanel groups={pipelines} />
        <ActivityPanel items={activity} nowIso={nowIso} />
      </div>
    </div>
  )
}
