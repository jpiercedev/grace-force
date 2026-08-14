import { Callout, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { requireAdmin } from '@/lib/auth'
import { listEngagementTypes } from '@/lib/queries/contacts'
import { countLiveEngagementsByType } from '@/lib/queries/team'
import { pluralize } from '@/lib/utils'
import { NewEngagementType } from './new-type'
import { TypeRow } from './type-row'

export const metadata = { title: 'Engagement types' }

/**
 * The catalogue of ways a contact can relate to Grace.
 *
 * Admin-only because it shapes reporting across the whole organisation — the
 * same reason the database restricts writes on `engagement_types` to admins.
 */
export default async function EngagementTypesPage() {
  await requireAdmin()

  const types = await listEngagementTypes()
  const liveCounts = await countLiveEngagementsByType(types.map((type) => type.id))
  const activeCount = types.filter((type) => type.is_active).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Engagement types"
        description="The ways a contact can relate to Grace. One contact can hold several at once."
      />

      <Callout tone="info" title="Slugs are permanent">
        <p>
          A type&rsquo;s slug is written once and never changed. The public lead form posts it as
          the visitor&rsquo;s interest and the Mailchimp sync looks up{' '}
          <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-xs ring-1 ring-inset ring-slate-200">
            newsletter
          </code>{' '}
          by slug, so renaming one would leave both looking for something that no longer exists —
          with no error to notice. Change the label instead; it is what everyone actually reads.
        </p>
      </Callout>

      <Card>
        <CardHeader
          title="Catalogue"
          description={`${pluralize(types.length, 'type')}, ${activeCount} offered for new engagements.`}
        />
        {types.length === 0 ? (
          <EmptyState
            title="No engagement types yet"
            description="The migrations seed eight to start with. Add one below if this catalogue is empty."
          />
        ) : (
          <ul className="divide-y divide-slate-200/70">
            {types.map((type) => (
              <TypeRow key={type.id} type={type} liveEngagements={liveCounts.get(type.id) ?? 0} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Add a type"
          description="Pick a label, a colour from the fixed palette, and where it sorts in pickers."
        />
        <NewEngagementType />
      </Card>

      <p className="px-1 text-sm text-slate-500">
        Types are never deleted. Engagements point at them, and a form somewhere may still post the
        slug; deactivating removes it from pickers while leaving history intact.
      </p>
    </div>
  )
}
