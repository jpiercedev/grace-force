import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PipelineEditor } from '@/components/domain/pipeline-editor'
import type { PipelineEditorState } from '@/app/(app)/sales/pipelines/actions'
import type { ManagedPipeline, ManagedStage } from '@/lib/queries/pipelines'

/**
 * The pipeline editor is a screen of many small forms sharing one action
 * state. What matters is that each control posts exactly its hidden id +
 * intent pair, that destructive paths are gated (disabled mirrors of the DB
 * guards, a confirm step before delete), and that a viewer gets no controls
 * at all.
 */

const PIPELINE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

function makeStage(overrides: Partial<ManagedStage> = {}): ManagedStage {
  return {
    id: 'ssssssss-1111-4111-8111-111111111111',
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
    total_count: 0,
    ...overrides,
  }
}

function makePipeline(overrides: Partial<ManagedPipeline> = {}): ManagedPipeline {
  return {
    id: PIPELINE_ID,
    slug: 'major-gift',
    name: 'Major gift',
    description: 'Cultivation through to the ask.',
    tracks_value: true,
    is_default: false,
    is_active: true,
    sort_order: 10,
    stages: [
      makeStage(),
      makeStage({
        id: 'ssssssss-2222-4222-8222-222222222222',
        slug: 'cultivation',
        name: 'Cultivation',
        color: 'sky',
        position: 20,
        open_count: 2,
        total_count: 3,
      }),
    ],
    open_count: 2,
    total_count: 3,
    ...overrides,
  }
}

/** Records what the server action would have received. */
function recordingAction(result: PipelineEditorState = { notice: 'Pipeline saved.' }) {
  const calls: Record<string, string>[] = []
  const action = vi.fn(async (_prev: PipelineEditorState, formData: FormData) => {
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

  const submitted = new FormData(form)
  expect(submitted.get('id')).toBe(expected.id)
  expect(submitted.get('intent')).toBe(expected.intent)
}

describe('PipelineEditor', () => {
  it('posts the details form as a rename carrying id and name', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(<PipelineEditor pipeline={makePipeline()} canEdit action={action} />)

    const save = screen.getByRole('button', { name: /^save$/i })
    const form = save.closest('form')
    if (!form) throw new Error('Expected the details form')
    const data = new FormData(form)
    expect(data.get('intent')).toBe('rename')
    expect(data.get('id')).toBe(PIPELINE_ID)
    expect(data.get('name')).toBe('Major gift')

    await user.click(save)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'rename', id: PIPELINE_ID, name: 'Major gift' })
  })

  it('posts a new stage with the pipeline, name, color and outcome', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction({ notice: 'Added the “Proposal sent” stage.' })
    render(<PipelineEditor pipeline={makePipeline()} canEdit action={action} />)

    const submit = screen.getByRole('button', { name: /add stage/i })
    const form = submit.closest('form')
    if (!form) throw new Error('Expected the add-stage form')

    await user.type(within(form).getByLabelText(/name/i), 'Proposal sent')
    await user.selectOptions(within(form).getByLabelText(/color/i), 'amber')
    await user.selectOptions(within(form).getByLabelText(/outcome/i), 'won')
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      intent: 'add_stage',
      pipeline_id: PIPELINE_ID,
      name: 'Proposal sent',
      color: 'amber',
      outcome: 'won',
    })
  })

  it('gives each reorder direction a dedicated form named after the stage', () => {
    const { action } = recordingAction()
    render(<PipelineEditor pipeline={makePipeline()} canEdit action={action} />)

    const earlier = screen.getByRole('button', { name: /move the .*identified.* stage earlier/i })
    const later = screen.getByRole('button', { name: /move the .*identified.* stage later/i })
    expectDedicatedActionForm(earlier, {
      id: 'ssssssss-1111-4111-8111-111111111111',
      intent: 'stage_up',
    })
    expectDedicatedActionForm(later, {
      id: 'ssssssss-1111-4111-8111-111111111111',
      intent: 'stage_down',
    })
  })

  it('only offers stage archiving once nothing in the stage is open', () => {
    const { action } = recordingAction()
    render(<PipelineEditor pipeline={makePipeline()} canEdit action={action} />)

    const empty = screen.getByRole('button', { name: /archive the .*identified.* stage/i })
    expect(empty).toBeEnabled()
    expectDedicatedActionForm(empty, {
      id: 'ssssssss-1111-4111-8111-111111111111',
      intent: 'archive_stage',
    })

    // Two open opportunities: the button stays visible but explains itself.
    expect(
      screen.getByRole('button', { name: /archive the .*cultivation.* stage/i }),
    ).toBeDisabled()
  })

  it('refuses to delete a pipeline that still holds opportunities', () => {
    const { action } = recordingAction()
    render(<PipelineEditor pipeline={makePipeline({ total_count: 3 })} canEdit action={action} />)

    expect(screen.getByRole('button', { name: /delete pipeline/i })).toBeDisabled()
    expect(screen.getByText(/move or archive its 3 opportunities first/i)).toBeInTheDocument()
  })

  it('gates an allowed pipeline delete behind an explicit confirmation', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    const empty = makePipeline({
      total_count: 0,
      open_count: 0,
      stages: [makeStage()],
    })
    render(<PipelineEditor pipeline={empty} canEdit action={action} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete pipeline/i }))

    const dialog = await screen.findByRole('dialog', { name: /delete this empty pipeline/i })
    const confirm = within(dialog).getByRole('button', { name: /delete it/i })
    expectDedicatedActionForm(confirm, { id: PIPELINE_ID, intent: 'delete' })

    await user.click(confirm)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'delete', id: PIPELINE_ID })
  })

  it('renders no buttons at all for a viewer', () => {
    const { action } = recordingAction()
    const archived = makeStage({
      id: 'ssssssss-3333-4333-8333-333333333333',
      slug: 'parked',
      name: 'Parked',
      archived_at: '2026-08-01T12:00:00.000Z',
    })
    const pipeline = makePipeline({ stages: [makeStage(), archived] })
    render(<PipelineEditor pipeline={pipeline} canEdit={false} action={action} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Identified')).toBeInTheDocument()
    expect(screen.getByText('Parked')).toBeInTheDocument()
  })

  it('announces a notice politely and an error as an interruption', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction({ notice: 'Pipeline saved.' })
    const first = render(<PipelineEditor pipeline={makePipeline()} canEdit action={action} />)

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Pipeline saved.')
    first.unmount()

    const failing = vi.fn(async () => ({ error: 'That pipeline could not be saved.' }))
    render(<PipelineEditor pipeline={makePipeline()} canEdit action={failing} />)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
  })
})
