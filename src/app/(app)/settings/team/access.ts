import { z } from 'zod'
import type { BadgeTone } from '@/components/ui/display'
import { checkboxField } from '@/lib/validation/contact'
import type { UserRole } from '@/types/database'

/**
 * Vocabulary and validation for team administration.
 *
 * Pure and browser-safe, so the client roster imports the same role list and
 * result shape the server action validates against.
 */

/** Ordered most to least capable, which is how the select should read. */
export const ROLES = ['admin', 'staff', 'viewer'] as const satisfies readonly UserRole[]

export const ROLE_TONES: Record<UserRole, BadgeTone> = {
  admin: 'brand',
  staff: 'sky',
  viewer: 'slate',
}

export interface TeamActionState {
  error?: string
  notice?: string
  fieldErrors?: Record<string, string>
}

export const memberAccessSchema = z.object({
  id: z.string().trim().uuid('That team member could not be found'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose a role from the list' }) }),
  can_view_giving: checkboxField(),
  is_active: checkboxField(),
})

export type MemberAccessInput = z.infer<typeof memberAccessSchema>

/**
 * `profiles_ensure_admin_remains` raises a check_violation naming the rule it
 * enforces. Matching the message is what turns a 500 into a sentence the
 * person reading it can act on — there is no error code specific enough to
 * distinguish it from any other check constraint.
 */
const LAST_ADMIN_MARKER = 'last active administrator'

export function isLastAdminRefusal(error: { message?: string | null } | null): boolean {
  return !!error?.message?.toLowerCase().includes(LAST_ADMIN_MARKER)
}
