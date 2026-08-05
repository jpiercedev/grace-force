'use server'

import { revalidatePath } from 'next/cache'
import { ROLE_LABELS, isAdmin, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { toFieldErrors } from '@/lib/validation/contact'
import {
  isLastAdminRefusal,
  memberAccessSchema,
  type TeamActionState,
} from './access'

/**
 * Team administration mutations.
 *
 * `role`, `can_view_giving` and `is_active` are protected columns: the
 * `profiles_protect_privileges` trigger silently reverts them for non-admins
 * rather than raising, so a successful update is not on its own proof that the
 * change took. Every write here reads the row back and compares.
 */

const NO_PERMISSION = 'Only an administrator can change who has access.'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

export async function updateTeamMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const profile = await requireProfile()
  if (!isAdmin(profile)) return { error: NO_PERMISSION }

  const parsed = memberAccessSchema.safeParse({
    id: text(formData, 'id'),
    role: text(formData, 'role'),
    can_view_giving: formData.get('can_view_giving'),
    is_active: formData.get('is_active'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) }
  }

  const { id, role, can_view_giving, is_active } = parsed.data

  const supabase = await createClient()
  const { data: member, error: lookupError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, can_view_giving, is_active')
    .eq('id', id)
    .maybeSingle()

  if (lookupError) return { error: 'That team member could not be loaded.' }
  if (!member) return { error: 'That team member could not be found.' }

  const name = member.full_name?.trim() || member.email

  // The panel submits every control whether or not it was touched, so an
  // untouched save is common. Saying nothing changed beats claiming it saved.
  const changes: string[] = []
  if (member.role !== role) changes.push(`role set to ${ROLE_LABELS[role].toLowerCase()}`)
  if (member.can_view_giving !== can_view_giving) {
    changes.push(can_view_giving ? 'giving access granted' : 'giving access removed')
  }
  if (member.is_active !== is_active) changes.push(is_active ? 'reactivated' : 'deactivated')

  if (changes.length === 0) return { notice: `Nothing changed for ${name}.` }

  const { data, error } = await supabase
    .from('profiles')
    .update({ role, can_view_giving, is_active })
    .eq('id', id)
    .select('id, role, can_view_giving, is_active')
    .maybeSingle()

  if (error) {
    if (isLastAdminRefusal(error)) {
      return {
        error: `${name} is the only active administrator, so the database refused this change. Make someone else an administrator first.`,
      }
    }
    return { error: `${name}'s access could not be saved.` }
  }

  // Row Level Security matching nothing reads as a successful no-op over
  // PostgREST; surface it as the refusal it is.
  if (!data) return { error: `${name}'s access could not be updated.` }

  if (
    data.role !== role ||
    data.can_view_giving !== can_view_giving ||
    data.is_active !== is_active
  ) {
    return {
      error: `${name}'s access was left as it was. Only an administrator can change these, and the change was reverted.`,
    }
  }

  revalidatePath('/settings/team')

  return { notice: `${name}: ${changes.join(', ')}.` }
}
