import type { ReactNode } from 'react'
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  type BadgeTone,
} from '@/components/ui/display'
import { requireAdmin } from '@/lib/auth'
import { integrationStatus } from '@/lib/env'
import { SYNC_STATUS_LABELS, SYNC_STATUS_TONES, durationLabel, summariseStats } from '@/lib/mailchimp/ui'
import {
  countNotificationsByStatus,
  listNotifications,
  listSyncRuns,
  type NotificationListItem,
  type SyncRunListItem,
} from '@/lib/queries/team'
import { formatDateTime, formatRelative, pluralize, truncate } from '@/lib/utils'
import type { NotificationStatus } from '@/types/database'

export const metadata = { title: 'Integrations' }

/**
 * What is wired up, and what stops working when it is not.
 *
 * Only presence is ever shown. Reading a key's value into the page would put a
 * credential in the HTML sent to the browser, so `integrationStatus()` returns
 * booleans and nothing here ever touches the values behind them.
 */

interface EnvVar {
  name: string
  requirement: 'required' | 'optional'
  note: string
}

interface IntegrationView {
  name: string
  configured: boolean
  purpose: string
  /** What is lost while it is unconfigured. */
  degraded: string
  vars: EnvVar[]
  extra?: ReactNode
}

const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
}

// Amber for pending rather than the old sky blue: blue is gone from the
// palette, and "claimed but not yet sent" is exactly the watch-this tone.
const NOTIFICATION_STATUS_TONES: Record<NotificationStatus, BadgeTone> = {
  pending: 'amber',
  sent: 'emerald',
  failed: 'red',
  skipped: 'zinc',
}

// The database stores machine slugs; the people reading these tables do not.
// Unknown values fall back to sentence case rather than leaking snake_case.
const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  lead_submitted: 'New lead',
  follow_up_due: 'Follow-up due',
}

const INTEGRATION_LABELS: Record<string, string> = {
  resend: 'Resend',
  mailchimp: 'Mailchimp',
}

const SYNC_JOB_LABELS: Record<string, string> = {
  full_sync: 'Full sync',
  follow_up_reminders: 'Follow-up reminders',
}

