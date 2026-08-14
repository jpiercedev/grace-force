import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PipelineAddForm, type PipelineChoice } from '@/components/domain/pipeline-add-form'
import type { PipelineActionState } from '@/app/(app)/sales/actions'
import type { ContactSummary, TeamProfile } from '@/lib/queries/pipelines'

/**
 * The add form now serves two doors: the board (pipeline fixed) and the person
 * or Sales overview (pipeline chosen in the form). Either way the action must
 * receive the whole picture — pipeline, person, forecast, next step — and the
 * value field must follow whichever pipeline is actually chosen.
 */

const CONTACT: ContactSummary = {
  id: 'cccccccc-1111-4111-8111-111111111111',
  full_name: 'Ruth Alvarez',
  preferred_name: null,
  first_name: 'Ruth',
  last_name: 'Alvarez',
  organization_name: null,
  email: 'ruth@example.org',
}

const TEAM: TeamProfile[] = [
  { id: 'pppppppp-1111-4111-8111-111111111111', full_name: 'Dana Okoro', email: 'dana@example.org' },
]

const PIPELINES: PipelineChoice[] = [
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Major gift', tracks_value: true, has_stages: true },
  { id: 'aaaaaaaa-2222-4222-8222-222222222222', name: 'Partnerships', tracks_value: false, has_stages: true },
  { id: 'aaaaaaaa-3333-4333-8333-333333333333', name: 'Grants', tracks_value: true, has_stages: false },
]

/** Records what the server action would have received. */
function recordingAction(result: PipelineActionState = { notice: 'Created “Ruth Alvarez”.' }) {
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

function submitFormOf(button: HTMLElement): FormData {
  const form = button.closest('form')
  if (!form) throw new Error('Expected the submit button to belong to a form')
  return new FormData(form)
}

describe('PipelineAddForm with a pipeline picker', () => {
  it('offers every pipeline but disables the ones that cannot hold an opportunity yet', () => {
    const { action } = recordingAction()
    render(
      <PipelineAddForm
        action={action}
        pipelines={PIPELINES}
        contact={CONTACT}
        team={TEAM}
        defaultOwnerId={TEAM[0]!.id}
      />,
    )

    const picker = screen.getByLabelText(/^pipeline\*?$/i)
    // The first pipeline that actually has stages is preselected.
    expect(picker).toHaveValue(PIPELINES[0]!.id)

    expect(screen.getByRole('option', { name: 'Major gift' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Partnerships' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Grants (no stages yet)' })).toBeDisabled()
  })

  it('shows the value field only while the chosen pipeline tracks value', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction()
    render(
      <PipelineAddForm
        action={action}
        pipelines={PIPELINES}
        contact={CONTACT}
        team={TEAM}
        defaultOwnerId={TEAM[0]!.id}
      />,
    )

    // Major gift (tracks value) is preselected.
    expect(screen.getByLabelText('Expected value')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/^pipeline\*?$/i), PIPELINES[1]!.id)
    expect(screen.queryByLabelText('Expected value')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/^pipeline\*?$/i), PIPELINES[0]!.id)
    expect(screen.getByLabelText('Expected value')).toBeInTheDocument()
  })

  it('posts the chosen pipeline, the person, the organization and the next step', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(
      <PipelineAddForm
        action={action}
        pipelines={PIPELINES}
        contact={CONTACT}
        team={TEAM}
        defaultOwnerId={TEAM[0]!.id}
      />,
    )

    await user.selectOptions(screen.getByLabelText(/^pipeline\*?$/i), PIPELINES[1]!.id)
    await user.type(screen.getByLabelText('Organization'), 'Diocese of Springfield')
    await user.type(screen.getByLabelText('Next step'), 'Call to schedule lunch')
    await user.click(screen.getByRole('button', { name: 'Create opportunity' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      pipeline_id: PIPELINES[1]!.id,
      contact_id: CONTACT.id,
      title: 'Ruth Alvarez',
      organization_name: 'Diocese of Springfield',
      next_step: 'Call to schedule lunch',
      owner_id: TEAM[0]!.id,
    })
  })
})

describe('PipelineAddForm return destination', () => {
  it('carries return_to=contact only when asked to land back on the person', () => {
    const { action } = recordingAction()
    const { unmount } = render(
      <PipelineAddForm
        action={action}
        pipelineId={PIPELINES[0]!.id}
        pipelineName="Major gift"
        tracksValue
        contact={CONTACT}
        team={TEAM}
        defaultOwnerId={TEAM[0]!.id}
        returnToContact
      />,
    )

    let submitted = submitFormOf(screen.getByRole('button', { name: 'Create opportunity' }))
    expect(submitted.get('return_to')).toBe('contact')
    // The fixed pipeline rides along as a hidden field.
    expect(submitted.get('pipeline_id')).toBe(PIPELINES[0]!.id)

    unmount()
    render(
      <PipelineAddForm
        action={action}
        pipelineId={PIPELINES[0]!.id}
        pipelineName="Major gift"
        tracksValue
        contact={CONTACT}
        team={TEAM}
        defaultOwnerId={TEAM[0]!.id}
      />,
    )

    submitted = submitFormOf(screen.getByRole('button', { name: 'Create opportunity' }))
    expect(submitted.get('return_to')).toBeNull()
    expect(document.querySelector('input[name="return_to"]')).not.toBeInTheDocument()
  })
})
