import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { BrandBand } from '@/app/(auth)/auth-card'

const GUIDE_PATH = '/guide/grace-lead-manager-4f7c2a9d'

export const metadata: Metadata = {
  title: 'Quick-start tutorial',
  description:
    'A short, practical introduction to the everyday Grace Lead Manager workflow.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

const STEPS = [
  'Find the person',
  'Capture what happened',
  'Schedule the next step',
] as const

export default function QuickStartGuidePage() {
  return (
    <div className="min-h-dvh bg-slate-50">
      <BrandBand tagline="Quick-start tutorial" width="max-w-5xl" />

      <main id="main-content" className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">
            Getting started
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Learn Grace Lead Manager in under two minutes
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
            This quick walkthrough shows the everyday workflow, from finding a person to recording
            the conversation and making sure the next step is on the calendar.
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-raised">
          <video
            aria-label="Grace Lead Manager quick-start tutorial"
            className="aspect-video w-full bg-slate-950"
            controls
            playsInline
            poster={`${GUIDE_PATH}/tutorial-poster.png`}
            preload="metadata"
          >
            <source
              src={`${GUIDE_PATH}/grace-lead-manager-tutorial.mp4`}
              type="video/mp4"
            />
            Your browser does not support embedded video.{' '}
            <a href={`${GUIDE_PATH}/grace-lead-manager-tutorial.mp4`}>Open the tutorial video</a>.
          </video>
        </div>

        <section aria-label="The Grace Lead Manager workflow" className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">The simple rhythm to remember</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10 flex flex-col gap-4 border-t border-slate-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Ready to begin?</h2>
            <p className="mt-1 text-sm text-slate-600">
              Sign in with your staff email and the temporary password you received.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brand-700"
          >
            Open Grace Lead Manager
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  )
}
