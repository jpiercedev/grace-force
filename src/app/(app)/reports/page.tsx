import Link from 'next/link'
import { MEETING_KIND_LABELS } from '@/components/domain/development-badges'
import { LinkButton } from '@/components/ui/button'
import { Avatar, EmptyState, PageHeader } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canWrite, requireProfile } from '@/lib/auth'
import { listCallReports } from '@/lib/queries/call-reports'
import { formatDate, pluralize } from '@/lib/utils'

export const metadata = { title: 'Reports' }

/**
 * Call reports — every donor meeting anyone has written up.
 *
 * Drafts come first and are labelled, because an unfinished report is a task,
 * not a record. RLS already limits drafts to their author, so the section
 * below is genuinely "yours to finish" rather than a public pile of half-
 * written notes.
 */
export default async function ReportsPage() {
  const profile = await requireProfile()
  const writable = canWrite(profile)
  const reports = await listCallReports({})

  const drafts = reports.filter((report) => report.status === 'draft')
  const filed = reports.filter((report) => report.status === 'filed')

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Reports"
        description="Write-ups of donor meetings and calls."
        action={writable ? <LinkButton href="/reports/new" size="lg">New report</LinkButton> : null}
      />

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="After a significant conversation, write it up here. What they care about, what worried them, what they agreed to — it is the record everyone else relies on."
          action={writable ? <LinkButton href="/reports/new">Write the first one</LinkButton> : null}
        />
      ) : null}

      {drafts.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            title="Your drafts"
            description="Not on anyone's timeline until you file them."
          />
          <ReportRows reports={drafts} />
        </section>
      ) : null}

      {filed.length > 0 ? (
        <section className="space-y-3">
          {drafts.length > 0 ? <SectionHeading title="Filed" /> : null}
          <ReportRows reports={filed} />
        </section>
      ) : null}
    </div>
  )
}

function ReportRows({
  reports,
}: {
  reports: Awaited<ReturnType<typeof listCallReports>>
}) {
  return (
    <ul className="divide-y divide-slate-200 border-t border-slate-200">
      {reports.map((report) => (
        <li key={report.id}>
          <Link
            href={`/reports/${report.id}`}
            className="flex items-start gap-3 py-3.5 transition-colors hover:bg-slate-50"
          >
            {report.contact ? <Avatar name={report.contact.name} size="md" /> : null}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15px] font-medium text-slate-900">
                  {report.contact?.name ?? 'Unknown person'}
                </span>
                <span className="text-sm text-slate-500">
                  {MEETING_KIND_LABELS[report.meetingKind]} · {formatDate(report.metOn)}
                </span>
              </span>
              {report.summary ? (
                <span className="mt-0.5 block truncate text-sm text-slate-600">
                  {report.summary}
                </span>
              ) : (
                <span className="mt-0.5 block text-sm italic text-slate-500">
                  Nothing written yet
                </span>
              )}
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
  )
}
