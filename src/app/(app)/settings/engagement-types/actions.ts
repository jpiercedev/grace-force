'use server'

import { revalidatePath } from 'next/cache'
import { isAdmin, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { toFieldErrors } from '@/lib/validation/contact'
import {
  createEngagementTypeSchema,
  updateEngagementTypeSchema,
  type EngagementTypeActionState,
} from './catalogue'

/**
 * Engagement type catalogue mutations.
 *
 * The slug is written once, on create, and never updated: lead intake and the
 * Mailchimp sync both resolve engagement types by slug, so renaming one would
 * quietly stop those paths finding anything.
 *
 * There is no delete. `engagements.engagement_type_id` is ON DELETE RESTRICT,
 * so removing a type in use fails anyway, and removing an unused one would
 * still break any form still posting its slug. Deactivating is the reversible
 * equivalent.
 */

const NO_PERMISSION = 'Only an administrator can change the engagement type catalogue.'

/** Postgres unique-violation; here it always means the slug is taken. */
const UNIQUE_VIOLATION = '23505'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function revalidateCatalogue(): void {
  revalidatePath('/settings/engagement-types')
  // Labels and colours are rendered as badges wherever engagements appear.
  revalidatePath('/contacts', 'layout')
}

export async function createEngagementType(
  _prev: EngagementTypeActionState,
  formData: FormData,
): Promise<EngagementTypeActionState> {
  const profile = await requireProfile()
  if (!isAdmin(profile)) return { error: NO_PERMISSION }

  const parsed = createEngagementTypeSchema.safeParse({
    slug: text(formData, 'slug'),
    label: text(formData, 'label'),
    description: text(formData, 'description'),
    color: text(formData, 'color'),
    sort_order: text(formData, 'sort_order'),
    is_active: formData.get('is_active'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('engagement_types')
    .insert(parsed.data)
    .select('id, label')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error: `The slug “${parsed.data.slug}” is already in use. Slugs cannot be reused, because they are how other parts of the app find a type.`,
        fieldErrors: { slug: 'Already in use' },
      }
    }
    return { error: 'That engagement type could not be created.' }
  }
  if (!data) return { error: 'That engagement type could not be created.' }

  revalidateCatalogue()
  return { notice: `${data.label} added.` }
}

export async function updateEngagementType(
  _prev: EngagementTypeActionState,
  formData: FormData,
): Promise<EngagementTypeActionState> {
  const profile = await requireProfile()
  if (!isAdmin(profile)) return { error: NO_PERMISSION }

  const parsed = updateEngagementTypeSchema.safeParse({
    id: text(formData, 'id'),
    label: text(formData, 'label'),
    description: text(formData, 'description'),
    color: text(formData, 'color'),
    sort_order: text(formData, 'sort_order'),
    is_active: formData.get('is_active'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) }
  }

  const { id, ...patch } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('engagement_types')
    .update(patch)
    .eq('id', id)
    .select('id, label, is_active')
    .maybeSingle()

  if (error) return { error: 'That change could not be saved.' }
  // Row Level Security matching nothing reads as a successful no-op over
  // PostgREST; surface it as the refusal it is.
  if (!data) return { error: 'That engagement type could not be updated.' }

  revalidateCatalogue()
  return {
    notice: data.is_active
      ? `${data.label} saved.`
      : `${data.label} saved, and is no longer offered for new engagements.`,
  }
}
