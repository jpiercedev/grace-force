import { notFound } from 'next/navigation'
import { updateContact } from '@/app/(app)/contacts/actions'
import { ContactForm } from '@/components/domain/contact-form'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { contactName, getContact, listTeamMembers } from '@/lib/queries/contacts'

export const metadata = { title: 'Edit contact' }

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireWriteAccess()
  const { id } = await params
  const [contact, team] = await Promise.all([getContact(id), listTeamMembers()])
  if (!contact) notFound()

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${contactName(contact)}`} />
      <ContactForm
        action={updateContact}
        contact={contact}
        team={team}
        cancelHref={`/contacts/${contact.id}`}
        submitLabel="Save changes"
      />
    </div>
  )
}
