import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogInteractionDialog } from '@/components/domain/log-interaction'
import { Disclosure } from '@/components/ui/disclosure'
import type { ContactActionState } from '@/lib/validation/contact'

/**
 * The brief's target workflow, verified end to end:
 *
 *   Open donor → Log interaction → select type → enter note → optionally set a
 *   follow-up → Save.
 *
 * The things that would quietly break it are the things asserted here: that
 * the plain-language choice reaches the server as a plain-language choice
 * (never a raw enum the person never saw), that the note posts, that the
 * follow-up fields only exist once asked for, and that a modal opened by
 * keyboard can be closed by keyboard.
 */

function recordingAction(result: ContactActionState = { ok: true }) {
  const submissions: Record<string, string>[] = []
  const action = vi.fn(async (_prev: ContactActionState, formData: FormData) => {
    const entry: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') entry[key] = value
    }
    submissions.push(entry)
    return result
  })
  return { action, submissions }
}

function renderDialog(overrides: Partial<Parameters<typeof LogInteractionDialog>[0]> = {}) {
  const { action, submissions } = recordingAction()
  render(
    <LogInteractionDialog
      contactId="cccccccc-1111-4111-8111-111111111111"
      contactName="Ruth Alvarez"
      proposals={[]}
      action={action}
      {...overrides}
    />,
  )
  return { action, submissions }
}

describe('logging an interaction', () => {
  it('is one button on the record until someone asks for it', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Log interaction' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a labelled dialog naming the person', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    const dialog = screen.getByRole('dialog', { name: 'Log an interaction' })
    expect(within(dialog).getByText(/Ruth Alvarez/)).toBeInTheDocument()
  })

  it('asks what happened in plain language, not in CRM vocabulary', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Log interaction' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: 'They called us' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'We called them' })).toBeInTheDocument()

    // The words a CRM would use, and this one does not.
    expect(within(dialog).queryByText(/direction/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/^inbound$/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/activity type/i)).not.toBeInTheDocument()
  })

  it('records a call and a note in five interactions', async () => {
    const user = userEvent.setup()
    const { submissions } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    await user.click(screen.getByRole('radio', { name: 'They called us' }))
    await user.type(screen.getByLabelText('What was said?'), 'Asked about the Life Centre.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(submissions).toHaveLength(1))
    expect(submissions[0]).toMatchObject({
      contact_id: 'cccccccc-1111-4111-8111-111111111111',
      kind: 'call_in',
      note: 'Asked about the Life Centre.',
    })
  })

  it('keeps the follow-up fields out of the way until they are wanted', async () => {
    const user = userEvent.setup()
    const { submissions } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    expect(screen.queryByLabelText('By when')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Something needs to happen next/ }))
    await user.type(screen.getByLabelText('By when'), '2026-09-01')
    await user.type(screen.getByLabelText('What, exactly?'), 'Send the trust illustration')
    await user.type(screen.getByLabelText('What was said?'), 'Long conversation.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(submissions).toHaveLength(1))
    expect(submissions[0]).toMatchObject({
      follow_up_on: '2026-09-01',
      follow_up_note: 'Send the trust illustration',
    })
  })

  it('asks which way round only for email and text', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Log interaction' }))

    expect(screen.queryByRole('radio', { name: 'They sent it' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Email' }))
    expect(screen.getByRole('radio', { name: 'They sent it' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Meeting' }))
    expect(screen.queryByRole('radio', { name: 'They sent it' })).not.toBeInTheDocument()
  })

  it('marks an email as received when the person says so', async () => {
    const user = userEvent.setup()
    const { submissions } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    await user.click(screen.getByRole('radio', { name: 'Email' }))
    await user.click(screen.getByRole('radio', { name: 'They sent it' }))
    await user.type(screen.getByLabelText('What was said?'), 'She replied about the dinner.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(submissions).toHaveLength(1))
    expect(submissions[0]).toMatchObject({ kind: 'email', received: 'on' })
  })

  it('offers a related proposal only when there is one', async () => {
    const user = userEvent.setup()
    renderDialog({
      proposals: [
        { id: 'pppppppp-1111-4111-8111-111111111111', title: 'Farm trust', status: 'presented' },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    // Behind the disclosure — present, but not in the way.
    await user.click(screen.getByRole('button', { name: /More detail/ }))
    expect(screen.getByLabelText('About a proposal?')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    renderDialog()

    const trigger = screen.getByRole('button', { name: 'Log interaction' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes itself once the save succeeds', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    await user.type(screen.getByLabelText('What was said?'), 'Left a voicemail.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and shows the reason when the save fails', async () => {
    const user = userEvent.setup()
    const { action } = recordingAction({ error: 'Could not save that.' })
    render(
      <LogInteractionDialog
        contactId="cccccccc-1111-4111-8111-111111111111"
        contactName="Ruth Alvarez"
        proposals={[]}
        action={action}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    await user.type(screen.getByLabelText('What was said?'), 'Something.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('progressive disclosure', () => {
  it('summarises what is inside while it is closed, and hides the summary once open', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure label="Financial details" summary="Fair market value, estimated deduction">
        <p>Inside</p>
      </Disclosure>,
    )

    const toggle = screen.getByRole('button', { name: /Financial details/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Fair market value, estimated deduction')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Fair market value, estimated deduction')).not.toBeInTheDocument()
  })

  it('still submits the fields it is hiding', () => {
    // Load-bearing: the contact form keeps address and organisation collapsed,
    // and a collapsed section that dropped its values would silently erase
    // them on every save.
    render(
      <form data-testid="form">
        <Disclosure label="Address">
          <input name="city" defaultValue="Tulsa" readOnly />
        </Disclosure>
      </form>,
    )

    const form = screen.getByTestId('form') as HTMLFormElement
    expect(new FormData(form).get('city')).toBe('Tulsa')
  })
})
