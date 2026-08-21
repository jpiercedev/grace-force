import Link from 'next/link'
import { Callout, PageHeader, StatTile } from '@/components/ui/display'
import { canViewGiving, canWrite, requireProfile } from '@/lib/auth'
import {
  ATTENTION_LIMIT,
  getDashboardStats,
  listMyOverdueFollowUps,
  listMyPipelineCards,
  listMyUpcomingFollowUps,
  listRecentActivity,
  type DashboardStats,
} from '@/lib/queries/dashboard'
import { getGivingSnapshot } from '@/lib/queries/giving'
import { cn, pluralize } from '@/lib/utils'
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

/** "Wednesday, August 5" — the eyebrow above the greeting. Rendered server-side. */
const EYEBROW_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

/**
 * One actionable sentence under the greeting: what today asks of you, built
 * from the same counts the pulse band shows so the two can never disagree.
 * `openFollowUps` stands in for the week because the stats round-trip has no
 * seven-day count — and "open" is the honest total anyway.
 */
function daySummary(stats: DashboardStats, writable: boolean): string {
  const leads = stats.newLeadsThisWeek ?? 0
  const leadClause = leads > 0 ? `${pluralize(leads, 'new lead')} came in this week` : null

  if (stats.overdueFollowUps > 0) {
    const urgent = `${pluralize(stats.overdueFollowUps, 'follow-up needs', 'follow-ups need')} your attention`
    return leadClause ? `${urgent}, and ${leadClause}.` : `${urgent} — start there.`
  }
  if (stats.openFollowUps > 0) {
    return leadClause
      ? `Nothing is overdue, and ${leadClause}.`
      : `Nothing is overdue — ${pluralize(stats.openFollowUps, 'open follow-up is', 'open follow-ups are')} in hand.`
  }
  if (leadClause) return `Your follow-up list is clear, and ${leadClause}.`
  return writable
    ? 'Your follow-up list is clear — a good day to reach out to someone.'
    : 'Nothing needs your attention today. Enjoy the quiet.'
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
    // Eight keeps the story rail roughly level with the work column on sparse
    // installs; the full stream lives on each contact's timeline.
    listRecentActivity(8),
    listMyPipelineCards(profile.id),
    showGiving ? getGivingSnapshot(now) : null,
  ])

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? 'there'
  const denied = single(params.denied)
  const deniedMessage = denied ? DENIED_MESSAGES[denied] : undefined
  const nowIso = now.toISOString()
  // Leads are counted only for writable accounts, so this doubles as the
  // permission branch for the third tile.
  const showLeadTile = stats.newLeadsThisWeek !== null

  const quietLink = 'font-medium text-brand-700 underline-offset-2 hover:underline'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={EYEBROW_DATE.format(now)}
        title={`Welcome back, ${firstName}`}
        description={daySummary(stats, writable)}
      />

      {deniedMessage ? (
        <Callout tone="warning" title="That page isn't available to you">
          {deniedMessage}
        </Callout>
      ) : null}

      {/* The pulse band: only the figures that ask for a decision get a tile.
          The ownership counts are context, so they ride along as one quiet
          line instead of two more boxes. */}
      <section
        aria-label="Today at a glance"
        className="flex flex-col gap-x-8 gap-y-3 xl:flex-row xl:items-end xl:justify-between"
      >
        <div
          className={cn(
            'grid grid-cols-2 gap-3',
            showLeadTile ? 'sm:max-w-2xl sm:grid-cols-3' : 'sm:max-w-md',
          )}
        >
          <StatTile
            label="Overdue"
            value={stats.overdueFollowUps}
            hint={stats.overdueFollowUps === 0 ? 'Nothing is late' : 'Clear these first'}
            href="/follow-ups?segment=overdue"
            tone={stats.overdueFollowUps > 0 ? 'red' : 'slate'}
          />
          <StatTile
            label="My follow-ups"
            value={stats.openFollowUps}
            hint="Open and assigned to you"
            href="/follow-ups"
          />
          {showLeadTile ? (
            // A phone shows two tiles per row, so the odd tile stretches to
            // close the band instead of dangling beside a gap.
            <div className="col-span-2 sm:col-span-1">
              <StatTile
                label="New leads"
                value={stats.newLeadsThisWeek}
                hint="In the last seven days"
                href="/leads"
              />
            </div>
          ) : null}
        </div>
        {/* Wide screens break this into two measured lines beside the band;
            below xl it reads as one sentence beneath it. */}
        <p className="text-sm leading-relaxed text-slate-600 xl:pb-1 xl:text-right">
          <span className="xl:block">
            {stats.ownedContacts === 0 ? (
              <Link href={`/contacts?owner=${profile.id}`} className={quietLink}>
                No contacts are in your care yet
              </Link>
            ) : (
              <>
                You look after{' '}
                <Link href={`/contacts?owner=${profile.id}`} className={quietLink}>
                  {pluralize(stats.ownedContacts, 'contact')}
                </Link>
              </>
            )}
            <span aria-hidden="true" className="xl:hidden">
              {' · '}
            </span>
          </span>
          <span className="xl:block">
            <Link href="/contacts?sort=created" className={quietLink}>
              {pluralize(stats.newContactsThisMonth, 'contact')}
            </Link>{' '}
            added across the team this month.
          </span>
        </p>
      </section>

      {/* The hero: what is owed and late leads the page at full width. */}
      <FollowUpPanel
        hero
        title="Needs attention"
        description="Overdue and assigned to you."
        items={overdue}
        emptyTitle="Nothing is overdue"
        emptyDescription="Everything you owe people is still in hand — enjoy the quiet."
        href="/follow-ups?segment=overdue"
        linkLabel="Open queue"
        nowIso={nowIso}
      />

      {/* Work column left, quieter story rail right; giving follows below as
          context rather than competing with the day's tasks. */}
      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <FollowUpPanel
            title="Due today and this week"
            description="The next seven days."
            items={upcoming}
            emptyTitle="A clear week ahead"
            emptyDescription={
              // Read-only accounts cannot schedule, so the nudge would mislead.
              writable
                ? 'Nothing is due in the next seven days. Schedule a follow-up and it will land here.'
                : 'Nothing is due in the next seven days. Follow-ups assigned to you will land here.'
            }
            href="/follow-ups?segment=week"
            linkLabel="Open queue"
            nowIso={nowIso}
          />
          <PipelinePanel groups={pipelines} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <ActivityPanel items={activity} nowIso={nowIso} />
        </div>
      </div>

      {giving ? <GivingStrip snapshot={giving} /> : null}
    </div>
  )
}
