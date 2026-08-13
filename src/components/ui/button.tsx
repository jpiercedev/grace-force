import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

/**
 * A restrained hierarchy — see docs/DESIGN.md. One solid brand button per
 * screen; secondaries are quiet white outlined buttons (the familiar CRM
 * pattern), and everything below that is a ghost or a plain text link.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 border border-transparent shadow-card',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 shadow-card',
  outline:
    'border border-brand-300 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50 active:bg-brand-100 shadow-card',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 border border-transparent shadow-card',
}

/**
 * `md` (36px) is the everyday size; `lg` (40px) is for a screen's one primary
 * call to action; `sm` (32px) is only for actions inline with dense content —
 * tables, list rows, panel headers — where a 36px button would swallow the row.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
}

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 ' +
  // 60% rather than 50%: pending submit buttons keep their label readable
  // ("Signing in…" on a half-faded brand fill was close to invisible).
  'disabled:pointer-events-none disabled:opacity-60 whitespace-nowrap'

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className)
}

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  variant?: Variant
  size?: Size
  className?: string
  children?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button {...props} className={buttonClasses(variant, size, className)} />
}

export interface LinkButtonProps extends Omit<ComponentProps<typeof Link>, 'className'> {
  variant?: Variant
  size?: Size
  className?: string
}

export function LinkButton({ variant = 'primary', size = 'md', className, ...props }: LinkButtonProps) {
  return <Link {...props} className={buttonClasses(variant, size, className)} />
}
