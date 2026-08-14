import { createProposal } from '@/app/(app)/proposals/actions'
import { ProposalForm } from '@/components/domain/proposal-form'
import { PersonPicker } from '@/components/domain/person-picker'
import { PageHeader } from '@/components/ui/display'
import { LinkButton } from '@/components/ui/button'
import { requireWriteAccess } from '@/lib/auth'
import { contactName, getContact, listTeamMembers } from '@/lib/queries/contacts'

export const metadata = { title: 'New proposal' }

/**
 * A proposal always belongs to somebody, so this page insists on knowing who
 * before it asks anything else. Reached from a donor record it already knows;
 * reached from the Proposals destination it says so plainly rather than
 * offering a donor field buried among fifteen others.
 */
export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireWriteAccess()
  const params = await searchParams
  const raw = Array.isArray(params.contact) ? params.contact[0] : params.contact
  const contact = raw ? await getContact(raw) : null
  const team = await listTeamMembers()
  const today = new Date().toISOString().slice(0, 10)

  if (!contact) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="New proposal" description="Who is this proposal for?" />
        {/* Not a form that posts: choosing the donor navigates to the real
            form, which then knows who it is about from the first field. */}
        <form action="/proposals/new" method="get" className="space-y-5 rounded-lg bg-white p-6 shadow-card">
          <PersonPicker name="contact" label="Which person?" required />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-brand-600 px-5 text-base font-medium text-white transition-colors hover:bg-brand-700"
            >
              Continue
            </button>
            <LinkButton href="/proposals" variant="ghost" size="lg">
              Cancel
            </LinkButton>
          </div>
        </form>
      </div>
    )
  }

  const name = contactName(contact)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New proposal" description={`For ${name}.`} />
      <ProposalForm
        contactId={contact.id}
        contactName={name}
        team={team}
        defaultOwnerId={profile.id}
        today={today}
        action={createProposal}
        submitLabel="Create proposal"
        cancelHref={`/contacts/${contact.id}?tab=proposals`}
      />
    </div>
  )
}