function humanizeSlug(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

export default async function IntegrationsPage() {
  await requireAdmin()

  const status = integrationStatus()
  const [runs, notifications, notificationCounts] = await Promise.all([
    listSyncRuns(),
    listNotifications(),
    countNotificationsByStatus(),
  ])

  const integrations: IntegrationView[] = [
    {
      name: 'Supabase service role',
      configured: status.serviceRole,
      purpose:
        'Lets the three jobs that run without a signed-in person write to the database: public lead intake, integration sync, and the notification outbox.',
      degraded:
        'The public lead form returns an error, Mailchimp sync cannot run, and no notification is ever recorded or sent.',
      vars: [
        {
          name: 'SUPABASE_SERVICE_ROLE_KEY',
          requirement: 'required',
          note: 'Project Settings → API. Bypasses Row Level Security, so it is server-only and must never carry a NEXT_PUBLIC_ prefix.',
        },
      ],
    },
    {
      name: 'Mailchimp',
      configured: status.mailchimp,
      purpose:
        'Mirrors audiences, subscribers and campaign performance into the CRM, links subscribers to contacts, and keeps newsletter engagements current.',
      degraded:
        'The Email screen renders an unconfigured state, sync endpoints answer 503, and nothing about email reaches a contact timeline.',
      vars: [
        {
          name: 'MAILCHIMP_API_KEY',
          requirement: 'required',
          note: 'Account → Extras → API keys.',
        },
        {
          name: 'MAILCHIMP_SERVER_PREFIX',
          requirement: 'optional',
          note: "Derived from the key's suffix, e.g. us21. Set it only when the two disagree.",
        },
        {
          name: 'MAILCHIMP_AUDIENCE_ID',
          requirement: 'optional',
          note: 'Restricts sync to one audience. Blank syncs every audience the key can see.',
        },
        {
          name: 'MAILCHIMP_AUTO_CREATE_CONTACTS',
          requirement: 'optional',
          note: 'Defaults to true. Set false to review unmatched subscribers by hand instead.',
        },
        {
          name: 'CRON_SECRET',
          requirement: 'optional',
          note: 'Required in production for the scheduled sync to authenticate itself.',
        },
      ],
    },
    {
      name: 'Resend',
      configured: status.resend,
      purpose:
        'Sends the internal emails the CRM raises — a new lead arriving, a follow-up falling due.',
      degraded:
        'Every notification is still recorded, with status “skipped”, so nothing is lost; it simply never leaves the building.',
      vars: [
        {
          name: 'RESEND_API_KEY',
          requirement: 'required',
          note: 'From resend.com/api-keys.',
        },
        {
          name: 'RESEND_FROM_EMAIL',
          requirement: 'required',
          note: 'A verified sending identity, e.g. "Grace Lead Manager <crm@yourdomain.org>". Setting the key without this is an error, not a silent fallback.',
        },
        {
          name: 'NOTIFY_INTERNAL_EMAILS',
          requirement: 'required',
          note: 'Comma-separated recipients. With none set, notifications are skipped even when the key is valid.',
        },
      ],
      // While Resend is entirely unconfigured the "Until this is set" paragraph
      // already says notifications are skipped; repeating it as a warning here
      // would dilute the one state signal the card should give.
      extra:
        status.notificationRecipients > 0 ? (
          <p className="text-xs text-slate-500">
            {pluralize(status.notificationRecipients, 'internal recipient')} configured.
          </p>
        ) : status.resend ? (
          <Callout tone="warning">
            No internal recipients are configured, so notifications are recorded and skipped rather
            than sent.
          </Callout>
        ) : null,
    },
  ]

  const unconfigured = integrations.filter((integration) => !integration.configured)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="What this deployment is connected to, what each connection is for, and what is happening on it."
      />

      {unconfigured.length > 0 ? (
        <Callout tone="warning" title="Some integrations are not connected">
          <p>
            {unconfigured.map((integration) => integration.name).join(', ')} —{' '}
            {unconfigured.length === 1 ? 'it is' : 'they are'} optional, and the app runs without{' '}
            {unconfigured.length === 1 ? 'it' : 'them'}. Each card below lists what to set and what
            is missing until you do.
          </p>
        </Callout>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Sent"
          value={notificationCounts.sent.toLocaleString()}
          hint="Notifications delivered by the provider"
        />
        <StatTile
          label="Pending"
          value={notificationCounts.pending.toLocaleString()}
          hint="Claimed but not yet sent"
          tone={notificationCounts.pending > 0 ? 'amber' : 'slate'}
        />
        <StatTile
          label="Failed"
          value={notificationCounts.failed.toLocaleString()}
          hint="Rejected by the provider"
          tone={notificationCounts.failed > 0 ? 'red' : 'slate'}
        />
        <StatTile
          label="Skipped"
          value={notificationCounts.skipped.toLocaleString()}
          hint="Recorded with nowhere to send"
        />
      </div>

      <div className="space-y-3">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.name} integration={integration} />
        ))}
      </div>

      <Callout tone="info" title="Changing a variable">
        <p>
          Server-side variables take effect on the next request after a restart. Anything named{' '}
          <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-xs ring-1 ring-inset ring-slate-200">
            NEXT_PUBLIC_*
          </code>{' '}
          is compiled into the bundle, including the middleware, so changing one needs a rebuild
          rather than a restart.
        </p>
      </Callout>

      <SyncRuns runs={runs} />
      <Notifications notifications={notifications} />

      <Card>
        <CardHeader title="Further reading" description="Both live in the repository." />
        <CardBody>
          <dl className="space-y-2 text-sm">
            <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row">
              <dt className="font-mono text-xs text-slate-700 sm:w-44 sm:shrink-0 sm:pt-0.5">
                docs/SETUP.md
              </dt>
              <dd className="text-slate-600">
                Creating the Supabase project, applying migrations, and the first sign-in.
              </dd>
            </div>
            <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row">
              <dt className="font-mono text-xs text-slate-700 sm:w-44 sm:shrink-0 sm:pt-0.5">
                docs/INTEGRATIONS.md
              </dt>
              <dd className="text-slate-600">
                Mailchimp, Resend, lead intake and the scheduled jobs in detail.
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  )
}

function IntegrationCard({ integration }: { integration: IntegrationView }) {
  return (
    <Card>
      {/* Not CardHeader: with a long description its flex-wrap pushes the
          action under the text, and the status chip must always hold the top
          right corner — it is the one signal this header exists to give. */}
      <div className="border-b border-slate-200/70 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            {integration.name}
          </h2>
          <Badge tone={integration.configured ? 'emerald' : 'amber'}>
            {integration.configured ? 'Configured' : 'Not configured'}
          </Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{integration.purpose}</p>
      </div>
      <CardBody className="space-y-4">
        {integration.configured ? null : (
          <p className="text-sm leading-relaxed text-slate-700">
            <span className="font-semibold text-slate-900">Until this is set: </span>
            {integration.degraded}
          </p>
        )}

        {/* The wiring reference reads as a quiet aside — present when needed,
            never competing with the card's one status signal. */}
        <div className="rounded-lg bg-slate-100/70 px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Environment variables
          </h3>
          <ul className="mt-1 divide-y divide-slate-200/70">
            {integration.vars.map((variable) => (
              <li key={variable.name} className="py-2.5 first:pt-1.5 last:pb-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-800 ring-1 ring-inset ring-slate-200">
                    {variable.name}
                  </code>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {variable.requirement}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{variable.note}</p>
              </li>
            ))}
          </ul>
        </div>

        {integration.extra}
      </CardBody>
    </Card>
  )
}

