import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FollowUpQueue } from '@/components/domain/follow-up-queue'
import type { FollowUpActionState } from '@/app/(app)/follow-ups/actions'
import type { FollowUpQueueItem, TeamProfile } from '@/lib/queries/follow-ups'

/**
 * The queue is where commitments are resolved, so every action on it has to be
 * reachable from the keyboard and has to say what happened — the row usually
 * leaves the segment it was in, taking the visual confirmation with it.
 */

const NOW = '2026-08-05T12:00:00.000Z'

const TEAM: TeamProfile[] = [
  { id: 'pppppppp-1111-4111-8111-111111111111', full_name: 'Dana Okoro', email: 'dana@example.org' },
  { id: 'pppppppp-2222-4222-8222-222222222222', full_name: null, email: 'sam@example.org' },
]

function makeItem(overrides: Partial<FollowUpQueueItem> = {}): FollowUpQueueItem {
  return {
    id: 'ffffffff-1111-4111-8111-111111111111',
    contact_id: 'cccccccc-1111-4111-8111-111111111111',
    title: 'Send the partnership pack',
    details: null,
    due_at: '2026-08-01T09:00:00.000Z',
    remind_at: '2026-08-01T09:00:00.000Z',
    priority: 'high',
    status: 'open',
    assigned_to: TEAM[0]!.id,
    completed_at: null,
    outcome_note: null,
    contact: {
      id: 'cccccccc-1111-4111-8111-111111111111',
      full_name: 'Ruth Alvarez',
      preferred_name: null,
      first_name: 'Ruth',
      last_name: 'Alvarez',
      organization_name: null,
      email: 'ruth@example.org',
    },
    assignee: TEAM[0]!,
    ...overrides,
  }
}

function recordingAction(result: FollowUpActionState = { notice: 'Completed “Send the partnership pack”.' }) {
  const calls: Record<string, string>[] = []
  const action = vi.fn(async (_prev: FollowUpActionState, formData: FormData) => {
    const entries: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entries[key] = value
    }
    calls.push(entries)
    return result
  })
  return { action, calls }
}

function renderQueue(items: FollowUpQueueItem[], canEdit = true, result?: FollowUpActionState) {
  const { action, calls } = result ? recordingAction(result) : recordingAction()
  render(
    <FollowUpQueue items={items} team={TEAM} canEdit={canEdit} nowIso={NOW} action={action} />,
  )
  return { calls }
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

describe('FollowUpQueue', () => {
  it('signals overdue in text, not only in colour', () => {
    renderQueue([makeItem()])

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText(/was due/i)).toBeInTheDocument()
  })

  it('does not call anything overdue that is still in hand', () => {
    renderQueue([makeItem({ due_at: '2026-08-09T09:00:00.000Z' })])

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
    expect(screen.getByText(/^due /i)).toBeInTheDocument()
  })

  it('completes a follow-up with an outcome note, closing the panel on Escape first', async () => {
    const user = userEvent.setup()
    const { calls } = renderQueue([makeItem()])

    await user.click(screen.getByRole('button', { name: /^complete/i }))
    // Focus follows the disclosure so the keyboard user is not left behind it.
    await waitFor(() => expect(screen.getByLabelText('Outcome note')).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Outcome note')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^complete/i }))
    await user.type(screen.getByLabelText('Outcome note'), 'Posted it today')
    const submit = screen.getByRole('button', { name: /mark complete/i })
    expectDedicatedActionForm(submit, {
      id: 'ffffffff-1111-4111-8111-111111111111',
      intent: 'complete',
    })
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      intent: 'complete',
      id: 'ffffffff-1111-4111-8111-111111111111',
      outcome_note: 'Posted it today',
    })
  })

  it('snoozes from the row without opening anything', async () => {
    const user = userEvent.setup()
    const { calls } = renderQueue([makeItem()])

    const submit = screen.getByRole('button', { name: /snooze \+1 week/i })
    expectDedicatedActionForm(submit, {
      id: 'ffffffff-1111-4111-8111-111111111111',
      intent: 'snooze_week',
    })
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'snooze_week' })
  })

  it('reassigns to another team member', async () => {
    const user = userEvent.setup()
    const { calls } = renderQueue([makeItem()])

    await user.click(screen.getByRole('button', { name: /^reassign/i }))
    await user.selectOptions(screen.getByLabelText('Assign to'), TEAM[1]!.id)
    const submit = screen.getByRole('button', { name: /save assignee/i })
    expectDedicatedActionForm(submit, {
      id: 'ffffffff-1111-4111-8111-111111111111',
      intent: 'reassign',
    })
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'reassign', assigned_to: TEAM[1]!.id })
  })

  it('asks before cancelling, then sends the cancellation', async () => {
    const user = userEvent.setup()
    const { calls } = renderQueue([makeItem()])

    await user.click(screen.getByRole('button', { name: /^cancel/i }))
    expect(screen.getByText(/cancel this follow-up\?/i)).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: /yes, cancel it/i })
    expectDedicatedActionForm(submit, {
      id: 'ffffffff-1111-4111-8111-111111111111',
      intent: 'cancel',
    })
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ intent: 'cancel' })
  })

  it('announces the outcome and takes focus, because the row it applied to has left the segment', async () => {
    const user = userEvent.setup()
    renderQueue([makeItem()])

    await user.click(screen.getByRole('button', { name: /snooze \+1 day/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Completed “Send the partnership pack”.')
    await waitFor(() => expect(status.parentElement).toHaveFocus())
  })

  it('reports a refusal as an alert and leaves the row alone', async () => {
    const user = userEvent.setup()
    renderQueue([makeItem()], true, {
      error: 'That follow-up could not be updated — it may belong to another team member.',
    })

    await user.click(screen.getByRole('button', { name: /snooze \+1 day/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('another team member')
    expect(screen.getByText('Send the partnership pack')).toBeInTheDocument()
  })

  it('names the follow-up in every control, so a queue of rows is distinguishable', () => {
    renderQueue([
      makeItem(),
      makeItem({ id: 'ffffffff-2222-4222-8222-222222222222', title: 'Book the school visit' }),
    ])

    expect(
      screen.getByRole('button', { name: /complete: send the partnership pack/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /complete: book the school visit/i }),
    ).toBeInTheDocument()
  })

  it('offers no actions on a completed follow-up, but shows how it went', () => {
    renderQueue([
      makeItem({
        status: 'completed',
        completed_at: '2026-08-04T15:30:00.000Z',
        outcome_note: 'She is in for the autumn appeal',
      }),
    ])

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/she is in for the autumn appeal/i)).toBeInTheDocument()
  })

  it('offers no actions to someone without write access', () => {
    renderQueue([makeItem()], false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ruth Alvarez' })).toHaveAttribute(
      'href',
      '/contacts/cccccccc-1111-4111-8111-111111111111',
    )
  })
})
