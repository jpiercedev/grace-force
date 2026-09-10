import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContactImportDialog } from '@/components/domain/contact-import-dialog'
import type { ContactImportResult, ContactImportState } from '@/lib/csv/ui'

/**
 * The People tab's import, driven the way a person drives it: open the
 * dialog, pick a file, check the column matching, import, read the result.
 *
 * What would quietly break it is asserted here — that the server gets the
 * file the person chose and the mapping they confirmed (not the one the
 * headings suggested), that two columns cannot feed one field, and that a
 * server error does not send anyone back to the file picker.
 */

const CSV = [
  'Given name,Surname,E-mail,Cell,Membership no.',
  'Ruth,Alvarez,ruth@example.org,555-0100,M-1',
  'Sam,Okafor,sam@example.org,,M-2',
  'Grace Chapel,,office@gracechapel.org,555-0199,M-3',
].join('\n')

function csvFile(contents = CSV, name = 'people.csv'): File {
  return new File([contents], name, { type: 'text/csv' })
}

interface Submission {
  file: File | null
  mapping: Record<string, string>
}

function recordingAction(results: ContactImportState[]) {
  const submissions: Submission[] = []
  const queue = [...results]
  const action = vi.fn(async (_prev: ContactImportState, formData: FormData) => {
    const file = formData.get('file')
    const mapping = formData.get('mapping')
    submissions.push({
      file: file instanceof File ? file : null,
      mapping: typeof mapping === 'string' ? (JSON.parse(mapping) as Record<string, string>) : {},
    })
    return queue.shift() ?? {}
  })
  return { action, submissions }
}

function importedResult(overrides: Partial<ContactImportResult> = {}): ContactImportResult {
  return {
    batchId: 'bbbbbbbb-1111-4111-8111-111111111111',
    filename: 'people.csv',
    total: 3,
    created: 2,
    updated: 1,
    skipped: 0,
    failed: 0,
    problems: [],
    problemCount: 0,
    truncated: false,
    caveat: null,
    ...overrides,
  }
}

async function openWithFile(results: ContactImportState[] = [{ result: importedResult() }]) {
  const user = userEvent.setup()
  const { action, submissions } = recordingAction(results)
  render(<ContactImportDialog action={action} />)

  await user.click(screen.getByRole('button', { name: 'Import CSV' }))
  await user.upload(screen.getByLabelText(/CSV file/), csvFile())
  await screen.findByText(/5 columns · 3 rows/)

  return { user, action, submissions }
}

function selectFor(header: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name: `Import “${header}” as` })
}

describe('importing people from a CSV', () => {
  it('is one quiet button until someone asks for it', () => {
    render(<ContactImportDialog action={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('will not move on until a readable file is chosen', async () => {
    const user = userEvent.setup()
    render(<ContactImportDialog action={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))

    const next = screen.getByRole('button', { name: 'Next: match columns' })
    expect(next).toBeDisabled()

    await user.upload(screen.getByLabelText(/CSV file/), csvFile('Email\n'))
    expect(await screen.findByText(/header row but no data/)).toBeInTheDocument()
    expect(next).toBeDisabled()
  })

  it('suggests a field for each column from its heading, and shows an example value', async () => {
    const { user } = await openWithFile()
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))

    expect(selectFor('Given name')).toHaveValue('first_name')
    expect(selectFor('Surname')).toHaveValue('last_name')
    expect(selectFor('E-mail')).toHaveValue('email')
    expect(selectFor('Cell')).toHaveValue('mobile_phone')
    expect(selectFor('Membership no.')).toHaveValue('')

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('ruth@example.org')).toBeInTheDocument()
    expect(within(dialog).getByText('4 of 5 columns will be imported.')).toBeInTheDocument()
  })

  it('sends the file and the mapping the person confirmed, not the one the headings suggested', async () => {
    const { user, submissions } = await openWithFile()
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))

    await user.selectOptions(selectFor('Membership no.'), 'external_id')
    await user.selectOptions(selectFor('Cell'), '')
    await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))

    await waitFor(() => expect(submissions).toHaveLength(1))
    expect(submissions[0]?.file?.name).toBe('people.csv')
    expect(submissions[0]?.mapping).toEqual({
      'Given name': 'first_name',
      Surname: 'last_name',
      'E-mail': 'email',
      Cell: '',
      'Membership no.': 'external_id',
    })
  })

  it('refuses to import while two columns feed one field, and says which two', async () => {
    const { user, submissions } = await openWithFile()
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))

    await user.selectOptions(selectFor('Cell'), 'email')
    const cell = selectFor('Cell')
    expect(cell).toHaveAccessibleDescription(/Also chosen for “E-mail”/)
    expect(cell).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Import 3 rows' })).toBeDisabled()

    await user.selectOptions(selectFor('E-mail'), 'secondary_email')
    expect(screen.getByRole('button', { name: 'Import 3 rows' })).toBeEnabled()
    expect(submissions).toHaveLength(0)
  })

  it('warns when no column can name a new person', async () => {
    const { user } = await openWithFile()
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))
    expect(screen.queryByText('No name column is chosen')).not.toBeInTheDocument()

    await user.selectOptions(selectFor('Given name'), '')
    await user.selectOptions(selectFor('Surname'), 'preferred_name')
    expect(screen.getByText('No name column is chosen')).toBeInTheDocument()
  })

  it('reports what happened, row problems included, and links to the record', async () => {
    const { user } = await openWithFile([
      {
        result: importedResult({
          created: 1,
          updated: 1,
          failed: 1,
          problems: [{ row: 3, message: 'Email could not be read as an email address.' }],
          problemCount: 1,
        }),
      },
    ])
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))
    await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))

    const title = await screen.findByText('2 people imported from people.csv')
    const summary = title.closest('[role="status"]')
    if (!(summary instanceof HTMLElement)) throw new Error('summary callout missing')
    expect(within(summary).getByText('1 new person added')).toBeInTheDocument()
    expect(within(summary).getByText('1 existing person updated')).toBeInTheDocument()
    expect(within(summary).getByText('1 row not imported')).toBeInTheDocument()
    expect(screen.getByText(/Email could not be read/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the full import record' })).toHaveAttribute(
      'href',
      '/import/bbbbbbbb-1111-4111-8111-111111111111',
    )

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the chosen file through a server error so the import can simply be retried', async () => {
    const { user, submissions } = await openWithFile([
      { error: 'The file could not be imported. Try again.' },
      { result: importedResult() },
    ])
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))
    await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be imported')
    // Still on the mapping step, with the same file.
    expect(selectFor('E-mail')).toHaveValue('email')

    await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))
    await waitFor(() => expect(submissions).toHaveLength(2))
    expect(submissions[1]?.file?.name).toBe('people.csv')
    expect(await screen.findByText(/3 people imported/)).toBeInTheDocument()
  })

  it('starts over each time it is opened', async () => {
    const { user } = await openWithFile()
    await user.click(screen.getByRole('button', { name: 'Next: match columns' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(screen.getByRole('button', { name: 'Next: match columns' })).toBeDisabled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
