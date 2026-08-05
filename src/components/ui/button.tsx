import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm',
  outline: 'bg-transparent text-brand-700 ring-1 ring-inset ring-brand-300 hover:bg-brand-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
}

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap'

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
