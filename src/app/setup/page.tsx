import { BrandBand } from '@/app/(auth)/auth-card'
import { Callout } from '@/components/ui/display'
import { isSupabaseConfigured } from '@/lib/env'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Setup required' }

/*
 * 13px mono sits optically level with the surrounding 14px prose; text-xs
 * made filenames the hardest text to read in the instructions.
 */
const CODE = 'font-mono text-[0.8125rem]'

const STEPS = [
  <>
    Create a project at <code className={CODE}>supabase.com/dashboard</code>.
  </>,
  <>
    Copy <code className={CODE}>.env.example</code> to <code className={CODE}>.env.local</code> and
    fill in the project URL, anon key and service-role key.
  </>,
  <>
    Apply the migrations in <code className={CODE}>supabase/migrations</code> (
    <code className={CODE}>supabase db push</code>, or paste them into the SQL editor in filename
    order).
  </>,
  <>Restart the dev server and sign up — the first account becomes the administrator.</>,
]

/**
 * Shown when Supabase credentials are absent. Failing here with a clear,
 * actionable page beats a stack trace: the most likely visitor is an operator
 * who just cloned the repo.
 */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect('/dashboard')

  return (
    <div className="flex min-h-dvh flex-col">
      <BrandBand tagline="First-run setup" width="max-w-2xl" />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Almost there
        </p>
        <h1 className="mt-1.5 font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
          Grace Force CRM needs configuring
        </h1>
        <p className="mt-2 text-[15px] text-slate-600">
          The app cannot reach a database yet. Add Supabase credentials and restart.
        </p>

        <Callout tone="warning" className="mt-6" title="Missing environment variables">
          <p>
            <code className={CODE}>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className={CODE}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> must be set.
          </p>
        </Callout>

        <ol className="mt-7 space-y-4 text-sm leading-relaxed text-slate-700">
          {STEPS.map((step, index) => (
            <li key={index} className="flex gap-3.5">
              <span
                aria-hidden="true"
                className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-[13px] font-semibold text-brand-800"
              >
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-8 border-t border-slate-200 pt-5 text-sm text-slate-600">
          Full instructions live in <code className={CODE}>docs/SETUP.md</code>.
        </p>
      </main>
    </div>
  )
}
