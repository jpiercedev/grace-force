'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

const CONTROL =
  'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ' +
  'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 ' +
  'focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500'

const CONTROL_INVALID = 'ring-red-400 focus:ring-red-500'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label {...props} className={cn('block text-sm font-medium text-slate-700', className)} />
  )
}

export interface FieldProps {
  label: string
  /** Rendered below the control, and announced via aria-describedby. */
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

/**
 * Wires a label, hint and error message to a control with the right ARIA
 * relationships. Taking a render prop keeps the id/aria plumbing in one place
 * instead of being re-derived (and forgotten) at every call site.
 */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Input({
  className,
  invalid,
  ...props
}: ComponentProps<'input'> & { invalid?: boolean }) {
  return <input {...props} className={cn(CONTROL, invalid && CONTROL_INVALID, className)} />
}

export function Textarea({
  className,
  invalid,
  ...props
}: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <textarea {...props} className={cn(CONTROL, 'min-h-[80px]', invalid && CONTROL_INVALID, className)} />
  )
}

export function Select({
  className,
  invalid,
  ...props
}: ComponentProps<'select'> & { invalid?: boolean }) {
  return (
    <select {...props} className={cn(CONTROL, 'pr-8', invalid && CONTROL_INVALID, className)} />
  )
}

export function Checkbox({
  className,
  label,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className="flex items-start gap-2.5">
      <input
        {...props}
        id={id}
        type="checkbox"
        aria-describedby={hintId}
        className={cn(
          'mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500',
          className,
        )}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-xs text-slate-500">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Groups related fields with a heading that screen readers announce. */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('space-y-4', className)}>
      <legend className="text-sm font-semibold text-slate-900">{legend}</legend>
      {description ? <p className="-mt-2 text-xs text-slate-500">{description}</p> : null}
      {children}
    </fieldset>
  )
}
