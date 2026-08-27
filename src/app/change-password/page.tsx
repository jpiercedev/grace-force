import { redirect } from 'next/navigation'
import { AuthCard } from '@/app/(auth)/auth-card'
import { ChangePasswordForm } from './change-password-form'
import { Callout } from '@/components/ui/display'
import { loadProfile } from '@/lib/auth'

export const metadata = { title: 'Change your password' }

/**
 * Serves two situations with one form.
 *
 * Forced: `requireProfile` sends anyone carrying `must_change_password` here
 * and refuses every other authenticated route, so this is the only page they
 * can reach until they have rotated it. Voluntary: anyone else who wants to
 * change their password, which is otherwise not possible anywhere in the app.
 *
 * Guarded with `loadProfile` rather than `requireProfile` on purpose — the
 * latter redirects *here*, so using it would make the page bounce off itself.
 */
export default async function ChangePasswordPage() {
  const result = await loadProfile()
  if (result.status === 'no-session') redirect('/login?next=%2Fchange-password')

  const forced = result.user.mustChangePassword

  return (
    <AuthCard
      title={forced ? 'Set your own password' : 'Change your password'}
      description={
        forced
          ? 'One step before you can start.'
          : `Signed in as ${result.user.email ?? 'your account'}.`
      }
    >
      {forced ? (
        <Callout tone="info" className="mb-5">
          This account was set up for you, so its current password was chosen by
          someone else and has been shared at least once. Pick one only you know
          and the rest of the app opens up.
        </Callout>
      ) : null}

      <ChangePasswordForm />
    </AuthCard>
  )
}
