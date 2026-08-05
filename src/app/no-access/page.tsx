import { signOut } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { getCurrentProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Access paused' }

/**
 * A deactivated account gets an explanation rather than being bounced to the
 * login screen, which would read as a forgotten password.
 */
export default async function NoAccessPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.is_active) redirect('/dashboard')

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Access paused</h1>
      <Callout tone="warning" className="mt-4">
        Your Bridge CRM account ({profile.email}) is signed in, but an administrator has paused its
        access. Ask a Grace Force administrator to reactivate it.
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
