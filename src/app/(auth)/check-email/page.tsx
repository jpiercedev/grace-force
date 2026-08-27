import Link from 'next/link'
import { AuthCard } from '../auth-card'
import { Callout } from '@/components/ui/display'

export const metadata = { title: 'Confirm your email' }

export default function CheckEmailPage() {
  return (
    <AuthCard title="Check your email" description="One more step before you can sign in.">
      <Callout tone="info">
        We sent a confirmation link to the address you entered. Open it to activate your Grace Lead Manager
        account.
      </Callout>
      <p className="mt-6 text-sm text-slate-600">
        Already confirmed?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:text-brand-800">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
