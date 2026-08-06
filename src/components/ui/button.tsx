import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

/**
 * Two honest levels and two quiet ones — see docs/DESIGN.md. Secondary is a
 * tonal fill rather than a white outlined box: outlined secondaries are the
 * single strongest "admin template" tell, and the tonal fill reads calmer
 * while giving a larger perceived target.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 active:bg-slate-300',
  outline: 'bg-brand-50 text-brand-800 hover:bg-brand-100 active:bg-brand-200',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 shadow-sm',
}

/**
 * Sized for the 60+ staff this CRM serves: even `sm` stays at 36px so no
 * everyday action drops below a comfortable touch target, and `lg` reads at
 * 16px for the primary calls to action.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
}

const BASE =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 ' +
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
