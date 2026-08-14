import Link from 'next/link'
import { AttachmentsPanel, type AttachmentWithUrl } from '@/components/domain/attachments-panel'
import { ProposalStatusBadge } from '@/components/domain/development-badges'
import { DonorEvents } from '@/components/domain/donor/donor-events'
import { DonorRelationships } from '@/components/domain/donor/donor-relationships'
import { RailSection } from '@/components/ui/rail'
import type { ContactEventEntry } from '@/lib/queries/events'
import type { ProposalSummary } from '@/lib/queries/proposals'
import type { RelatedPerson } from '@/lib/queries/relationships'
import { formatCurrency } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { EventRow } from '@/types/database'

/**
 * The association rail of the donor record: the records connected to this
 * person, each in a collapsible section with a count, a handful of entries,
 * and its own add action. Secondary relationship context lives here so the
 * center workspace stays about working the relationship.
 *
 * Sections with data start open; empty ones start closed but stay visible,
 * because knowing a donor has no linked people is itself information.
 */
export function DonorAssociations({
  contactId,
  contactName,
  related,
  proposals,
  events,
  eventOptions,
  files,
  canEdit,
  currentUserId,
  isAdmin,
  actions,
}: {
  contactId: string
  contactName: string
  related: RelatedPerson[]
  proposals: ProposalSummary[]
  events: ContactEventEntry[]
  eventOptions: Array<Pick<EventRow, 'id' | 'name' | 'event_date'>>
  files: AttachmentWithUrl[]
  canEdit: boolean
  currentUserId: string
  isAdmin: boolean
  actions: {
    addRelationship: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
    removeRelationship: (
      state: ContactActionState,
      formData: FormData,
    ) => Promise<ContactActionState>
    saveAttendee: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
    uploadAttachment: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
    removeAttachment: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  }
}) {
  const basePath = `/contacts/${contactId}`

  return (
    <div className="space-y-3">
      <RailSection title="Related people" count={related.length} defaultOpen={related.length > 0}>
        <DonorRelationships
          compact
          contactId={contactId}
          contactName={contactName}
          people={related}
          canEdit={canEdit}
          addAction={actions.addRelationship}
          removeAction={actions.removeRelationship}
        />
      </RailSection>

      <RailSection
        title="Planned gifts"
        count={proposals.length}
        defaultOpen={proposals.length > 0}
      >
          {proposals.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-slate-500">
              Nothing under discussion yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {proposals.slice(0, 4).map((proposal) => (
                <li key={proposal.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <Link
                      href={`/proposals/${proposal.id}`}
                      className="min-w-0 truncate text-[13px] font-medium text-brand-700 hover:underline"
                    >
                      {proposal.title}
                    </Link>
                    <ProposalStatusBadge status={proposal.status} />
                  </div>
                  {proposal.amountCents !== null ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatCurrency(proposal.amountCents, proposal.currency)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {canEdit ? (
              <Link
                href={`/proposals/new?contact=${contactId}`}
                className="text-[13px] font-medium text-brand-700 hover:underline"
              >
                + Start a planned gift
              </Link>
            ) : null}
            {proposals.length > 4 ? (
              <Link
                href={`${basePath}?tab=proposals`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                View all {proposals.length}
              </Link>
            ) : null}
          </div>
      </RailSection>

      <RailSection title="Events" count={events.length} defaultOpen={events.length > 0}>
        <DonorEvents
          compact
          limit={3}
          viewAllHref={`${basePath}?tab=events`}
          contactId={contactId}
          entries={events}
          events={eventOptions}
          canEdit={canEdit}
          action={actions.saveAttendee}
        />
      </RailSection>

      <RailSection title="Files" count={files.length} defaultOpen={files.length > 0}>
        <AttachmentsPanel
          compact
          contactId={contactId}
          attachments={files}
          canEdit={canEdit}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          uploadAction={actions.uploadAttachment}
          removeAction={actions.removeAttachment}
        />
      </RailSection>
    </div>
  )
}
