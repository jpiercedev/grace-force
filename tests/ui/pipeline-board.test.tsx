import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PipelineBoard } from '@/components/domain/pipeline-board'
import type { PipelineActionState } from '@/app/(app)/pipelines/actions'
import type { BoardCard, PipelineBoard as PipelineBoardData } from '@/lib/queries/pipelines'

/**
 * The board must be usable without a mouse: dragging is an enhancement, the
 * select-and-submit path is the interface. These tests drive it entirely from
 * the keyboard, and assert the outcome is reported rather than left to be
 * inferred from the board rearranging.
 */

function makeCard(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    pipeline_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    stage_id: 'ssssssss-1111-4111-8111-111111111111',
    contact_id: 'cccccccc-1111-4111-8111-111111111111',
    title: 'Spring appeal ask',
    details: null,
    value_cents: 250_000,
    currency: 'USD',
    status: 'open',
    owner_id: null,
    expected_close_on: '2026-09-30',
    position: 0,
    created_at: '2026-08-01T12:00:00.000Z',
    contact: {
      id: 'cccccccc-1111-4111-8111-111111111111',
      full_name: 'Ruth Alvarez',
      preferred_name: null,
      first_name: 'Ruth',
      last_name: 'Alvarez',
      organization_name: null,
      email: 'ruth@example.org',
    },
    owner: { id: 'pppppppp-1111-4111-8111-111111111111', full_name: 'Dana Okoro', email: 'dana@example.org' },
    ...overrides,
  }
}

function makeBoard(cards: BoardCard[] = [makeCard()]): PipelineBoardData {
  return {
    pipeline: {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      slug: 'major-gift',
      name: 'Major gift',
      description: 'Cultivation through to the ask.',
      tracks_value: true,
      is_active: true,
    },
    stages: [
      {
        id: 'ssssssss-1111-4111-8111-111111111111',
        pipeline_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        slug: 'identified',
        name: 'Identified',
        description: null,
        position: 1,
        is_won: false,
        is_lost: false,
        color: 'slate',
        cards,
      },
      {
        id: 'ssssssss-2222-4222-8222-222222222222',
        pipeline_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        slug: 'cultivation',
        name: 'Cultivation',
        description: null,
        position: 2,
        is_won: false,
        is_lost: false,
        color: 'sky',
        cards: [],
      },
    ],
    open_count: cards.length,
    open_value_cents: 250_000,
    won_count: 0,
    lost_count: 0,
  }
}

/** Records what the server action would have received. */
function recordingAction() {
  const calls: Record<string, string>[] = []
  const action = vi.fn(async (_prev: PipelineActionState, formData: FormData) => {
    const entries: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entries[key] = value
    }
    calls.push(entries)
    return { notice: 'Moved “Spring appeal ask” to Cultivation.' }
  })
  return { action, calls }
}

describe('PipelineBoard', () => {
  it('moves a card to another stage using only the keyboard', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(<PipelineBoard board={makeBoard()} canEdit action={action} />)

    const stageSelect = screen.getByLabelText(/move .*spring appeal ask.* to a different stage/i)
    await user.selectOptions(stageSelect, 'ssssssss-2222-4222-8222-222222222222')

    // Tab from the select lands on the Move button; Enter submits the form.
    await user.tab()
    expect(screen.getByRole('button', { name: /^move/i })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      intent: 'move',
      id: '11111111-1111-4111-8111-111111111111',
      stage_id: 'ssssssss-2222-4222-8222-222222222222',
    })
  })

  it('announces the result and takes focus, because the card it applied to has moved away', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction()
    render(<PipelineBoard board={makeBoard()} canEdit action={action} />)

    await user.click(screen.getByRole('button', { name: /^move/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Moved “Spring appeal ask” to Cultivation.')
    await waitFor(() => expect(status.parentElement).toHaveFocus())
  })

  it('reports a refusal as an alert', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ error: 'That card is no longer open, so it could not be changed.' }))
    render(<PipelineBoard board={makeBoard()} canEdit action={action} />)

    await user.click(screen.getByRole('button', { name: /^move/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer open')
  })

  it('closes a card as won or lost, and Escape abandons the panel', async () => {
    const user = userEvent.setup()
    const { action, calls } = recordingAction()
    render(<PipelineBoard board={makeBoard()} canEdit action={action} />)

    await user.click(screen.getByRole('button', { name: /close card/i }))
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /close card/i }))
    await user.type(screen.getByLabelText('Reason'), 'Gift received')
    await user.click(screen.getByRole('button', { name: /mark won/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'close_won', close_reason: 'Gift received' })
  })

  it('names the card in every control, so a column of buttons is distinguishable', () => {
    const { action } = recordingAction()
    const second = makeCard({ id: '22222222-2222-4222-8222-222222222222', title: 'Legacy conversation' })
    render(<PipelineBoard board={makeBoard([makeCard(), second])} canEdit action={action} />)

    expect(screen.getByRole('button', { name: /move: spring appeal ask/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move: legacy conversation/i })).toBeInTheDocument()
  })

  it('offers no controls to someone without write access', () => {
    const { action } = recordingAction()
    render(<PipelineBoard board={makeBoard()} canEdit={false} action={action} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Spring appeal ask')).toBeInTheDocument()
  })

  it('labels each column with its stage and open count', () => {
    const { action } = recordingAction()
    render(<PipelineBoard board={makeBoard()} canEdit action={action} />)

    const identified = screen.getByRole('region', { name: 'Identified' })
    expect(within(identified).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cultivation' })).toHaveTextContent(
      'Nothing in this stage.',
    )
  })
})
