import type { ReactNode } from 'react'

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
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-brand-700">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white"
          >
            GF
          </span>
          Grace Force
        </span>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description ? <p className="mt-1.5 text-sm text-slate-600">{description}</p> : null}

      <div className="mt-8">{children}</div>

      {footer ? <div className="mt-6">{footer}</div> : null}
    </main>
  )
}
