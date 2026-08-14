import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { removeAttachment, uploadAttachment } from '@/app/(app)/contacts/donor-actions'
import { fileCallReport, saveCallReportDraft } from '@/app/(app)/reports/actions'
import { AttachmentsPanel } from '@/components/domain/attachments-panel'
import { CallReportForm } from '@/components/domain/call-report-form'
import { MEETING_KIND_LABELS } from '@/components/domain/development-badges'
import { LinkButton } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canWrite, isAdmin, requireProfile } from '@/lib/auth'
import { withDownloadUrls } from '@/lib/queries/attachments'
import { getCallReport } from '@/lib/queries/call-reports'
import { listTeamMembers } from '@/lib/queries/contacts'
import { getProposal, listProposalOptions } from '@/lib/queries/proposals'
import { formatDate } from '@/lib/utils'

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const detail = await getCallReport(id)
  return { title: detail ? `Call report — ${formatDate(detail.report.met_on)}` : 'Call report' }
}

/**
 * One call report, read as a document.
 *
 * Sections that were left empty are not rendered at all. An empty "Concerns"
 * heading tells a reader nothing except that the form had a box — and a page
 * of empty headings is exactly the database-administration feeling the
 * redesign is removing.
 */
export default async function CallReportPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  const [{ id }, query] = await Promise.all([params, searchParams])

  const detail = await getCallReport(id)
  if (!detail) notFound()

  const { report, contact, jointContact, attachments } = detail
  const writable = canWrite(profile)
  const mine = report.author_id === profile.id
  const editable = writable && (mine || isAdmin(profile))
  const editing = editable && (Array.isArray(query.edit) ? query.edit[0] : query.edit) === '1'

  const [team, proposals, proposal] = await Promise.all([
    listTeamMembers(),
    contact ? listProposalOptions(contact.id) : Promise.resolve([]),
    report.proposal_id ? getProposal(report.proposal_id) : Promise.resolve(null),
  ])

  if (editing && contact) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link href={`/reports/${report.id}`} className="text-sm font-medium text-brand-700 hover:underline">
            ← Back to the report
          </Link>
          <h1 className="mt-2 text-xl font-bold leading-tight text-slate-900">
            Edit report
          </h1>
        </div>
        <CallReportForm
          report={report}
          contactId={contact.id}
          contactName={contact.name}
          jointContactName={jointContact?.name ?? null}
          team={team}
          proposals={proposals}
          currentUserId={profile.id}
          today={report.met_on}
          draftAction={saveCallReportDraft}
          fileAction={fileCallReport}
          cancelHref={`/reports/${report.id}`}
        />
      </div>
    )
  }

  const author = team.find((member) => member.id === report.author_id) ?? null
  const colleagues = report.staff_attendee_ids
    .map((memberId) => team.find((member) => member.id === memberId))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)

  const sections: Array<{ title: string; body: string | null }> = [
    { title: 'How it went', body: report.summary },
    { title: 'What we talked about', body: report.discussion_points },
    { title: 'What they are interested in', body: report.interests_expressed },
    { title: 'What is worrying them', body: report.concerns },
    { title: 'What they committed to', body: report.commitments },
    { title: 'What we need to do', body: report.next_steps },
  ]
  const written = sections.filter((section) => section.body?.trim())

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-4">
        <div>
          {contact ? (
            <Link href={`/contacts/${contact.id}`} className="text-sm font-medium text-brand-700 hover:underline">
              ← {contact.name}
            </Link>
          ) : (
            <Link href="/reports" className="text-sm font-medium text-brand-700 hover:underline">
              ← Reports
            </Link>
          )}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
                Call report
              </h1>
              <p className="mt-1 text-[15px] text-slate-600">
                {MEETING_KIND_LABELS[report.meeting_kind]} on {formatDate(report.met_on)}
                {report.met_at_time ? ` at ${report.met_at_time.slice(0, 5)}` : ''}
                {report.location ? ` · ${report.location}` : ''}
              </p>
              {contact ? (
                <p className="mt-1 text-[15px] text-slate-700">
                  With{' '}
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {contact.name}
                  </Link>
                  {jointContact ? (
                    <>
                      {' and '}
                      <Link
                        href={`/contacts/${jointContact.id}`}
                        className="font-medium text-brand-800 hover:underline"
                      >
                        {jointContact.name}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {report.status === 'draft' ? <Badge tone="amber">Draft</Badge> : null}
              {editable ? (
                <LinkButton href={`/reports/${report.id}?edit=1`} variant="secondary" size="lg">
                  Edit
                </LinkButton>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 py-3 text-sm text-slate-600">
          {author ? (
            <span className="inline-flex items-center gap-2">
              <Avatar name={author.name} size="sm" />
              Written by {author.name}
            </span>
          ) : null}
          {colleagues.length > 0 ? (
            <span>With {colleagues.map((member) => member.name).join(', ')}</span>
          ) : null}
          {report.external_attendees ? <span>Also there: {report.external_attendees}</span> : null}
          {proposal ? (
            <Link
              href={`/proposals/${proposal.proposal.id}`}
              className="font-medium text-brand-700 hover:underline"
            >
              About: {proposal.proposal.title}
            </Link>
          ) : null}
        </div>
      </header>

      {report.status === 'draft' ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This is a draft. Only you can see it, and it is not on{' '}
          {contact ? `${contact.name}'s` : 'the'} timeline until you file it.
        </p>
      ) : null}

      {written.length === 0 ? (
        <p className="text-[15px] leading-relaxed text-slate-600">
          Nothing has been written yet.
          {editable ? (
            <>
              {' '}
              <Link href={`/reports/${report.id}?edit=1`} className="font-medium text-brand-700 hover:underline">
                Write it up
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : (
        <div className="space-y-7">
          {written.map((section) => (
            <Section key={section.title} title={section.title}>
              {section.body}
            </Section>
          ))}
        </div>
      )}

      {report.follow_up_on ? (
        <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-800">
          Follow-up set for <strong>{formatDate(report.follow_up_on)}</strong>
          {report.follow_up_id ? (
            <>
              {' — '}
              <Link href="/follow-ups" className="font-medium text-brand-700 hover:underline">
                see your queue
              </Link>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {contact ? (
        <AttachmentsPanel
          contactId={contact.id}
          callReportId={report.id}
          attachments={await withDownloadUrls(attachments)}
          canEdit={editable}
          currentUserId={profile.id}
          isAdmin={isAdmin(profile)}
          uploadAction={uploadAttachment}
          removeAction={removeAttachment}
          title="Attachments"
          description="Proposal documents, estate papers, scans, photographs — anything that belongs with this meeting."
        />
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionHeading title={title} />
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">{children}</p>
    </section>
  )
}
