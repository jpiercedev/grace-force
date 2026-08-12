import 'server-only'

import { CONTACT_REF_FIELDS, toContactRef, type ContactRef } from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/server'
import type { AttachmentRow, CallReportRow } from '@/types/database'

/**
 * Reads for call reports — the written record of a donor meeting.
 *
 * Drafts are visible only to their author (and administrators); that is
 * enforced by the RLS policy, not filtered here.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

export const CALL_REPORT_PAGE_SIZE = 50

export interface CallReportSummary {
  id: string
  metOn: string
  meetingKind: CallReportRow['meeting_kind']
  status: CallReportRow['status']
  location: string | null
  summary: string | null
  followUpOn: string | null
  authorId: string | null
  contact: ContactRef | null
  attachmentCount: number
}

const SUMMARY_SELECT = `
  id, met_on, meeting_kind, status, location, summary, follow_up_on, author_id,
  contact:contacts(${CONTACT_REF_FIELDS}),
  attachments(id)
`

interface SummaryRow {
  id: string
  met_on: string
  meeting_kind: CallReportRow['meeting_kind']
  status: CallReportRow['status']
  location: string | null
  summary: string | null
  follow_up_on: string | null
  author_id: string | null
  contact: never
  attachments: Array<{ id: string }>
}

function toSummary(row: SummaryRow): CallReportSummary {
  return {
    id: row.id,
    metOn: row.met_on,
    meetingKind: row.meeting_kind,
    status: row.status,
    location: row.location,
    summary: row.summary,
    followUpOn: row.follow_up_on,
    authorId: row.author_id,
    contact: toContactRef(row.contact),
    attachmentCount: row.attachments.length,
  }
}

export async function listCallReports(options: {
  authorId?: string | null
  status?: CallReportRow['status'] | null
}): Promise<CallReportSummary[]> {
  const supabase = await createClient()
  let query = supabase.from('call_reports').select(SUMMARY_SELECT).limit(CALL_REPORT_PAGE_SIZE)

  if (options.authorId) query = query.eq('author_id', options.authorId)
  if (options.status) query = query.eq('status', options.status)

  const { data, error } = await query.order('met_on', { ascending: false })
  if (error) fail('call reports', error)
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary)
}

export async function getContactCallReports(contactId: string): Promise<CallReportSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_reports')
    .select(SUMMARY_SELECT)
    .eq('contact_id', contactId)
    .order('met_on', { ascending: false })

  if (error) fail('call reports for this person', error)
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary)
}

export interface CallReportDetail {
  report: CallReportRow
  contact: ContactRef | null
  attachments: AttachmentRow[]
}

export async function getCallReport(id: string): Promise<CallReportDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_reports')
    .select(`*, contact:contacts(${CONTACT_REF_FIELDS}), attachments(*)`)
    .eq('id', id)
    .maybeSingle()

  if (error) fail('the call report', error)
  if (!data) return null

  const row = data as unknown as CallReportRow & {
    contact: never
    attachments: AttachmentRow[]
  }
  const { attachments, ...report } = row
  return {
    report: report as CallReportRow,
    contact: toContactRef(row.contact),
    attachments: [...attachments].sort((a, b) => a.file_name.localeCompare(b.file_name)),
  }
}
