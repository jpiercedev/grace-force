import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { Badge, Callout, EmptyState, StatTile } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'

/**
 * These primitives carry the accessibility contract for every form in the CRM.
 * The tests assert the relationships a screen reader depends on — label, hint,
 * error and invalid state — because those are exactly what breaks silently
 * when a component is refactored.
 */

describe('Field', () => {
  it('associates the label with the control', async () => {
    render(
      <Field label="Email address">{(props) => <Input {...props} name="email" />}</Field>,
    )
    const input = screen.getByLabelText('Email address')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('name', 'email')
  })

  it('exposes the hint to assistive technology via aria-describedby', () => {
    render(
      <Field label="Password" hint="At least 8 characters.">
        {(props) => <Input {...props} type="password" />}
      </Field>,
    )
    const input = screen.getByLabelText('Password')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(screen.getByText('At least 8 characters.').id).toBe(describedBy)
  })

  it('marks the control invalid and describes the error', () => {
    render(
      <Field label="Amount" error="Enter a positive amount">
        {(props) => <Input {...props} />}
      </Field>,
    )
    const input = screen.getByLabelText('Amount')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(
      screen.getByText('Enter a positive amount').id,
    )
  })

  it('describes the control by both hint and error when both are present', () => {
    render(
      <Field label="Due date" hint="When this is owed." error="Pick a future date">
        {(props) => <Input {...props} />}
      </Field>,
    )
    const describedBy = screen.getByLabelText('Due date').getAttribute('aria-describedby')!
    expect(describedBy.split(' ')).toHaveLength(2)
  })

  it('generates a distinct id per instance so two fields never collide', () => {
    render(
      <>
        <Field label="First name">{(props) => <Input {...props} />}</Field>
        <Field label="Last name">{(props) => <Input {...props} />}</Field>
      </>,
    )
    const first = screen.getByLabelText('First name')
    const last = screen.getByLabelText('Last name')
    expect(first.id).not.toBe(last.id)
  })

  it('marks a required field visually without polluting the accessible name', () => {
    render(<Field label="Title" required>{(props) => <Input {...props} />}</Field>)

    // getByLabelText matches raw text content, so the label reads "Title*" here.
    // What matters is that the asterisk is aria-hidden: the accessible-name
    // algorithm a real screen reader uses skips it and announces "Title".
    const input = screen.getByLabelText(/Title/)
    expect(input).toBeInTheDocument()

    const asterisk = screen.getByText('*')
    expect(asterisk).toHaveAttribute('aria-hidden', 'true')
  })

  it('works with textareas and selects, not just inputs', () => {
    render(
      <>
        <Field label="Notes">{(props) => <Textarea {...props} />}</Field>
        <Field label="Priority">
          {(props) => (
            <Select {...props}>
              <option value="normal">Normal</option>
            </Select>
          )}
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Priority').tagName).toBe('SELECT')
  })
})

describe('Checkbox', () => {
  it('is reachable and toggleable by label click and by keyboard', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Do not email" name="do_not_email" />)

    const checkbox = screen.getByLabelText('Do not email')
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByText('Do not email'))
    expect(checkbox).toBeChecked()

    await user.keyboard('{ }')
    expect(checkbox).not.toBeChecked()
  })

  it('describes itself with its hint', () => {
    render(<Checkbox label="Do not contact" hint="Suppresses all outreach." />)
    const checkbox = screen.getByLabelText('Do not contact')
    expect(checkbox.getAttribute('aria-describedby')).toBe(
      screen.getByText('Suppresses all outreach.').id,
    )
  })
})

describe('Button', () => {
  it('fires on click and on Enter', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save contact</Button>)

    const button = screen.getByRole('button', { name: 'Save contact' })
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('does not fire while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Callout', () => {
  it('announces politely by default', () => {
    render(<Callout tone="info">Mailchimp is not configured.</Callout>)
    expect(screen.getByRole('status')).toHaveTextContent('Mailchimp is not configured.')
  })

  it('interrupts when used for a form error', () => {
    render(
      <Callout tone="danger" role="alert">
        That email and password combination was not recognised.
      </Callout>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('renders its label as text, so colour is never the only signal', () => {
    render(<Badge tone="emerald">Donor</Badge>)
    expect(screen.getByText('Donor')).toBeInTheDocument()
  })
})

describe('StatTile', () => {
  it('pairs the value with its label as a description list', () => {
    render(<StatTile label="Open follow-ups" value={12} hint="4 overdue" />)
    expect(screen.getByText('Open follow-ups')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('4 overdue')).toBeInTheDocument()
  })

  it('becomes a link when given an href', () => {
    render(<StatTile label="Contacts" value={40} href="/contacts" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/contacts')
  })
})

describe('EmptyState', () => {
  it('explains the situation and offers a way forward', () => {
    render(
      <EmptyState
        title="No contacts yet"
        description="Add your first contact to get started."
        action={<Button>Add contact</Button>}
      />,
    )
    expect(screen.getByText('No contacts yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument()
  })
})
