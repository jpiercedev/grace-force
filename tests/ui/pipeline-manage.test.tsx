import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CreatePipelineForm,
  PipelineSettingsForm,
  StageEditor,
} from '@/components/domain/pipeline-manage'
import type { ManageActionState } from '@/app/(app)/sales/manage/actions'
import type { ManagedStage, PipelineForManage } from '@/lib/queries/pipelines'

/**
 * Pipeline management is structural surgery on the sales workflow, so every
 * mutation must arrive with its intent stated by the form — never inferred
 * from which button happened to be pressed — and the destructive paths must
 * demand more than one click.
 */

const PIPELINE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

const STAGE_IDS = [
  'ssssssss-1111-4111-8111-111111111111',
  'ssssssss-2222-4222-8222-222222222222',
  'ssssssss-3333-4333-8333-333333333333',
] as const

function makeStage(overrides: Partial<ManagedStage> = {}): ManagedStage {
  return {
    id: STAGE_IDS[0],
    pipeline_id: PIPELINE_ID,
    slug: 'identified',
    name: 'Identified',
    description: null,
    position: 10,
    is_won: false,
    is_lost: false,
    color: 'slate',
    archived_at: null,
    open_count: 0,
    card_count: 0,
    ...overrides,
  }
}

const LIVE_STAGES: ManagedStage[] = [
  makeStage(),
  makeStage({ id: STAGE_IDS[1], slug: 'cultivation', name: 'Cultivation', position: 20 }),
  makeStage({ id: STAGE_IDS[2], slug: 'ask', name: 'Ask', position: 30, is_won: true }),
]

function makePipeline(overrides: Partial<PipelineForManage> = {}): PipelineForManage {
  return {
    id: PIPELINE_ID,
    slug: 'major-gift',
    name: 'Major gift',
    description: 'Cultivation through to the ask.',
    tracks_value: true,
    is_default: false,
    is_active: true,
    stages: LIVE_STAGES,
    archived_stages: [],
    card_count: 0,
    ...overrides,
  }
}

/** Records what the server action would have received. */
function recordingAction(result: ManageActionState = { notice: 'Saved.' }) {
  const calls: Record<string, string>[] = []
  const action = vi.fn(async (_prev: ManageActionState, formData: FormData) => {
    const entries: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entries[key] = value
    }
    calls.push(entries)
    return result
  })
  return { action, calls }
}

function expectDedicatedActionForm(
  button: HTMLElement,
  expected: { id: string; intent: string },
) {
  expect(button).not.toHaveAttribute('name')
  expect(button).not.toHaveAttribute('value')

  const form = button.closest('form')
  if (!form) throw new Error('Expected the action button to belong to a form')

  const id = form.querySelector<HTMLInputElement>('input[type="hidden"][name="id"]')
  const intent = form.querySelector<HTMLInputElement>('input[type="hidden"][name="intent"]')
  expect(id).toHaveValue(expected.id)
  expect(intent).toHaveValue(expected.intent)

  const submitted = new FormData(form)
  expect(submitted.get('id')).toBe(expected.id)
  expect(submitted.get('intent')).toBe(expected.intent)
}

describe('CreatePipelineForm', () => {
  it('posts the name, description and value tracking the person entered', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(<CreatePipelineForm action={action} />)

    await user.type(screen.getByLabelText(/^name\*?$/i), 'Partnerships')
    await user.type(screen.getByLabelText('Description'), 'Corporate relationships.')
    await user.click(screen.getByRole('checkbox', { name: /track dollar values/i }))
    await user.click(screen.getByRole('button', { name: 'Create pipeline' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      name: 'Partnerships',
      description: 'Corporate relationships.',
      tracks_value: 'on',
    })
  })

  it('reports a refusal as an alert', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction({ error: 'A pipeline named “Partnerships” already exists.' })
    render(<CreatePipelineForm action={action} />)

    await user.type(screen.getByLabelText(/^name\*?$/i), 'Partnerships')
    await user.click(screen.getByRole('button', { name: 'Create pipeline' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})

describe('PipelineSettingsForm', () => {
  it('prefills the pipeline and updates through a form that states its intent', () => {
    const { action } = recordingAction()
    render(<PipelineSettingsForm pipeline={makePipeline()} action={action} />)

    expect(screen.getByLabelText(/^name\*?$/i)).toHaveValue('Major gift')
    expect(screen.getByLabelText('Description')).toHaveValue('Cultivation through to the ask.')
    expect(screen.getByRole('checkbox', { name: /track dollar values/i })).toBeChecked()

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Save changes' }), {
      id: PIPELINE_ID,
      intent: 'update',
    })
  })

  it('archives from a dedicated form, and offers restore once archived', () => {
    const { action } = recordingAction()
    const { unmount } = render(<PipelineSettingsForm pipeline={makePipeline()} action={action} />)

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Archive pipeline' }), {
      id: PIPELINE_ID,
      intent: 'archive',
    })
    expect(screen.queryByRole('button', { name: 'Restore pipeline' })).not.toBeInTheDocument()

    unmount()
    render(<PipelineSettingsForm pipeline={makePipeline({ is_active: false })} action={action} />)

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Restore pipeline' }), {
      id: PIPELINE_ID,
      intent: 'restore',
    })
    expect(screen.queryByRole('button', { name: 'Archive pipeline' })).not.toBeInTheDocument()
  })

  it('keeps delete disabled until the person acknowledges what it destroys', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction()
    render(<PipelineSettingsForm pipeline={makePipeline({ card_count: 0 })} action={action} />)

    const deleteButton = screen.getByRole('button', { name: 'Delete pipeline' })
    expect(deleteButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /will be permanently deleted/i }))
    expect(deleteButton).toBeEnabled()
    expectDedicatedActionForm(deleteButton, { id: PIPELINE_ID, intent: 'delete' })
  })

  it('offers no delete at all once the pipeline holds opportunities, pointing at archive instead', () => {
    const { action } = recordingAction()
    render(<PipelineSettingsForm pipeline={makePipeline({ card_count: 3 })} action={action} />)

    expect(screen.queryByRole('button', { name: 'Delete pipeline' })).not.toBeInTheDocument()
    expect(
      screen.getByText(/holds 3 opportunities .*cannot be deleted — archive it instead/),
    ).toBeInTheDocument()
  })
})

