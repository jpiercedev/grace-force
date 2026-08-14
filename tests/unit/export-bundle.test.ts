import { describe, expect, it } from 'vitest'
import { mapContactColumns, planContactImport } from '@/lib/csv/contacts'
import { parseCsv } from '@/lib/csv/parse'
import {
  BUNDLE_DATASETS,
  MANIFEST_COLUMNS,
  availableDatasets,
  dependencyLabels,
  exportEndpoint,
  manifestRows,
} from '@/lib/export/bundle'
import { csvDocument, exportFilename } from '@/lib/export/csv'
import {
  ACTIVITY_EXPORT_COLUMNS,
  CONTACT_EXPORT_COLUMNS,
  ENGAGEMENT_EXPORT_COLUMNS,
  GIFT_EXPORT_COLUMNS,
  activityExportRow,
  contactExportRow,
  engagementExportRow,
  followUpExportRow,
  giftExportRow,
  pipelineCardExportRow,
  type ActivityExportRecord,
  type ContactExportRecord,
  type EngagementExportRecord,
  type ExportRow,
  type FollowUpExportRecord,
  type GiftExportRecord,
  type PipelineCardExportRecord,
} from '@/lib/export/datasets'

/**
 * The export is the promise that Grace Force can leave with its own data.
 * What matters is not that the files exist but that they still describe the
 * same graph once they are somewhere else: ids that resolve, and values that
 * survive the trip through a comma-separated format.
 */

const CONTACT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OTHER_CONTACT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const ENGAGEMENT_ID = 'cccccccc-3333-4333-8333-cccccccccccc'
const CARD_ID = 'dddddddd-4444-4444-8444-dddddddddddd'
const TYPE_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'

const TYPES = new Map([[TYPE_ID, { slug: 'donor', label: 'Donor' }]])
const PIPELINES = new Map([['pipeline-1', 'major_gift']])
const STAGES = new Map([['stage-1', 'Cultivation']])

function contactRecord(overrides: Partial<ContactExportRecord> = {}): ContactExportRecord {
  return {
    id: CONTACT_ID,
    external_source: 'csv',
    external_id: 'A-1',
    first_name: 'Jane',
    last_name: 'Doe',
    preferred_name: null,
    full_name: 'Jane Doe',
    email: 'jane@example.org',
    secondary_email: null,
    phone: '555-0100',
    mobile_phone: null,
    address_line1: '1 Main Street',
    address_line2: null,
    city: 'Springfield',
    region: 'IL',
    postal_code: '62701',
    country: 'US',
    organization_name: null,
    job_title: null,
    lifecycle_stage: 'active',
    status: 'active',
    source: 'import',
    source_detail: null,
    owner_id: null,
    do_not_contact: false,
    do_not_email: false,
    birthday: '1990-03-04',
    tags: ['donor', 'prayer team'],
    notes: null,
    last_activity_at: '2026-08-01T09:00:00+00:00',
    created_at: '2026-01-01T09:00:00+00:00',
    updated_at: '2026-08-01T09:00:00+00:00',
    ...overrides,
  }
}

function engagementRecord(): EngagementExportRecord {
  return {
    id: ENGAGEMENT_ID,
    contact_id: CONTACT_ID,
    engagement_type_id: TYPE_ID,
    status: 'active',
    role_detail: null,
    owner_id: null,
    started_on: '2026-01-05',
    ended_on: null,
    last_touch_at: null,
    notes: null,
    external_source: null,
    external_id: null,
    created_at: '2026-01-05T09:00:00+00:00',
    updated_at: '2026-01-05T09:00:00+00:00',
  }
}

function activityRecord(): ActivityExportRecord {
  return {
    id: 'ffffffff-6666-4666-8666-ffffffffffff',
    contact_id: OTHER_CONTACT_ID,
    engagement_id: ENGAGEMENT_ID,
    pipeline_card_id: CARD_ID,
    type: 'note',
    direction: 'internal',
    source: 'manual',
    subject: 'Coffee',
    body: 'Talked about the spring appeal',
    occurred_at: '2026-02-02T15:00:00+00:00',
    actor_id: null,
    actor_label: null,
    metadata: { minutes: 30 },
    dedupe_key: null,
    is_pinned: false,
    created_at: '2026-02-02T15:05:00+00:00',
  }
}

function followUpRecord(): FollowUpExportRecord {
  return {
    id: '11111111-7777-4777-8777-111111111111',
    contact_id: CONTACT_ID,
    engagement_id: null,
    pipeline_card_id: null,
    title: 'Send the annual report',
    details: null,
    due_at: '2026-09-01T09:00:00+00:00',
    remind_at: null,
    priority: 'normal',
    status: 'open',
    assigned_to: null,
    created_by: null,
    completed_at: null,
    completed_by: null,
    outcome_note: null,
    created_at: '2026-08-01T09:00:00+00:00',
    updated_at: '2026-08-01T09:00:00+00:00',
  }
}

