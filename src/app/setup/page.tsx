import { Callout } from '@/components/ui/display'
import { isSupabaseConfigured } from '@/lib/env'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Setup required' }

/**
 * Shown when Supabase credentials are absent. Failing here with a clear,
 * actionable page beats a stack trace: the most likely visitor is an operator
 * who just cloned the repo.
 */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect('/dashboard')

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Bridge CRM needs configuring
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        The app cannot reach a database yet. Add Supabase credentials and restart.
      </p>

      <Callout tone="warning" className="mt-6" title="Missing environment variables">
        <p>
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> must be set.
        </p>
      </Callout>

      <ol className="mt-6 space-y-3 text-sm text-slate-700">
        <li className="flex gap-3">
          <span className="font-semibold text-brand-700">1.</span>
          <span>
            Create a project at{' '}
            <span className="font-mono text-xs">supabase.com/dashboard</span>.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-semibold text-brand-700">2.</span>
          <span>
            Copy <span className="font-mono text-xs">.env.example</span> to{' '}
            <span className="font-mono text-xs">.env.local</span> and fill in the project URL, anon
            key and service-role key.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-semibold text-brand-700">3.</span>
          <span>
            Apply the migrations in <span className="font-mono text-xs">supabase/migrations</span>{' '}
            (<span className="font-mono text-xs">supabase db push</span>, or paste them into the SQL
            editor in filename order).
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-semibold text-brand-700">4.</span>
          <span>
            Restart the dev server and sign up — the first account becomes the administrator.
          </span>
        </li>
      </ol>

      <p className="mt-8 text-xs text-slate-500">
        Full instructions live in <span className="font-mono">docs/SETUP.md</span>.
      </p>
    </main>
  )
}
