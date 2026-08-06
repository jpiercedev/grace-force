import { signOut } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { getCurrentProfile, getSessionUser } from '@/lib/auth'
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
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getCurrentProfile()
  if (profile?.is_active) redirect('/dashboard')

  const { reason } = await searchParams
  const unprovisioned = !profile || reason === 'unprovisioned'
  const email = profile?.email ?? user.email ?? 'your account'

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {unprovisioned ? 'Account not set up' : 'Access paused'}
      </h1>

      <Callout tone="warning" className="mt-4">
        {unprovisioned ? (
          <>
            You are signed in as {email}, but this account has no Grace Force CRM profile yet, so
            there is nothing it can open. An administrator can create one — or sign out and sign up
            again, which provisions a profile automatically.
          </>
        ) : (
          <>
            Your Grace Force CRM account ({email}) is signed in, but an administrator has paused its
            access. Ask a Grace Force administrator to reactivate it.
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
  )
}