function renderStageEditor(pipeline = makePipeline()) {
  const add = recordingAction({ notice: 'Added “Qualified”.' })
  const update = recordingAction()
  render(<StageEditor pipeline={pipeline} addAction={add.action} updateAction={update.action} />)
  return { addCalls: add.calls, updateCalls: update.calls }
}

describe('StageEditor', () => {
  it('renders the live stages in order, each rename prefilled in its own intent-bearing form', () => {
    renderStageEditor()

    const renameInputs = screen.getAllByLabelText(/^rename stage /i)
    expect(renameInputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Identified',
      'Cultivation',
      'Ask',
    ])

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Rename: Cultivation' }), {
      id: STAGE_IDS[1],
      intent: 'rename',
    })
  })

  it('submits a rename with the edited name', async () => {
    const user = userEvent.setup()
    const { updateCalls } = renderStageEditor()

    const input = screen.getByLabelText('Rename stage Cultivation')
    await user.clear(input)
    await user.type(input, 'Discovery')
    await user.click(screen.getByRole('button', { name: 'Rename: Cultivation' }))

    await waitFor(() => expect(updateCalls).toHaveLength(1))
    expect(updateCalls[0]).toMatchObject({
      id: STAGE_IDS[1],
      intent: 'rename',
      name: 'Discovery',
    })
  })

  it('disables moving the first stage earlier and the last later, each move in its own form', () => {
    renderStageEditor()

    expect(screen.getByRole('button', { name: 'Move Identified earlier' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Ask later' })).toBeDisabled()

    const up = screen.getByRole('button', { name: 'Move Cultivation earlier' })
    const down = screen.getByRole('button', { name: 'Move Cultivation later' })
    expect(up).toBeEnabled()
    expect(down).toBeEnabled()
    expectDedicatedActionForm(up, { id: STAGE_IDS[1], intent: 'move_up' })
    expectDedicatedActionForm(down, { id: STAGE_IDS[1], intent: 'move_down' })
  })

  it('archives a stage through a dedicated form naming the stage', () => {
    renderStageEditor()

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Archive: Cultivation' }), {
      id: STAGE_IDS[1],
      intent: 'archive',
    })
  })

  it('lists archived stages with restore always, and delete only when nothing ever lived there', () => {
    const parkedId = 'ssssssss-4444-4444-8444-444444444444'
    const oldAskId = 'ssssssss-5555-4555-8555-555555555555'
    renderStageEditor(
      makePipeline({
        archived_stages: [
          makeStage({
            id: parkedId,
            slug: 'parked',
            name: 'Parked',
            archived_at: '2026-08-01T12:00:00.000Z',
            card_count: 0,
          }),
          makeStage({
            id: oldAskId,
            slug: 'old-ask',
            name: 'Old ask',
            archived_at: '2026-08-01T12:00:00.000Z',
            card_count: 2,
          }),
        ],
      }),
    )

    expect(screen.getByText('Archived stages')).toBeInTheDocument()

    expectDedicatedActionForm(screen.getByRole('button', { name: 'Restore: Parked' }), {
      id: parkedId,
      intent: 'restore',
    })
    expectDedicatedActionForm(screen.getByRole('button', { name: 'Delete: Parked' }), {
      id: parkedId,
      intent: 'delete',
    })

    // A stage with history restores but never deletes.
    expect(screen.getByRole('button', { name: 'Restore: Old ask' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete: Old ask' })).not.toBeInTheDocument()
  })

  it('adds a stage, carrying the pipeline in a hidden field alongside name and kind', async () => {
    const user = userEvent.setup()
    const { addCalls, updateCalls } = renderStageEditor()

    await user.type(screen.getByLabelText(/^name\*?$/i), 'Qualified')
    await user.selectOptions(screen.getByLabelText('Kind'), 'won')
    await user.click(screen.getByRole('button', { name: 'Add stage' }))

    await waitFor(() => expect(addCalls).toHaveLength(1))
    expect(addCalls[0]).toMatchObject({
      pipeline_id: PIPELINE_ID,
      name: 'Qualified',
      outcome: 'won',
    })
    // The add form is its own action — a row action must not have fired.
    expect(updateCalls).toHaveLength(0)
  })
})
