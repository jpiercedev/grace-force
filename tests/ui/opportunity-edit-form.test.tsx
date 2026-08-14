import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpportunityEditForm } from '@/components/domain/opportunity-edit-form'
import type { PipelineActionState } from '@/app/(app)/sales/actions'
import type { OpportunityListItem, TeamProfile } from '@/lib/queries/pipelines'

/**
 * The edit page is where an opportunity's facts are corrected, so the form
 * must show exactly what is stored — cents rendered as dollars, dates as
 * dates — and hand every one of those fields back to the action on save.
 */

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111'

const TEAM: TeamProfile[] = [
  { id: 'pppppppp-1111-4111-8111-111111111111', full_name: 'Dana Okoro', email: 'dana@example.org' },
  { id: 'pppppppp-2222-4222-8222-222222222222', full_name: null, email: 'sam@example.org' },
]

function makeOpportunity(overrides: Partial<OpportunityListItem> = {}): OpportunityListItem {
  return {
    id: OPPORTUNITY_ID,
    pipeline_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    stage_id: 'ssssssss-1111-4111-8111-111111111111',
    contact_id: 'cccccccc-1111-4111-8111-111111111111',
    title: 'Spring appeal ask',
    details: 'Met at the gala.',
    value_cents: 250_000,
    currency: 'USD',
    status: 'open',
    owner_id: TEAM[0]!.id,
    expected_close_on: '2026-09-30',
    organization_name: 'St Mary Parish',
    next_step: 'Send the proposal draft',
    position: 0,
    created_at: '2026-08-01T12:00:00.000Z',
    closed_at: null,
    close_reason: null,
    updated_at: '2026-08-10T12:00:00.000Z',
    contact: {
      id: 'cccccccc-1111-4111-8111-111111111111',
      full_name: 'Ruth Alvarez',
      preferred_name: null,
      first_name: 'Ruth',
      last_name: 'Alvarez',
      organization_name: null,
      email: 'ruth@example.org',
    },
    owner: TEAM[0]!,
    pipeline: {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      slug: 'major-gift',
      name: 'Major gift',
      tracks_value: true,
    },
    stage: {
      id: 'ssssssss-1111-4111-8111-111111111111',
      name: 'Identified',
      color: 'slate',
      is_won: false,
      is_lost: false,
    },
    creator: TEAM[1]!,
    ...overrides,
  }
}

/** Records what the server action would have received. */
function recordingAction(result: PipelineActionState = { notice: 'Saved “Spring appeal ask”.' }) {
  const calls: Record<string, string>[] = []
  const action = vi.fn(async (_prev: PipelineActionState, formData: FormData) => {
    const entries: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entries[key] = value
    }
    calls.push(entries)
    return result
  })
  return { action, calls }
}

describe('OpportunityEditForm', () => {
  it('prefills every field from the stored opportunity, rendering cents as dollars', () => {
    const { action } = recordingAction()
    render(
      <OpportunityEditForm action={action} opportunity={makeOpportunity()} team={TEAM} tracksValue />,
    )

    expect(screen.getByLabelText(/^title\*?$/i)).toHaveValue('Spring appeal ask')
    expect(screen.getByLabelText('Organization')).toHaveValue('St Mary Parish')
    expect(screen.getByLabelText('Owner')).toHaveValue(TEAM[0]!.id)
    expect(screen.getByLabelText('Expected value')).toHaveValue('2,500')
    expect(screen.getByLabelText('Expected close')).toHaveValue('2026-09-30')
    expect(screen.getByLabelText('Next step')).toHaveValue('Send the proposal draft')
    expect(screen.getByLabelText('Notes')).toHaveValue('Met at the gala.')
  })

  it('posts the id and every field back to the action on save', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(
      <OpportunityEditForm action={action} opportunity={makeOpportunity()} team={TEAM} tracksValue />,
    )

    const nextStep = screen.getByLabelText('Next step')
    await user.clear(nextStep)
    await user.type(nextStep, 'Book the site visit')
    await user.selectOptions(screen.getByLabelText('Owner'), TEAM[1]!.id)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      id: OPPORTUNITY_ID,
      title: 'Spring appeal ask',
      organization_name: 'St Mary Parish',
      owner_id: TEAM[1]!.id,
      value_cents: '2,500',
      expected_close_on: '2026-09-30',
      next_step: 'Book the site visit',
      details: 'Met at the gala.',
    })
  })

  it('offers no value field when the pipeline does not track value', () => {
    const { action } = recordingAction()
    render(
      <OpportunityEditForm
        action={action}
        opportunity={makeOpportunity({ value_cents: null })}
        team={TEAM}
        tracksValue={false}
      />,
    )

    expect(screen.queryByLabelText('Expected value')).not.toBeInTheDocument()
    // Everything else survives the omission.
    expect(screen.getByLabelText('Expected close')).toBeInTheDocument()
  })

  it('reports a refusal as an alert', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction({ error: 'That opportunity is no longer open.' })
    render(
      <OpportunityEditForm action={action} opportunity={makeOpportunity()} team={TEAM} tracksValue />,
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer open')
  })

  it('confirms a save as a status, not an interruption', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction({ notice: 'Saved “Spring appeal ask”.' })
    render(
      <OpportunityEditForm action={action} opportunity={makeOpportunity()} team={TEAM} tracksValue />,
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
