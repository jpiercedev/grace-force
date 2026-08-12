import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { AttachmentRow } from '@/types/database'

/**
 * Files attached to a donor, a call report or a proposal.
 *
 * The bytes live in the private `attachments` bucket; nothing in the interface
 * ever links to a raw object path. Downloads go through a short-lived signed
 * URL minted per request, so a link copied out of the page stops working
 * quickly rather than becoming a permanent unauthenticated handle on an estate
 * document.
 */

export const ATTACHMENTS_BUCKET = 'attachments'

/** Long enough to click, short enough that a pasted link is not a leak. */
const SIGNED_URL_TTL_SECONDS = 60

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

export async function getContactAttachments(contactId: string): Promise<AttachmentRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })

  if (error) fail('files', error)
  return data ?? []
}

/**
 * Null rather than throwing when storage is unreachable or the object has gone
 * missing: one broken file must not take down the whole Files tab, and the
 * caller renders an honest "unavailable" row instead.
 */
export async function signedDownloadUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: true })

  if (error || !data) return null
  return data.signedUrl
}

/** Signs a whole list in parallel, preserving order. */
export async function withDownloadUrls(
  attachments: AttachmentRow[],
): Promise<Array<AttachmentRow & { url: string | null }>> {
  const urls = await Promise.all(
    attachments.map((attachment) => signedDownloadUrl(attachment.storage_path)),
  )
  return attachments.map((attachment, index) => ({ ...attachment, url: urls[index] ?? null }))
}
