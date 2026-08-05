'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { MAILCHIMP_JOB_LABELS, jobsFor, parseMailchimpJob } from '@/lib/mailchimp/jobs'
import { mailchimpUnavailableReason, runMailchimpSync } from '@/lib/mailchimp/run'
import { SYNC_STATUS_LABELS, type MailchimpActionState } from '@/lib/mailchimp/ui'
import { createClient } from '@/lib/supabase/server'
import { contactDisplayName } from '@/lib/utils'

/**
 * Admin mutations for the Mailchimp screens.
 *
 * "Sync now" runs the jobs here rather than calling the cron route: that route
 * is protected by `CRON_SECRET`, and a secret the browser can send is a secret
 * that has left the server. `requireAdmin()` is the guard instead, and the
 * service-role client stays inside the sync engine.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function revalidateMailchimp(): void {
  revalidatePath('/mailchimp')
  revalidatePath('/mailchimp/unmatched')
}

export async function syncMailchimpNow(
  _prev: MailchimpActionState,
  formData: FormData,
): Promise<MailchimpActionState> {
  const profile = await requireAdmin()

  const selection = parseMailchimpJob(text(formData, 'job'))
  if (!selection) return { error: 'That is not one of the sync jobs.' }

  const unavailable = mailchimpUnavailableReason()
  if (unavailable) return { error: unavailable }

  let runs
  try {
    runs = await runMailchimpSync(jobsFor(selection), profile.id)
  } catch (error) {
    // Anything that escapes the engine is infrastructure, not user input.
    return {
      error: `The sync could not be started: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // A sync can create contacts and start engagements, so the screens that list
  // them are stale now too.
  revalidateMailchimp()
  revalidatePath('/contacts')
  revalidatePath('/dashboard')

  const summary = runs
    .map((run) => `${MAILCHIMP_JOB_LABELS[run.job]}: ${SYNC_STATUS_LABELS[run.status].toLowerCase()}`)
    .join(' · ')

  const failed = runs.filter((run) => run.status === 'failed')
  if (failed.length === runs.length && failed[0]) {
    return { error: `Sync failed. ${failed[0].error ?? 'No detail was reported.'}` }
  }
  if (failed[0]) {
    return { notice: summary, error: `${MAILCHIMP_JOB_LABELS[failed[0].job]} failed: ${failed[0].error}` }
  }

  return { notice: `Sync finished. ${summary}` }
}

const linkSchema = z.object({
  member_id: z.string().uuid('That subscriber could not be found'),
  contact_id: z.string().uuid('Choose a contact to link'),
})

/**
 * Links an unmatched subscriber to a contact by hand.
 *
 * Written through the user's own client: `mailchimp_members_admin_update` is
 * the policy that permits it, so Postgres refuses a non-admin even if this
 * action were reached some other way. `match_method` records that a person
 * decided, which is what stops the next sync treating it as a guess.
 */
export async function linkMemberToContact(
  _prev: MailchimpActionState,
  formData: FormData,
): Promise<MailchimpActionState> {
  await requireAdmin()

  const parsed = linkSchema.safeParse({
    member_id: text(formData, 'member_id'),
    contact_id: text(formData, 'contact_id'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (key !== '' && !(key in fieldErrors)) fieldErrors[key] = issue.message
    }
    return { error: 'Check the highlighted fields.', fieldErrors }
  }

  const supabase = await createClient()

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id, full_name, preferred_name, first_name, last_name, organization_name, email')
    .eq('id', parsed.data.contact_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (contactError) return { error: 'That contact could not be loaded.' }
  if (!contact) return { error: 'That contact no longer exists.' }

  const { data, error } = await supabase
    .from('mailchimp_members')
    .update({
      contact_id: contact.id,
      match_method: 'manual',
      matched_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.member_id)
    .select('id, email_address')
    .maybeSingle()

  if (error) return { error: 'That subscriber could not be linked.' }
  // Row Level Security matching nothing looks like a successful no-op; say
  // plainly that it was refused rather than reporting a phantom success.
  if (!data) return { error: 'That subscriber could not be linked. Only admins may change a link.' }

  revalidateMailchimp()
  revalidatePath(`/contacts/${contact.id}`)

  return { notice: `${data.email_address} is now linked to ${contactDisplayName(contact)}.` }
}
