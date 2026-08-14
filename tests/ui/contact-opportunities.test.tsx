import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContactOpportunities } from '@/components/domain/contact-opportunities'
import type { ContactOpportunity } from '@/lib/queries/pipelines'

/**
 * The sales section of a person record is read far more often than it is
 * acted on, so these tests pin down what a reader gets: where each deal
 * stands, what happens next, and — for read-only accounts — no invitations
 * to do things they cannot do.
 */

const CONTACT_ID = 'cccccccc-1111-4111-8111-111111111111'
const ADD_HREF = `/sales/new?contact=${CONTACT_ID}`

function makeOpportunity(overrides: Partial<ContactOpportunity> = {}): ContactOpportunity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Website rebuild',
    organization_name: null,
    next_step: 'Send the revised quote',
    value_cents: 450_000,
    currency: 'USD',
    status: 'open',
    expected_close_on: '2026-09-15',
    closed_at: null,
    owner: {
      id: 'pppppppp-1111-4111-8111-111111111111',
      full_name: 'Dana Okoro',
      email: 'dana@example.org',
    },
    stage: {
      id: 'ssssssss-1111-4111-8111-111111111111',
      name: 'Proposal sent',
      color: 'amber',
      is_won: false,
      is_lost: false,
    },
    pipeline: {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      slug: 'web_projects',
      name: 'Web projects',
      tracks_value: true,
    },
    ...overrides,
  }
}

describe('ContactOpportunities', () => {
  it('renders open opportunities with stage badges and links to their board', () => {
    render(
      <ContactOpportunities
        contactId={CONTACT_ID}
        open={[makeOpportunity()]}
        settled={[]}
        canEdit
      />,
    )

    const title = screen.getByRole('link', { name: 'Website rebuild' })
    expect(title).toHaveAttribute('href', '/pipelines/web_projects')
    expect(screen.getByText('Proposal sent')).toBeInTheDocument()
    expect(screen.getByText('$4,500')).toBeInTheDocument()
    expect(screen.getByText('Web projects')).toBeInTheDocument()
    expect(screen.getByText('Dana Okoro')).toBeInTheDocument()
  })

  it('renders the next-step line when one is recorded, and omits it when not', () => {
    const { rerender } = render(
      <ContactOpportunities
        contactId={CONTACT_ID}
        open={[makeOpportunity()]}
        settled={[]}
        canEdit
      />,
    )
    expect(screen.getByText('Next step: Send the revised quote')).toBeInTheDocument()

    rerender(
      <ContactOpportunities
        contactId={CONTACT_ID}
        open={[makeOpportunity({ next_step: null })]}
        settled={[]}
        canEdit
      />,
    )
    expect(screen.queryByText(/next step:/i)).not.toBeInTheDocument()
  })

  it('shows an empty state with the add action when nothing is open', () => {
    render(<ContactOpportunities contactId={CONTACT_ID} open={[]} settled={[]} canEdit />)

    expect(screen.getByText('No open opportunities')).toBeInTheDocument()
    const add = screen.getByRole('link', { name: 'Add to a pipeline' })
    expect(add).toHaveAttribute('href', ADD_HREF)
  })

  it('labels settled opportunities with their outcome', () => {
    render(
      <ContactOpportunities
        contactId={CONTACT_ID}
        open={[]}
        settled={[
          makeOpportunity({
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Annual retainer',
            status: 'won',
            closed_at: '2026-07-30T12:00:00.000Z',
          }),
          makeOpportunity({
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Brand refresh',
            status: 'lost',
            closed_at: '2026-07-01T12:00:00.000Z',
          }),
        ]}
        canEdit
      />,
    )

    expect(screen.getByText('Recently settled')).toBeInTheDocument()
    expect(screen.getByText('Annual retainer')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
    expect(screen.getByText('Brand refresh')).toBeInTheDocument()
    expect(screen.getByText('Lost')).toBeInTheDocument()
  })

  it('offers no add actions to read-only accounts', () => {
    const { rerender } = render(
      <ContactOpportunities
        contactId={CONTACT_ID}
        open={[makeOpportunity()]}
        settled={[]}
        canEdit={false}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Add to a pipeline' })).not.toBeInTheDocument()

    // The empty state stays informative but actionless without write access.
    rerender(<ContactOpportunities contactId={CONTACT_ID} open={[]} settled={[]} canEdit={false} />)
    expect(screen.getByText('No open opportunities')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Add to a pipeline' })).not.toBeInTheDocument()
  })
})
