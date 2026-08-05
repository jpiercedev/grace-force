import Link from 'next/link'
import { AuthCard } from '../auth-card'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <AuthCard
      title="Sign in to Bridge CRM"
      description="Grace Force relationship management."
      footer={
        <p className="text-sm text-slate-600">
          No account yet?{' '}
          <Link href="/signup" className="font-medium text-brand-700 hover:text-brand-800">
            Create one
          </Link>
        </p>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  )
}
