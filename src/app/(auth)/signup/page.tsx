import Link from 'next/link'
import { AuthCard } from '../auth-card'
import { SignupForm } from './signup-form'

export const metadata = { title: 'Create account' }

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      description="The first account created becomes the workspace administrator."
      footer={
        <p className="text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthCard>
  )
}
