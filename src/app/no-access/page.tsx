import { signOut } from '@/app/(auth)/actions'
import { BrandBand } from '@/app/(auth)/auth-card'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { loadProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Access paused' }

/**
 * The terminus for a signed-in user who cannot enter the app.
 *
 * This page has to be reachable by someone with *no profile row at all*, which
 * is why it reads the session user directly rather than relying on the profile.
 * Sending an unprovisioned user to /login instead would put them straight back
 * into the middleware's "signed in, go to /dashboard" rule and loop forever.
 *
 * Only a genuinely absent session redirects to /login.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const result = await loadProfile()
  if (result.status === 'no-session') redirect('/login')
  if (result.status === 'ok' && result.profile.is_active) redirect('/dashboard')

  const { reason } = await searchParams
  const email = result.status === 'ok' ? result.profile.email : (result.user.email ?? 'your account')

  // A failed query is a system fault. Saying "your account is not set up"
  // would send someone chasing an account problem that does not exist.
  const state =
    result.status === 'error' || reason === 'error'
      ? 'error'
      : result.status === 'not-found' || reason === 'unprovisioned'
        ? 'unprovisioned'
        : 'paused'

  const TITLES = {
    error: 'Something went wrong',
    unprovisioned: 'Account not set up',
    paused: 'Access paused',
  } as const

  return (
    <div className="flex min-h-dvh flex-col">
      <BrandBand tagline="Account status" width="max-w-lg" />

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-10 sm:px-8">
        <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
          {TITLES[state]}
        </h1>

        <Callout tone={state === 'error' ? 'danger' : 'warning'} className="mt-5">
          {state === 'error' ? (
            <>
              You are signed in as {email}, but the CRM could not load your profile. This is a
              problem with the application, not with your account — the cause has been written to
              the server logs. Try again shortly, and tell an administrator if it persists.
            </>
          ) : state === 'unprovisioned' ? (
            <>
              You are signed in as {email}, but this account has no Grace Lead Management profile
              yet, so there is nothing it can open. An administrator can create one — or sign out and
              sign up again, which provisions a profile automatically.
            </>
          ) : (
            <>
              Your Grace Lead Management account ({email}) is signed in, but an administrator has
              paused its access. Ask an administrator to reactivate it.
            </>
          )}
        </Callout>

        {/* A POST rather than a link: signing out is a state change. */}
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </main>
    </div>
  )
}
