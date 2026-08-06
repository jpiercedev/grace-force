import { createContact } from '@/app/(app)/contacts/actions'
import { ContactForm } from '@/components/domain/contact-form'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { listTeamMembers } from '@/lib/queries/contacts'

export const metadata = { title: 'New contact' }

export default async function NewContactPage() {
  const profile = await requireWriteAccess()
  const team = await listTeamMembers()

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Contacts"
        title="New contact"
        description="A first or last name, or an organisation, is all that is required."
      />
      <ContactForm
        action={createContact}
        team={team}
        // Whoever adds someone is normally the one who will follow up.
        defaultOwnerId={profile.id}
        cancelHref="/contacts"
        submitLabel="Create contact"
      />
    </div>
  )
}
