import { signOut } from '@/app/(auth)/actions'
import { AppShell } from '@/components/layout/app-shell'
import { visibleNavigation } from '@/components/layout/nav'
import { requireProfile } from '@/lib/auth'

/**
 * Guard for every authenticated route. `requireProfile` redirects an anonymous
 * visitor to /login and a deactivated one to /no-access, so pages beneath this
 * layout can assume an active profile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()

  async function handleSignOut() {
    'use server'
    await signOut()
  }

  return (
    <AppShell
      profile={profile}
      navigation={visibleNavigation(profile)}
      signOutAction={handleSignOut}
    >
      {children}
    </AppShell>
  )
}
