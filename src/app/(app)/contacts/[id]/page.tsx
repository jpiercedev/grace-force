import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  addEngagement,
  archiveContact,
  endEngagement,
  reassignContactOwner,
  updateEngagement,
} from '@/app/(app)/contacts/actions'
import {
  addInterest,
  addRelationship,
  logInteraction,
  removeAttachment,
  removeInterest,
  removeRelationship,
  saveCapability,
  saveContactPreferences,
  uploadAttachment,
} from '@/app/(app)/contacts/donor-actions'
import { saveAttendee } from '@/app/(app)/events/actions'
import { ACTIVITY_TYPE_LABELS, parseActivityType } from '@/components/domain/contact-badges'
import { ContactOpportunities } from '@/components/domain/contact-opportunities'
import { ContactEmailPanel, ContactGivingPanel } from '@/components/domain/contact-panels'
import { MEETING_KIND_LABELS } from '@/components/domain/development-badges'
import { DonorAbout } from '@/components/domain/donor/donor-about'
import { DonorAssociations } from '@/components/domain/donor/donor-associations'
import { DonorEvents } from '@/components/domain/donor/donor-events'
import { DonorGlance } from '@/components/domain/donor/donor-glance'
import { DonorHeader } from '@/components/domain/donor/donor-header'
import { DonorInterests } from '@/components/domain/donor/donor-interests'
import { DonorCapability, DonorPreferences } from '@/components/domain/donor/donor-preferences'
import { EngagementPanel } from '@/components/domain/engagement-panel'
import { QuickActivityBar } from '@/components/domain/log-interaction'
import { ProposalList } from '@/components/domain/proposal-list'
import { Timeline } from '@/components/domain/timeline'
import { TimelineFilters } from '@/components/domain/timeline-filters'
import { LinkButton, buttonClasses } from '@/components/ui/button'
import { SectionHeading, Tabs, type TabDefinition } from '@/components/ui/tabs'
import { canWrite, isAdmin, requireProfile } from '@/lib/auth'
import { getContactAttachments, withDownloadUrls } from '@/lib/queries/attachments'
import { getContactCallReports } from '@/lib/queries/call-reports'
import {
  TIMELINE_MAX_LOADED,
  TIMELINE_PAGE_SIZE,
  contactName,
  getContact,
  getContactEmailEngagement,
  getContactEngagements,
  getContactFollowUps,
  getContactGiving,
  getContactTimeline,
  groupActivitiesByDay,
  listEngagementTypes,
  listTeamMembers,
} from '@/lib/queries/contacts'
import { getContactEvents, listEventOptions } from '@/lib/queries/events'
import { getContactOpportunities } from '@/lib/queries/pipelines'
import { getContactProposals, primaryProposal } from '@/lib/queries/proposals'
import {
  getContactCapability,
  getContactInterests,
  getRelatedPeople,
  listInterestAreas,
} from '@/lib/queries/relationships'
import { formatDate, pluralize } from '@/lib/utils'

/**
 * The person record — the heart of the application, in three zones:
 *
 * 1. **Left rail** — who this is and how to reach them, persistent while the
 *    workspace changes. Rarely-needed properties fold behind "View all
 *    details".
 * 2. **Center workspace** — where the relationship is worked: Overview,
 *    Activity, Planned gifts, Giving, Events, one tab at a time.
 * 3. **Right rail** — the records associated with this person (related
 *    people, planned gifts, events, files), each a collapsible section with
 *    its own add action.
 *
 * The tabs are links (`?tab=`), not client state, so every area is a real
 * URL: shareable, refreshable, back-button-correct, rendered on the server.
 */

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TAB_KEYS = ['overview', 'activity', 'proposals', 'giving', 'events'] as const
type TabKey = (typeof TAB_KEYS)[number]

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const contact = await getContact(id)
  return { title: contact ? contactName(contact) : 'Person' }
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || null
}

/** Old links may still carry ?tab=relationships or ?tab=files — those areas
 *  live in the association rail now, so they land on the overview. */
function parseTab(value: string | null): TabKey {
  return value && (TAB_KEYS as readonly string[]).includes(value) ? (value as TabKey) : 'overview'
}

