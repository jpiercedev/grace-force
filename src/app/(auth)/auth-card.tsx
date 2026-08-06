import type { ReactNode } from 'react'

/**
 * The GF mark + wordmark, shared by every screen that renders outside the app
 * shell (auth, setup, no-access, intake) so a stranded visitor always sees
 * the same brand reassurance.
 */
export function BrandMark() {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-brand-700">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white"
      >
        GF
      </span>
      Grace Force
    </span>
  )
}

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <BrandMark />
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description ? <p className="mt-1.5 text-sm text-slate-600">{description}</p> : null}

      {/*
        Same white surface the intake card uses, so the two public faces
        match. Flat below sm: on a phone the border would only crowd the form.
      */}
      <div className="mt-8 sm:rounded-lg sm:border sm:border-slate-200 sm:bg-white sm:p-6 sm:shadow-sm">
        {children}
      </div>

      {footer ? <div className="mt-6">{footer}</div> : null}
    </main>
  )
}