function SyncRuns({ runs }: { runs: SyncRunListItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Recent sync runs"
        description="Every integration run, scheduled or started by hand."
      />
      {runs.length === 0 ? (
        <EmptyState
          title="Nothing has run yet"
          description="Sync runs are recorded here as soon as an integration is connected and runs for the first time."
        />
      ) : (
        // tabIndex: a horizontally scrollable region must be reachable by
        // keyboard, or its off-screen columns are mouse-only.
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent sync runs table">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Recent integration sync runs</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Integration</Th>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th>Started</Th>
                <Th>Duration</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.id} className={ROW}>
                  <Td className="font-medium text-slate-900">
                    {INTEGRATION_LABELS[run.integration] ?? humanizeSlug(run.integration)}
                  </Td>
                  <Td>{SYNC_JOB_LABELS[run.job] ?? humanizeSlug(run.job)}</Td>
                  <Td>
                    <Badge tone={SYNC_STATUS_TONES[run.status]}>
                      {SYNC_STATUS_LABELS[run.status]}
                    </Badge>
                  </Td>
                  <Td className="text-slate-600">
                    <time dateTime={run.started_at} title={formatDateTime(run.started_at)}>
                      {formatRelative(run.started_at)}
                    </time>
                  </Td>
                  <Td className="tabular-nums text-slate-600">
                    {durationLabel(run.started_at, run.finished_at)}
                  </Td>
                  <td className="px-4 py-3 text-slate-600 first:pl-5 last:pr-5">
                    {/* The min width keeps narrow screens from crushing the one
                        wrappable column into skyscraper rows — the table widens
                        into its scroll container instead. */}
                    <span className="block min-w-[18rem] max-w-md text-xs leading-relaxed">
                      {summariseStats(run.stats) || '—'}
                    </span>
                    {run.error ? (
                      <span className="mt-1 block min-w-[18rem] max-w-md text-xs font-medium leading-relaxed text-red-700">
                        {truncate(run.error, 200)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Notifications({ notifications }: { notifications: NotificationListItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Notification outbox"
        description="Internal emails the CRM raised. Visible to administrators only, which is what the database allows."
      />
      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing has been raised yet"
          description="A new lead or a follow-up falling due is what puts an entry here."
        />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Notification outbox table">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Recent internal notifications</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Kind</Th>
                <Th>Subject</Th>
                <Th>Status</Th>
                <Th align="right">Recipients</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notifications.map((notification) => (
                <tr key={notification.id} className={ROW}>
                  <Td className="font-medium text-slate-900">
                    {NOTIFICATION_KIND_LABELS[notification.kind] ?? humanizeSlug(notification.kind)}
                  </Td>
                  <td className="px-4 py-3 text-slate-700 first:pl-5 last:pr-5">
                    {/* Same floor as the sync-runs table: without it, the only
                        wrappable column collapses to one word per line at 390px. */}
                    <span className="block min-w-[16rem] max-w-md">
                      {truncate(notification.subject, 120)}
                    </span>
                    {notification.error ? (
                      <span className="mt-1 block min-w-[16rem] max-w-md text-xs font-medium leading-relaxed text-red-700">
                        {truncate(notification.error, 200)}
                        {notification.attempts > 1
                          ? ` (${notification.attempts} attempts)`
                          : null}
                      </span>
                    ) : null}
                  </td>
                  <Td>
                    <Badge tone={NOTIFICATION_STATUS_TONES[notification.status]}>
                      {NOTIFICATION_STATUS_LABELS[notification.status]}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums text-slate-700">
                    {notification.recipients.length}
                  </Td>
                  <Td className="text-slate-600">
                    <time
                      dateTime={notification.created_at}
                      title={formatDateTime(notification.created_at)}
                    >
                      {formatRelative(notification.created_at)}
                    </time>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* The system table language: caps hairline header, warm hover, generous cells. */
const ROW = 'align-top transition-colors hover:bg-slate-100/60'

function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 first:pl-5 last:pr-5 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-slate-700 first:pl-5 last:pr-5 ${className ?? ''}`}>
      {children}
    </td>
  )
}
