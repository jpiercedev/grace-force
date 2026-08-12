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
import { ContactDetailsPanel, ContactEmailPanel, ContactGivingPanel } from '@/components/domain/contact-panels'
import { AttachmentsPanel } from '@/components/domain/attachments-panel'
import { MEETING_KIND_LABELS } from '@/components/domain/development-badges'
import { DonorEvents } from '@/components/domain/donor/donor-events'
import { DonorGlance } from '@/components/domain/donor/donor-glance'
import { DonorHeader } from '@/components/domain/donor/donor-header'
import { DonorInterests } from '@/components/domain/donor/donor-interests'
import { DonorCapability, DonorPreferences } from '@/components/domain/donor/donor-preferences'
import { DonorRelationships } from '@/components/domain/donor/donor-relationships'
import { EngagementPanel } from '@/components/domain/engagement-panel'
import { ProposalList } from '@/components/domain/proposal-list'
import { Timeline } from '@/components/domain/timeline'
import { TimelineFilters } from '@/components/domain/timeline-filters'
import { LinkButton, buttonClasses } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/display'
import { SectionHeading, Tabs, type TabDefinition } from '@/components/ui/tabs'
import { canViewGiving, canWrite, isAdmin, requireProfile } from '@/lib/auth'
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
import { getContactProposals, primaryProposal } from '@/lib/queries/proposals'
import {
  getContactCapability,
  getContactInterests,
  getRelatedPeople,
  listInterestAreas,
} from '@/lib/queries/relationships'
import { formatDate, pluralize } from '@/lib/utils'

/**
 * The donor record — the heart of the application.
 *
 * It used to be nine equal-weight cards stacked down one page, with two forms
 * permanently open before anyone asked for them. It is now three layers:
 *
 * 1. **Header** — who, how to reach them the way they want, who owns the
 *    relationship, and one primary action.
 * 2. **Glance** — six answers: what is owed, when we last spoke, what is in
 *    flight, what they have given, what they might be capable of, what they
 *    care about.
 * 3. **One tab at a time** — Activity by default, then Overview, Giving,
 *    Proposals, Events, Relationships, Files.
 *
 * The tabs are links (`?tab=`), not client state, so every area is a real URL:
 * shareable, refreshable, back-button-correct, and rendered on the server.
 */

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TAB_KEYS = [
  'activity',
  'overview',
  'giving',
  'proposals',
  'events',
  'relationships',
  'files',
] as const
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

