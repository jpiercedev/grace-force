import { createEvent } from '@/app/(app)/events/actions'
import { EventForm } from '@/components/domain/event-form'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { listTeamMembers } from '@/lib/queries/contacts'

export const metadata = { title: 'New event' }

export default async function NewEventPage() {
  const profile = await requireWriteAccess()
  const team = await listTeamMembers()
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New event"
        description="Add it now; record who came afterwards."
      />
      <EventForm
        team={team}
        defaultOwnerId={profile.id}
        today={today}
        action={createEvent}
        submitLabel="Create event"
        cancelHref="/events"
      />
    </div>
  )
}
