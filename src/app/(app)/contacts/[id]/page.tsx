import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  addEngagement,
  archiveContact,
  createFollowUp,
  endEngagement,
  logActivity,
  reassignContactOwner,
  updateEngagement,
} from '@/app/(app)/contacts/actions'
import { ACTIVITY_TYPE_LABELS, parseActivityType } from '@/components/domain/contact-badges'
import { ContactFollowUpForm } from '@/components/domain/contact-follow-up-form'
import { ContactHeader } from '@/components/domain/contact-header'
import {
  ContactDetailsPanel,
  ContactEmailPanel,
  ContactFollowUpsPanel,
  ContactGivingPanel,
} from '@/components/domain/contact-panels'
import { EngagementPanel } from '@/components/domain/engagement-panel'
import { Timeline } from '@/components/domain/timeline'
import { TimelineFilters } from '@/components/domain/timeline-filters'
import { TimelineLogForm } from '@/components/domain/timeline-log-form'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/display'
import { canViewGiving, canWrite, isAdmin, requireProfile } from '@/lib/auth'
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
import { pluralize } from '@/lib/utils'

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const contact = await getContact(id)
  return { title: contact ? contactName(contact) : 'Contact' }
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || null
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

  // One clock for the whole render, so the day headings and every relative
  // label agree with each other.
  const now = new Date()
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)

  const [timeline, engagements, followUps, team, engagementTypes, giving, email] =
    await Promise.all([
      getContactTimeline(contact.id, { limit: shown, type }),
      getContactEngagements(contact.id),
      getContactFollowUps(contact.id),
      listTeamMembers(),
      listEngagementTypes(),
      showGiving ? getContactGiving(contact.id) : Promise.resolve(null),
      getContactEmailEngagement(contact.id),
    ])

  const owner = team.find((member) => member.id === contact.owner_id) ?? null
  const days = groupActivitiesByDay(timeline.activities)
  const basePath = `/contacts/${contact.id}`

  const moreParams = new URLSearchParams()
  if (type) moreParams.set('type', type)
  moreParams.set('show', String(Math.min(shown + TIMELINE_PAGE_SIZE, TIMELINE_MAX_LOADED)))
  const canLoadMore = timeline.hasMore && shown < TIMELINE_MAX_LOADED

  return (
    <div className="space-y-6">
      <ContactHeader
        contact={contact}
        name={contactName(contact)}
        owner={owner}
        team={team}
        canEdit={writable}
        canArchive={isAdmin(profile)}
        reassignAction={reassignContactOwner}
        archiveAction={archiveContact}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {writable ? (
            <>
              <TimelineLogForm contactId={contact.id} action={logActivity} />
              <ContactFollowUpForm
                contactId={contact.id}
                team={team}
                defaultAssigneeId={profile.id}
                action={createFollowUp}
              />
            </>
          ) : null}

          <Card>
            <CardHeader
              title="Timeline"
              description={
                type
                  ? `${ACTIVITY_TYPE_LABELS[type]} · ${pluralize(timeline.total, 'entry', 'entries')}`
                  : pluralize(timeline.total, 'entry', 'entries')
              }
            />
            <div className="border-b border-slate-200 px-4 py-3">
              <TimelineFilters basePath={basePath} type={type} />
            </div>

            <Timeline days={days} nowIso={nowIso} filtered={type !== null} />

            {canLoadMore ? (
              <div className="border-t border-slate-200 px-4 py-3">
                <Link
                  href={`${basePath}?${moreParams.toString()}`}
                  className={buttonClasses('secondary', 'sm')}
                >
                  Load more
                </Link>
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="space-y-6" aria-label="Contact summary">
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

          <ContactFollowUpsPanel followUps={followUps} nowIso={nowIso} />

          {/* Absent rather than empty for staff without the giving flag. */}
          {giving ? <ContactGivingPanel giving={giving} /> : null}

          <ContactEmailPanel engagement={email} />
        </aside>
      </div>
    </div>
  )
}
