'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/env'

export interface AuthFormState {
  error?: string
  notice?: string
}

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

const signUpSchema = credentialsSchema.extend({
  password: z.string().min(8, 'Use at least 8 characters'),
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
})

/** Only allow relative in-app paths, so `?next=` cannot become an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // Deliberately vague: distinguishing "no such user" from "wrong password"
    // would let anyone enumerate who has an account here.
    return { error: 'That email and password combination was not recognised.' }
  }

  revalidatePath('/', 'layout')
  redirect(safeNext(formData.get('next')))
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // With email confirmation switched on, Supabase returns a user but no
  // session; the profile is created by the trigger once they confirm.
  if (!data.session) {
    redirect('/check-email')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
