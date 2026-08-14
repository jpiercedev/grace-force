import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LeadRow } from '@/app/(app)/leads/lead-row'
import type { LeadQueueItem } from '@/lib/leads/queries'
import type { TeamProfile } from '@/lib/queries/follow-ups'

const NOW = '2026-08-05T12:00:00.000Z'
const LEAD_ID = 'eeeeeeee-1111-4111-8111-111111111111'

const TEAM: TeamProfile[] = [
  { id: 'pppppppp-1111-4111-8111-111111111111', full_name: 'Dana Okoro', email: 'dana@example.org' },
  { id: 'pppppppp-2222-4222-8222-222222222222', full_name: null, email: 'sam@example.org' },
]

function makeLead(overrides: Partial<LeadQueueItem> = {}): LeadQueueItem {
  return {
    id: LEAD_ID,
    first_name: 'Ruth',
    last_name: 'Alvarez',
    email: 'ruth@example.org',
    phone: null,
    organization_name: null,
    message: 'I would like to learn more.',
    interest: null,
    form_key: 'contact',
    page_url: null,
    utm: null,
    status: 'new',
    assigned_to: null,
    contact_id: null,
    converted_at: null,
    created_at: '2026-08-04T12:00:00.000Z',
    assignee: null,
    contact: null,
    ...overrides,
  }
}

function renderRow(lead = makeLead()) {
  const calls: Record<string, string>[] = []
  const action = vi.fn((formData: FormData) => {
    const entries: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entries[key] = value
    }
    calls.push(entries)
  })

  render(
    <LeadRow
      lead={lead}
      team={TEAM}
      statusFilter={lead.status}
      nowIso={NOW}
      formAction={action}
      resetSignal={0}
      canTriage
    />,
  )

  return { calls }
}

function expectDedicatedActionForm(button: HTMLElement, intent: string) {
  expect(button).not.toHaveAttribute('name')
  expect(button).not.toHaveAttribute('value')

  const form = button.closest('form')
  if (!form) throw new Error('Expected the action button to belong to a form')

  const id = form.querySelector<HTMLInputElement>('input[type="hidden"][name="id"]')
  const intentInput = form.querySelector<HTMLInputElement>(
    'input[type="hidden"][name="intent"]',
  )
  expect(id).toHaveValue(LEAD_ID)
  expect(intentInput).toHaveValue(intent)

  const submitted = new FormData(form)
  expect(submitted.get('id')).toBe(LEAD_ID)
  expect(submitted.get('intent')).toBe(intent)
}

describe('LeadRow', () => {
  it('puts every one-click action in a dedicated form instead of dispatching from the button', async () => {
    const user = userEvent.setup()
    const { calls } = renderRow()

    const actions = [
      [screen.getByRole('button', { name: /^assign to me/i }), 'assign_to_me'],
      [screen.getByRole('button', { name: /^in review/i }), 'mark_in_review'],
      [screen.getByRole('button', { name: /^spam/i }), 'mark_spam'],
      [screen.getByRole('button', { name: /^archive/i }), 'archive'],
    ] as const

    for (const [button, intent] of actions) expectDedicatedActionForm(button, intent)

    await user.click(actions[0][0])
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ id: LEAD_ID, intent: 'assign_to_me' })
  })

  it('submits assignment fields from the dedicated assign form', async () => {
    const user = userEvent.setup()
    const { calls } = renderRow()

    await user.click(screen.getByRole('button', { name: /^assign to…/i }))
    await user.selectOptions(screen.getByLabelText('Assign to'), TEAM[1]!.id)

    const submit = screen.getByRole('button', { name: /^save assignee/i })
    expectDedicatedActionForm(submit, 'assign')
    await user.click(submit)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      id: LEAD_ID,
      intent: 'assign',
      assigned_to: TEAM[1]!.id,
    })
  })

  it('keeps convert and reopen intent inside their respective forms', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <LeadRow
        lead={makeLead()}
        team={TEAM}
        statusFilter="new"
        nowIso={NOW}
        formAction={() => undefined}
        resetSignal={0}
        canTriage
      />,
    )

    await user.click(screen.getByRole('button', { name: /^convert/i }))
    expectDedicatedActionForm(
      screen.getByRole('button', { name: /^convert to contact/i }),
      'convert',
    )

    unmount()
    render(
      <LeadRow
        lead={makeLead({ status: 'spam' })}
        team={TEAM}
        statusFilter="spam"
        nowIso={NOW}
        formAction={() => undefined}
        resetSignal={0}
        canTriage
      />,
    )
    expectDedicatedActionForm(screen.getByRole('button', { name: /^reopen/i }), 'reopen')
  })

  it('renders no triage controls for a read-only viewer', () => {
    render(
      <LeadRow
        lead={makeLead()}
        team={TEAM}
        statusFilter="new"
        nowIso={NOW}
        formAction={() => undefined}
        resetSignal={0}
        canTriage={false}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
