'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export interface ChangePasswordState {
  error?: string
}

const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm: z.string().min(1, 'Confirm your new password'),
  })
  .refine((value) => value.password === value.confirm, {
    message: 'Those passwords do not match',
    path: ['confirm'],
  })

/**
 * Rotates the signed-in user's password.
 *
 * Nothing here clears the "must change password" flag: an
 * `auth.users` trigger drops it when the password hash changes, so the guard
 * cannot be satisfied by an action that merely claims to have done the work.
 * That also means this same form serves a voluntary change and a forced one.
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    // Surfaced rather than flattened: the useful ones here are "should be
    // different from the old password" and the project's own strength rules,
    // and replacing them with something generic leaves no way to comply.
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