function giftRecord(): GiftExportRecord {
  return {
    id: '22222222-8888-4888-8888-222222222222',
    contact_id: CONTACT_ID,
    amount_cents: 123456,
    currency: 'USD',
    given_on: '2026-03-01',
    method: 'check',
    fund: 'General Fund',
    campaign: null,
    is_recurring: false,
    recurrence: null,
    is_anonymous: false,
    receipt_number: null,
    notes: null,
    external_source: 'csv',
    external_id: 'T-1',
    created_at: '2026-03-01T09:00:00+00:00',
    updated_at: '2026-03-01T09:00:00+00:00',
  }
}

function pipelineCardRecord(): PipelineCardExportRecord {
  return {
    id: CARD_ID,
    contact_id: OTHER_CONTACT_ID,
    engagement_id: ENGAGEMENT_ID,
    pipeline_id: 'pipeline-1',
    stage_id: 'stage-1',
    title: 'Spring appeal ask',
    details: null,
    organization_name: 'Alvarez Trust',
    next_step: 'Send the revised quote',
    value_cents: 500000,
    currency: 'USD',
    status: 'open',
    owner_id: null,
    expected_close_on: '2026-10-01',
    closed_at: null,
    close_reason: null,
    position: 1,
    created_at: '2026-05-01T09:00:00+00:00',
    updated_at: '2026-05-01T09:00:00+00:00',
  }
}

/** The whole bundle, built by the same mappers the route uses. */
function buildBundle(): Record<string, ExportRow[]> {
  return {
    contacts: [contactRecord(), contactRecord({ id: OTHER_CONTACT_ID, external_id: 'A-2' })].map(
      contactExportRow,
    ),
    engagements: [engagementExportRow(engagementRecord(), TYPES)],
    pipeline_cards: [pipelineCardExportRow(pipelineCardRecord(), PIPELINES, STAGES)],
    activities: [activityExportRow(activityRecord())],
    follow_ups: [followUpExportRow(followUpRecord())],
    gifts: [giftExportRow(giftRecord())],
    leads: [],
  }
}

describe('bundle structure', () => {
  it('lists every dataset after the ones it references', () => {
    const seen = new Set<string>()
    for (const dataset of BUNDLE_DATASETS) {
      for (const reference of dataset.references) {
        expect(seen, `${dataset.key} references ${reference}`).toContain(reference)
      }
      seen.add(dataset.key)
    }
  })

  it('gives every row its own id, and every child its parent ids', () => {
    for (const dataset of BUNDLE_DATASETS) {
      expect(dataset.columns, dataset.key).toContain('id')
      for (const reference of dataset.references) {
        // `contacts` → `contact_id`, `engagements` → `engagement_id`.
        expect(dataset.columns, `${dataset.key} → ${reference}`).toContain(
          `${reference.replace(/s$/, '')}_id`,
        )
      }
    }
  })

  it('offers every dataset, gifts included — giving is shared workspace data', () => {
    const keys = availableDatasets().map((dataset) => dataset.key)

    expect(keys).toContain('gifts')
    expect(keys).toEqual(BUNDLE_DATASETS.map((dataset) => dataset.key))
  })

  it('names an endpoint per dataset', () => {
    expect(exportEndpoint('contacts')).toBe('/api/export/contacts')
  })
})

describe('referential integrity', () => {
  it('resolves every child row to a contact in the contacts dataset', () => {
    const bundle = buildBundle()
    const contactIds = new Set(bundle.contacts?.map((row) => String(row.id)) ?? [])

    for (const dataset of BUNDLE_DATASETS) {
      if (!dataset.references.includes('contacts')) continue
      for (const row of bundle[dataset.key] ?? []) {
        const parent = row.contact_id
        // Leads may genuinely have no contact yet; a non-empty one must resolve.
        if (parent === null || parent === '') continue
        expect(contactIds, `${dataset.key} row ${String(row.id)}`).toContain(String(parent))
      }
    }
  })

  it('resolves engagement and pipeline card references too', () => {
    const bundle = buildBundle()
    const engagementIds = new Set(bundle.engagements?.map((row) => String(row.id)) ?? [])
    const cardIds = new Set(bundle.pipeline_cards?.map((row) => String(row.id)) ?? [])

    const activity = bundle.activities?.[0]
    expect(engagementIds).toContain(String(activity?.engagement_id))
    expect(cardIds).toContain(String(activity?.pipeline_card_id))
  })

  it('produces the same ids on a second run, so two exports are comparable', () => {
    const first = buildBundle()
    const second = buildBundle()

    for (const dataset of BUNDLE_DATASETS) {
      const columns = dataset.columns
      expect(csvDocument(columns, second[dataset.key] ?? [])).toBe(
        csvDocument(columns, first[dataset.key] ?? []),
      )
    }
  })
})

