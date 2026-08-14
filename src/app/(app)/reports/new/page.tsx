import { fileCallReport, saveCallReportDraft } from '@/app/(app)/reports/actions'
import { CallReportForm } from '@/components/domain/call-report-form'
import { PersonPicker } from '@/components/domain/person-picker'
import { LinkButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { contactName, getContact, listTeamMembers } from '@/lib/queries/contacts'
import { listProposalOptions } from '@/lib/queries/proposals'

export const metadata = { title: 'New call report' }

/**
 * A report is always about somebody, so the donor is settled before anything
 * else is asked. Arriving from a donor record it is already known; arriving
 * from Reports, one question stands alone on the page.
 */
export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireWriteAccess()
  const params = await searchParams
  const raw = Array.isArray(params.contact) ? params.contact[0] : params.contact
  const contact = raw ? await getContact(raw) : null
  const today = new Date().toISOString().slice(0, 10)

  if (!contact) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="New call report" description="Who did you meet?" />
        <form
          action="/reports/new"
          method="get"
          className="space-y-5 rounded-lg bg-white p-6 shadow-card"
        >
          <PersonPicker name="contact" label="Which person?" required />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-brand-600 px-5 text-base font-medium text-white transition-colors hover:bg-brand-700"
            >
              Continue
            </button>
            <LinkButton href="/reports" variant="ghost" size="lg">
              Cancel
            </LinkButton>
          </div>
        </form>
      </div>
    )
  }

  const [team, proposals] = await Promise.all([
    listTeamMembers(),
    listProposalOptions(contact.id),
  ])
  const name = contactName(contact)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Call report" description={`Your write-up of meeting ${name}.`} />
      <CallReportForm
        contactId={contact.id}
        contactName={name}
        team={team}
        proposals={proposals}
        currentUserId={profile.id}
        today={today}
        draftAction={saveCallReportDraft}
        fileAction={fileCallReport}
        cancelHref={`/contacts/${contact.id}`}
      />
    </div>
  )
}
