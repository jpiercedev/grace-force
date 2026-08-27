import { internalRecipients, siteUrl } from '@/lib/env'
import { interestLabel, leadDisplayName } from '@/lib/leads/triage'
import { sendNotification, type SendDeps, type SendResult } from '@/lib/notifications/send'
import { renderEmail } from '@/lib/notifications/templates'
import { contactDisplayName, formatDateTime } from '@/lib/utils'
import type { FollowUpPriority } from '@/types/database'

/**
 * The events the rest of the app notifies on.
 *
 * Callers state what happened; everything about how it is worded, who receives
 * it and how often it may repeat is decided here, so the dedupe keys stay in
 * one place and can be reasoned about as a set.
 *
 * This is staff-facing mail only. Nothing here ever writes to a contact.
 */

export interface NotifyOptions extends SendDeps {
  now?: Date
}

export interface LeadNotificationInput {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  organization_name: string | null
  message: string | null
  form_key: string
  interest: string | null
}

export interface FollowUpNotificationInput {
  id: string
  contact_id: string
  title: string
  details: string | null
  due_at: string
  priority: FollowUpPriority
  contact: {
    full_name?: string | null
    preferred_name?: string | null
    first_name?: string | null
    last_name?: string | null
    organization_name?: string | null
    email?: string | null
  } | null
}

export interface NotificationProfile {
  id: string
  email: string
  full_name: string | null
}

const PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

const FOOTER = 'Sent by Grace Lead Manager to the internal team. Contacts never receive this email.'

// --- Dedupe keys ------------------------------------------------------------

export function leadCreatedKey(leadId: string): string {
  return `lead_created:${leadId}`
}

/**
 * The date component is what lets a daily reminder repeat across days while
 * staying at most once within one. It is taken in UTC deliberately: a key that
 * moved with the server's local timezone would re-send the moment a deployment
 * region changed.
 */
export function followUpDueKey(followUpId: string, now: Date = new Date()): string {
  return `follow_up_due:${followUpId}:${now.toISOString().slice(0, 10)}`
}

/** Reassigning to the same person twice is not a second event; changing owner is. */
export function followUpAssignedKey(followUpId: string, assigneeId: string): string {
  return `follow_up_assigned:${followUpId}:${assigneeId}`
}

// --- Events -----------------------------------------------------------------

export async function notifyLeadCreated(
  lead: LeadNotificationInput,
  options: NotifyOptions = {},
): Promise<SendResult> {
  const name = leadDisplayName(lead)
  const subject = `New enquiry: ${name}`
  const body = renderEmail({
    title: subject,
    intro: 'A new enquiry arrived through the public form and is waiting in the lead queue.',
    details: [
      { label: 'Name', value: name },
      { label: 'Email', value: lead.email },
      { label: 'Phone', value: lead.phone },
      { label: 'Organisation', value: lead.organization_name },
      { label: 'Interest', value: interestLabel(lead.interest) },
      { label: 'Form', value: lead.form_key },
    ],
    quote: lead.message ? { label: 'Their message', body: lead.message } : null,
    action: { label: 'Open the lead queue', url: `${siteUrl()}/leads` },
    footer: FOOTER,
  })

  return sendNotification(
    {
      kind: 'lead_created',
      dedupeKey: leadCreatedKey(lead.id),
      recipients: internalRecipients(),
      subject,
      text: body.text,
      html: body.html,
      payload: { lead_id: lead.id, form_key: lead.form_key },
      related: { leadId: lead.id },
    },
    options,
  )
}

export async function notifyFollowUpDue(
  followUp: FollowUpNotificationInput,
  assignee: NotificationProfile,
  options: NotifyOptions = {},
): Promise<SendResult> {
  const who = contactName(followUp)
  const subject = `Follow-up due: ${followUp.title}`
  const body = renderEmail({
    title: subject,
    intro: `Your follow-up with ${who} is due.`,
    details: [
      { label: 'Contact', value: who },
      { label: 'Due', value: formatDateTime(followUp.due_at) },
      { label: 'Priority', value: PRIORITY_LABELS[followUp.priority] },
    ],
    quote: followUp.details ? { label: 'Notes', body: followUp.details } : null,
    action: { label: 'Open the contact', url: contactUrl(followUp.contact_id) },
    footer: FOOTER,
  })

  return sendNotification(
    {
      kind: 'follow_up_due',
      dedupeKey: followUpDueKey(followUp.id, options.now ?? new Date()),
      recipients: [assignee.email],
      subject,
      text: body.text,
      html: body.html,
      payload: { follow_up_id: followUp.id, assignee_id: assignee.id, due_at: followUp.due_at },
      related: { followUpId: followUp.id, contactId: followUp.contact_id },
    },
    options,
  )
}

export async function notifyFollowUpAssigned(
  followUp: FollowUpNotificationInput,
  assignee: NotificationProfile,
  assigner: NotificationProfile | null,
  options: NotifyOptions = {},
): Promise<SendResult> {
  const who = contactName(followUp)
  const by = assigner ? personName(assigner) : 'Someone on the team'
  const subject = `Assigned to you: ${followUp.title}`
  const body = renderEmail({
    title: subject,
    intro: `${by} assigned you a follow-up with ${who}.`,
    details: [
      { label: 'Contact', value: who },
      { label: 'Due', value: formatDateTime(followUp.due_at) },
      { label: 'Priority', value: PRIORITY_LABELS[followUp.priority] },
      { label: 'Assigned by', value: assigner ? personName(assigner) : null },
    ],
    quote: followUp.details ? { label: 'Notes', body: followUp.details } : null,
    action: { label: 'Open the contact', url: contactUrl(followUp.contact_id) },
    footer: FOOTER,
  })

  return sendNotification(
    {
      kind: 'follow_up_assigned',
      dedupeKey: followUpAssignedKey(followUp.id, assignee.id),
      recipients: [assignee.email],
      subject,
      text: body.text,
      html: body.html,
      payload: {
        follow_up_id: followUp.id,
        assignee_id: assignee.id,
        assigned_by: assigner?.id ?? null,
      },
      related: { followUpId: followUp.id, contactId: followUp.contact_id },
    },
    options,
  )
}

function contactName(followUp: FollowUpNotificationInput): string {
  return followUp.contact ? contactDisplayName(followUp.contact) : 'a contact'
}

function personName(profile: NotificationProfile): string {
  return profile.full_name?.trim() || profile.email
}

/** The follow-up lives on the contact record, which is where the work happens. */
function contactUrl(contactId: string): string {
  return `${siteUrl()}/contacts/${contactId}`
}