/** How many timeline entries to render. Grows by a page each "Load more". */
function parseShown(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return TIMELINE_PAGE_SIZE
  return Math.min(Math.max(parsed, TIMELINE_PAGE_SIZE), TIMELINE_MAX_LOADED)
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  const [{ id }, query] = await Promise.all([params, searchParams])

  const contact = await getContact(id)
  if (!contact) notFound()

  const type = parseActivityType(first(query.type))
  const shown = parseShown(first(query.show))
  const writable = canWrite(profile)
  const admin = isAdmin(profile)

  // One clock for the whole render, so the day headings and every relative
  // label agree with each other.
  const now = new Date()
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)

  const [
    timeline,
    engagements,
    followUps,
    team,
    engagementTypes,
    giving,
    email,
    related,
    interests,
    interestAreas,
    capability,
    proposals,
    opportunities,
    events,
    eventOptions,
    reports,
    files,
  ] = await Promise.all([
    getContactTimeline(contact.id, { limit: shown, type }),
    getContactEngagements(contact.id),
    getContactFollowUps(contact.id),
    listTeamMembers(),
    listEngagementTypes(),
    getContactGiving(contact.id),
    getContactEmailEngagement(contact.id),
    getRelatedPeople(contact.id),
    getContactInterests(contact.id),
    listInterestAreas(),
    getContactCapability(contact.id),
    getContactProposals(contact.id),
    getContactOpportunities(contact.id),
    getContactEvents(contact.id),
    listEventOptions(),
    getContactCallReports(contact.id),
    getContactAttachments(contact.id),
  ])

  const owner = team.find((member) => member.id === contact.owner_id) ?? null
  const days = groupActivitiesByDay(timeline.activities)
  const basePath = `/contacts/${contact.id}`

  const tab = parseTab(first(query.tab))

  // Giving sits late in the strip on purpose: everyone can see it now, but the
  // record leads with the relationship and the sales conversation, not the money.
  const tabs: TabDefinition[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity', count: timeline.total },
    { key: 'proposals', label: 'Planned gifts', count: proposals.length },
    { key: 'giving', label: 'Giving' },
    { key: 'events', label: 'Events', count: events.length },
  ]

  function tabHref(key: string): string {
    // Only the tab survives the move; a type filter or a "load more" depth
    // belongs to the Activity tab and would be meaningless elsewhere.
    return key === 'overview' ? basePath : `${basePath}?tab=${key}`
  }

  const moreParams = new URLSearchParams()
  moreParams.set('tab', 'activity')
  if (type) moreParams.set('type', type)
  moreParams.set('show', String(Math.min(shown + TIMELINE_PAGE_SIZE, TIMELINE_MAX_LOADED)))
  const canLoadMore = timeline.hasMore && shown < TIMELINE_MAX_LOADED

  const openProposal = primaryProposal(proposals)
  // "Last spoke" means a human interaction, not the machinery reporting on
  // itself — a Mailchimp open is not a conversation.
  const lastInteraction =
    timeline.activities.find((activity) => activity.source === 'manual') ?? null

  const proposalOptions = proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
  }))

  const filesWithUrls = await withDownloadUrls(files)

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4">
      <DonorHeader
        contact={contact}
        name={contactName(contact)}
        owner={owner}
        team={team}
        proposals={proposalOptions}
        canEdit={writable}
        canArchive={admin}
        actions={{
          logInteraction,
          reassign: reassignContactOwner,
          archive: archiveContact,
        }}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1fr)_18.5rem]">
        {/* Zone 1 — identity, persistent. */}
        <aside aria-label="About" className="space-y-3">
          <DonorAbout contact={contact} owner={owner} canEdit={writable} />
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3 shadow-card">
            <DonorPreferences contact={contact} canEdit={writable} action={saveContactPreferences} />
          </div>
        </aside>

        {/* Zone 2 — the relationship workspace. */}
        <div className="min-w-0">
          <Tabs tabs={tabs} active={tab} hrefFor={tabHref} label="Person record sections" />

          <div className="pt-4">
            {tab === 'overview' ? (
              <div className="space-y-6">
                <DonorGlance
                  contactId={contact.id}
                  followUps={followUps}
                  lastInteraction={lastInteraction}
                  opportunity={opportunities.open[0] ?? null}
                  proposal={openProposal}
                  giving={giving}
                  capability={capability}
                  interests={interests}
                  nowIso={nowIso}
                />

                <section className="space-y-2">
                  <SectionHeading title="Relationship summary" />
                  {contact.notes ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {contact.notes}
                    </p>
                  ) : (
                    <p className="text-sm leading-relaxed text-slate-600">
                      Nothing written yet. A few sentences about how we know them and where the
                      relationship stands is the single most useful thing on this record.
                      {writable ? (
                        <>
                          {' '}
                          <Link
                            href={`${basePath}/edit`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Add a summary
                          </Link>
                          .
                        </>
                      ) : null}
                    </p>
                  )}
                </section>

                <ContactOpportunities
                  contactId={contact.id}
                  open={opportunities.open}
                  settled={opportunities.settled}
                  canEdit={writable}
                />

                <DonorInterests
                  contactId={contact.id}
                  interests={interests}
                  areas={interestAreas}
                  canEdit={writable}
                  addAction={addInterest}
                  removeAction={removeInterest}
                />

                <EngagementPanel
                  contactId={contact.id}
                  engagements={engagements}
                  engagementTypes={engagementTypes}
                  team={team}
                  canEdit={writable}
                  today={today}
                  actions={{ add: addEngagement, update: updateEngagement, end: endEngagement }}
                />
              </div>
            ) : null}

            {tab === 'activity' ? (
              <div className="space-y-5">
                {writable ? (
                  <QuickActivityBar
                    contactId={contact.id}
                    contactName={contactName(contact)}
                    proposals={proposalOptions}
                    action={logInteraction}
                  />
                ) : null}

                {reports.length > 0 ? (
                  <section className="space-y-2">
                    <SectionHeading
                      title="Call reports"
                      action={
                        writable ? (
                          <Link
                            href={`/reports/new?contact=${contact.id}`}
                            className="text-[13px] font-medium text-brand-700 hover:underline"
                          >
                            New report
                          </Link>
                        ) : null
                      }
                    />
                    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-card">
                      {reports.map((report) => (
                        <li key={report.id}>
                          <Link
                            href={`/reports/${report.id}`}
                            className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-3.5 py-2 transition-colors hover:bg-slate-50"
                          >
                            <span className="min-w-0 flex-1 basis-64">
                              <span className="block text-sm font-medium text-slate-900">
                                {MEETING_KIND_LABELS[report.meetingKind]} ·{' '}
                                {formatDate(report.metOn)}
                                {report.status === 'draft' ? (
                                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                                    Draft
                                  </span>
                                ) : null}
                              </span>
                              {report.summary ? (
                                <span className="mt-0.5 block truncate text-[13px] text-slate-600">
                                  {report.summary}
                                </span>
                              ) : null}
                            </span>
                            {report.attachmentCount > 0 ? (
                              <span className="shrink-0 text-[13px] text-slate-500">
                                {pluralize(report.attachmentCount, 'file')}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="space-y-2">
                  <SectionHeading
                    title="Activity"
                    description={
                      type
                        ? `${ACTIVITY_TYPE_LABELS[type]} · ${pluralize(timeline.total, 'entry', 'entries')}`
                        : pluralize(timeline.total, 'entry', 'entries')
                    }
                  />
                  <TimelineFilters basePath={basePath} hidden={{ tab: 'activity' }} type={type} />
                  <Timeline days={days} nowIso={nowIso} filtered={type !== null} />
                  {canLoadMore ? (
                    <Link
                      href={`${basePath}?${moreParams.toString()}`}
                      className={buttonClasses('secondary', 'sm')}
                    >
                      Load more
                    </Link>
                  ) : null}
                </section>
              </div>
            ) : null}

            {tab === 'proposals' ? (
              <section className="space-y-3">
                <SectionHeading
                  title="Planned gifts and proposals"
                  description="Trusts, gift annuities, estate provisions and outright gifts under discussion."
                  action={
                    writable ? (
                      <LinkButton
                        href={`/proposals/new?contact=${contact.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Add
                      </LinkButton>
                    ) : null
                  }
                />
                <ProposalList
                  proposals={proposals}
                  nowIso={nowIso}
                  emptyTitle="No planned gifts yet"
                  emptyDescription="When a gift conversation turns into something specific — a trust, an annuity, a bequest — start it here and the whole picture stays in one place."
                  emptyAction={
                    writable ? (
                      <LinkButton href={`/proposals/new?contact=${contact.id}`}>
                        Start a planned gift
                      </LinkButton>
                    ) : null
                  }
                />
              </section>
            ) : null}

            {tab === 'giving' ? (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <ContactGivingPanel giving={giving} />
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3 shadow-card">
                    <DonorCapability
                      contactId={contact.id}
                      capability={capability}
                      canEdit={writable}
                      action={saveCapability}
                    />
                  </div>
                  <ContactEmailPanel engagement={email} />
                </div>
              </div>
            ) : null}

            {tab === 'events' ? (
              <DonorEvents
                contactId={contact.id}
                entries={events}
                events={eventOptions}
                canEdit={writable}
                action={saveAttendee}
              />
            ) : null}
          </div>
        </div>

        {/* Zone 3 — associations. Below the workspace until xl, beside it after. */}
        <aside
          aria-label="Associations"
          className="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-span-2 xl:row-start-1"
        >
          <DonorAssociations
            contactId={contact.id}
            contactName={contactName(contact)}
            related={related}
            opportunities={opportunities.open}
            proposals={proposals}
            events={events}
            eventOptions={eventOptions}
            files={filesWithUrls}
            canEdit={writable}
            currentUserId={profile.id}
            isAdmin={admin}
            actions={{
              addRelationship,
              removeRelationship,
              saveAttendee,
              uploadAttachment,
              removeAttachment,
            }}
          />
        </aside>
      </div>
    </div>
  )
}
