import type { ProfileRow, UserRole } from '@/types/database'

/**
 * Pure capability predicates, safe to import from client components.
 *
 * These decide what the interface *offers*. Row Level Security decides what
 * the database *permits* — a mistake here hides a button, it does not leak a
 * row. Server-side guards live in `@/lib/auth`, which re-exports these.
 */

export function isAdmin(profile: Pick<ProfileRow, 'role' | 'is_active'> | null): boolean {
  return !!profile && profile.is_active && profile.role === 'admin'
}

export function canWrite(profile: Pick<ProfileRow, 'role' | 'is_active'> | null): boolean {
  return !!profile && profile.is_active && (profile.role === 'admin' || profile.role === 'staff')
}

export function canViewGiving(
  profile: Pick<ProfileRow, 'role' | 'is_active' | 'can_view_giving'> | null,
): boolean {
  return !!profile && profile.is_active && (profile.role === 'admin' || profile.can_view_giving)
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  staff: 'Staff',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full access, including team management, giving records and integrations.',
  staff: 'Can create and edit contacts, engagements, follow-ups and pipelines.',
  viewer: 'Read-only access to contacts and activity. Cannot see leads or giving.',
}