describe('csvDocument', () => {
  it('survives values containing commas, quotes and newlines', () => {
    const notes = 'Said "yes", then asked about\nthe building fund'
    const document = csvDocument(
      CONTACT_EXPORT_COLUMNS,
      [contactExportRow(contactRecord({ notes, organization_name: 'Doe, Roe & Co' }))],
    )

    const parsed = parseCsv(document)
    expect(parsed.headers).toEqual([...CONTACT_EXPORT_COLUMNS])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.cells.notes).toBe(notes)
    expect(parsed.rows[0]?.cells.organization_name).toBe('Doe, Roe & Co')
  })

  it('writes a null as an empty cell rather than the word null', () => {
    const document = csvDocument(CONTACT_EXPORT_COLUMNS, [
      contactExportRow(contactRecord({ preferred_name: null })),
    ])

    expect(parseCsv(document).rows[0]?.cells.preferred_name).toBe('')
  })

  it('keeps money as integer cents', () => {
    const document = csvDocument(GIFT_EXPORT_COLUMNS, [giftExportRow(giftRecord())])

    expect(parseCsv(document).rows[0]?.cells.amount_cents).toBe('123456')
  })

  it('writes only the dataset’s own columns, in its own order', () => {
    const [header] = csvDocument(ENGAGEMENT_EXPORT_COLUMNS, [
      engagementExportRow(engagementRecord(), TYPES),
    ]).split('\r\n')

    expect(header).toBe(ENGAGEMENT_EXPORT_COLUMNS.join(','))
  })

  it('carries a readable label beside each foreign key', () => {
    const engagement = engagementExportRow(engagementRecord(), TYPES)
    const card = pipelineCardExportRow(pipelineCardRecord(), PIPELINES, STAGES)

    expect(engagement).toMatchObject({ engagement_type: 'donor', engagement_type_label: 'Donor' })
    expect(card).toMatchObject({ pipeline: 'major_gift', stage: 'Cultivation' })
  })

  it('serialises jsonb as JSON, and an empty object as nothing at all', () => {
    const withMetadata = activityExportRow(activityRecord())
    const withoutMetadata = activityExportRow({ ...activityRecord(), metadata: {} })

    expect(withMetadata.metadata).toBe('{"minutes":30}')
    expect(withoutMetadata.metadata).toBe('')
    expect(ACTIVITY_EXPORT_COLUMNS).toContain('metadata')
  })
})

describe('round trip', () => {
  it('re-imports an exported contact as an update to the same record', () => {
    const record = contactRecord()
    const document = csvDocument(CONTACT_EXPORT_COLUMNS, [contactExportRow(record)])

    const parsed = parseCsv(document)
    const mapping = mapContactColumns(parsed.headers)
    const plan = planContactImport(parsed.rows, {
      fields: mapping.fields,
      index: {
        ids: new Set([record.id]),
        byExternalId: new Map([['A-1', record.id]]),
        byEmail: new Map([['jane@example.org', record.id]]),
        externalKeys: new Map([[record.id, 'csv:A-1']]),
      },
      externalSource: 'csv',
    })

    expect(plan.counts).toMatchObject({ create: 0, update: 1, error: 0 })
    expect(plan.rows[0]).toMatchObject({ matchedBy: 'id', contactId: record.id })
    // Tags leave as "donor, prayer team" and come back as the same list.
    expect(plan.rows[0]?.values.tags).toEqual(['donor', 'prayer team'])
    expect(plan.rows[0]?.values.birthday).toBe('1990-03-04')
  })
})

describe('manifest', () => {
  it('describes each dataset, its size, its columns and what it points at', () => {
    const rows = manifestRows([
      { dataset: BUNDLE_DATASETS[0]!, rowCount: 1200 },
      { dataset: BUNDLE_DATASETS[1]!, rowCount: 340 },
    ])

    expect(Object.keys(rows[0] ?? {})).toEqual([...MANIFEST_COLUMNS])
    expect(rows[0]).toMatchObject({ dataset: 'contacts', row_count: 1200, references: '' })
    expect(rows[1]).toMatchObject({ dataset: 'engagements', references: 'contacts' })
  })

  it('reads back as a table with one row per dataset', () => {
    const entries = BUNDLE_DATASETS.map((dataset) => ({ dataset, rowCount: 0 }))
    const parsed = parseCsv(csvDocument(MANIFEST_COLUMNS, manifestRows(entries)))

    expect(parsed.rows).toHaveLength(BUNDLE_DATASETS.length)
    expect(parsed.rows[0]?.cells.columns).toContain('id')
  })

  it('names the datasets a reader has to load first', () => {
    const activities = BUNDLE_DATASETS.find((dataset) => dataset.key === 'activities')

    expect(dependencyLabels(activities!)).toEqual(['Contacts', 'Engagements', 'Pipeline cards'])
  })
})

describe('exportFilename', () => {
  it('dates the file so two downloads do not overwrite each other', () => {
    expect(exportFilename('follow_ups', new Date(2026, 7, 5))).toBe(
      'grace-lead-management-follow-ups-2026-08-05.csv',
    )
  })
})