function parseTab(value: string | null, allowed: readonly TabKey[]): TabKey {
  return value && (allowed as readonly string[]).includes(value) ? (value as TabKey) : 'activity'
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
  const showGiving = canViewGiving(profile)
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
    showGiving ? getContactGiving(contact.id) : Promise.resolve(null),
    getContactEmailEngagement(contact.id),
    getRelatedPeople(contact.id),
    getContactInterests(contact.id),
    listInterestAreas(),
    showGiving ? getContactCapability(contact.id) : Promise.resolve(null),
    showGiving ? getContactProposals(contact.id) : Promise.resolve([]),
    getContactEvents(contact.id),
    listEventOptions(),
    getContactCallReports(contact.id),
    getContactAttachments(contact.id),
  ])

  const owner = team.find((member) => member.id === contact.owner_id) ?? null
  const days = groupActivitiesByDay(timeline.activities)
  const basePath = `/contacts/${contact.id}`

  // A tab a viewer cannot see must not be selectable, or a shared link lands
  // them on an empty page with no explanation.
  const allowed = TAB_KEYS.filter((key) => showGiving || (key !== 'giving' && key !== 'proposals'))
  const tab = parseTab(first(query.tab), allowed)

  const tabs: TabDefinition[] = [
    { key: 'activity', label: 'Activity', count: timeline.total },
    { key: 'overview', label: 'Overview' },
    ...(showGiving
      ? ([
          { key: 'giving', label: 'Giving' },
          { key: 'proposals', label: 'Proposals', count: proposals.length },
        ] as TabDefinition[])
      : []),
    { key: 'events', label: 'Events', count: events.length },
    { key: 'relationships', label: 'Relationships', count: related.length },
    { key: 'files', label: 'Files', count: files.length },
  ]

  function tabHref(key: string): string {
    // Only the tab survives the move; a type filter or a "load more" depth
    // belongs to the Activity tab and would be meaningless elsewhere.
    return key === 'activity' ? basePath : `${basePath}?tab=${key}`
  }

  const moreParams = new URLSearchParams()
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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

      <DonorGlance
        contactId={contact.id}
        followUps={followUps}
        lastInteraction={lastInteraction}
        proposal={openProposal}
        giving={giving}
        capability={capability}
        interests={interests}
        nowIso={nowIso}
      />

      <Tabs tabs={tabs} active={tab} hrefFor={tabHref} label="Donor record sections" />

      {tab === 'activity' ? (
        <div className="space-y-8">
          {reports.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="Call reports"
                action={
                  <Link
                    href={`/reports/new?contact=${contact.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    New report
                  </Link>
                }
              />
              <ul className="divide-y divide-slate-200 border-t border-slate-200">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/reports/${report.id}`}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span className="min-w-0 flex-1 basis-64">
                        <span className="block text-[15px] font-medium text-slate-900">
                          {MEETING_KIND_LABELS[report.meetingKind]} ·{' '}
                          {formatDate(report.metOn)}
                          {report.status === 'draft' ? (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                              Draft
                            </span>
                          ) : null}
                        </span>
                        {report.summary ? (
                          <span className="mt-0.5 block truncate text-sm text-slate-600">
                            {report.summary}
                          </span>
                        ) : null}
                      </span>
                      {report.attachmentCount > 0 ? (
                        <span className="shrink-0 text-sm text-slate-500">
                          {pluralize(report.attachmentCount, 'file')}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-3">
            <SectionHeading
              title="Everything that happened"
              description={
                type
                  ? `${ACTIVITY_TYPE_LABELS[type]} · ${pluralize(timeline.total, 'entry', 'entries')}`
                  : pluralize(timeline.total, 'entry', 'entries')
              }
            />
            <TimelineFilters basePath={basePath} type={type} />
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

      {tab === 'overview' ? (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div className="space-y-8">
            <section className="space-y-3">
              <SectionHeading title="Relationship summary" />
              {contact.notes ? (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
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

            <DonorInterests
              contactId={contact.id}
              interests={interests}
              areas={interestAreas}
              canEdit={writable}
              addAction={addInterest}
              removeAction={removeInterest}
            />

            <DonorPreferences
              contact={contact}
              canEdit={writable}
              action={saveContactPreferences}
            />
          </div>

          <div className="space-y-8">
            <ContactDetailsPanel contact={contact} />
            <EngagementPanel
              contactId={contact.id}
              engagements={engagements}
              engagementTypes={engagementTypes}
              team={team}
              canEdit={writable}
              today={today}
              actions={{ add: addEngagement, update: updateEngagement, end: endEngagement }}
            />
            <ContactEmailPanel engagement={email} />
          </div>
        </div>
      ) : null}

      {tab === 'giving' && giving ? (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <ContactGivingPanel giving={giving} />
          <DonorCapability
            contactId={contact.id}
            capability={capability}
            canEdit={writable}
            action={saveCapability}
          />
        </div>
      ) : null}

      {tab === 'proposals' && showGiving ? (
        <section className="space-y-4">
          <SectionHeading
            title="Proposals and planned gifts"
            description="Trusts, gift annuities, estate provisions and outright gifts under discussion."
            action={
              writable ? (
                <LinkButton href={`/proposals/new?contact=${contact.id}`} variant="secondary">
                  Add proposal
                </LinkButton>
              ) : null
            }
          />
          <ProposalList
            proposals={proposals}
            nowIso={nowIso}
            emptyTitle="No proposals yet"
            emptyDescription="When a gift conversation turns into something specific — a trust, an annuity, a bequest — start it here and the whole picture stays in one place."
            emptyAction={
              writable ? (
                <LinkButton href={`/proposals/new?contact=${contact.id}`}>Start a proposal</LinkButton>
              ) : null
            }
          />
        </section>
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

      {tab === 'relationships' ? (
        <DonorRelationships
          contactId={contact.id}
          contactName={contactName(contact)}
          people={related}
          canEdit={writable}
          addAction={addRelationship}
          removeAction={removeRelationship}
        />
      ) : null}

      {tab === 'files' ? (
        <AttachmentsPanel
          contactId={contact.id}
          attachments={await withDownloadUrls(files)}
          canEdit={writable}
          currentUserId={profile.id}
          isAdmin={admin}
          uploadAction={uploadAttachment}
          removeAction={removeAttachment}
        />
      ) : null}

      {/* A giving-gated tab reached by a shared link, by someone without the
          capability: say so rather than showing an empty page. */}
      {(tab === 'giving' && !giving) || (tab === 'proposals' && !showGiving) ? (
        <EmptyState
          title="Not available to your account"
          description="Giving records and proposals are limited to administrators and staff granted access to them."
        />
      ) : null}
    </div>
  )
}
