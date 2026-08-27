import { AuthCard } from '../auth-card'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

/**
 * Sign-in offers no route to account creation: this is an internal tool, and
 * accounts are provisioned by an administrator rather than self-served. The
 * `/signup` route stays reachable directly so the first account — which
 * becomes the workspace administrator — can still be bootstrapped.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <AuthCard title="Sign in" description="Use your Grace Lead Manager staff account.">
      <LoginForm next={next} />
    </AuthCard>
  )
}
