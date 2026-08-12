import { createContact } from '@/app/(app)/contacts/actions'
import { ContactForm } from '@/components/domain/contact-form'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { listTeamMembers } from '@/lib/queries/contacts'

export const metadata = { title: 'Add a person' }

export default async function NewContactPage() {
  const profile = await requireWriteAccess()
  const team = await listTeamMembers()

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add a person"
        description="A name is all that is required. Everything else can be added as you learn it."
      />
      <ContactForm
        action={createContact}
        team={team}
        // Whoever adds someone is normally the one who will follow up.
        defaultOwnerId={profile.id}
        cancelHref="/contacts"
        submitLabel="Add person"
      />
    </div>
  )
}
