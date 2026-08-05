import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatTile } from '@/components/ui/display'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, requireAdmin } from '@/lib/auth'
import { countActiveAdmins, listTeamRoster } from '@/lib/queries/team'
import { pluralize } from '@/lib/utils'
import { ROLES, ROLE_TONES } from './access'
import { TeamRoster } from './team-roster'

export const metadata = { title: 'Team' }

/**
 * Who has access to the CRM, and what each of them can see.
 *
 * Accounts are created by signing in, not from here — `handle_new_user` writes
 * the profile row — so this screen only ever adjusts access. There is no
 * delete: `profiles` has no DELETE policy, and every contact, gift and
 * timeline entry a person created still points at them.
 */
export default async function TeamPage() {
  const profile = await requireAdmin()
  const [members, activeAdminCount] = await Promise.all([listTeamRoster(), countActiveAdmins()])

  const active = members.filter((member) => member.is_active)
  const givingAccess = active.filter(
    (member) => member.role === 'admin' || member.can_view_giving,
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        description="Who can sign in to the CRM, what each of them may do, and who can see giving."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Active members"
          value={active.length}
          hint={
            members.length === active.length
              ? 'Everyone on the roster can sign in'
              : `${members.length - active.length} deactivated`
          }
        />
        <StatTile
          label="Administrators"
          value={activeAdminCount}
          hint={
            activeAdminCount <= 1
              ? 'The last one cannot be demoted or deactivated'
              : 'Can manage the team and integrations'
          }
          tone={activeAdminCount <= 1 ? 'amber' : 'slate'}
        />
        <StatTile
          label="Can see giving"
          value={givingAccess.length}
          hint="Administrators, plus anyone granted access"
        />
      </div>

      <Card>
        <CardHeader
          title="What each role can do"
          description="Roles are enforced by the database, not just by what the screen offers."
        />
        <CardBody>
          <dl className="space-y-3">
            {ROLES.map((role) => (
              <div key={role} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                <dt className="sm:w-32 sm:shrink-0">
                  <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>
                </dt>
                <dd className="text-sm text-slate-600">{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Team members"
          description={`${pluralize(members.length, 'account')}. New people join by signing in; an administrator sets their access here.`}
        />
        {members.length === 0 ? (
          <EmptyState
            title="Nobody has signed in yet"
            description="The first person to sign up becomes an administrator automatically."
          />
        ) : (
          <TeamRoster
            members={members}
            currentUserId={profile.id}
            activeAdminCount={activeAdminCount}
            nowIso={new Date().toISOString()}
          />
        )}
      </Card>

      <p className="px-1 text-xs text-slate-500">
        Accounts are never deleted. Deactivating removes sign-in while keeping the contacts,
        gifts and timeline entries that point at that person, and it can be undone at any time.
      </p>
    </div>
  )
}
