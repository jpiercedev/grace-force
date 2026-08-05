import type { ReactNode } from 'react'
import { LinkButton } from '@/components/ui/button'
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
} from '@/components/ui/display'
import { isAdmin, requireProfile } from '@/lib/auth'
import { MAILCHIMP_JOB_LABELS, parseMailchimpJob } from '@/lib/mailchimp/jobs'
import {
  getMailchimpOverview,
  type AudienceSummary,
  type CampaignSummary,
  type SyncRunSummary,
} from '@/lib/mailchimp/queries'
import { mailchimpUnavailableReason } from '@/lib/mailchimp/run'
import {
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
  durationLabel,
  formatRate,
  statWarnings,
  summariseStats,
} from '@/lib/mailchimp/ui'
import { formatDateTime, formatRelative, pluralize } from '@/lib/utils'
import { syncMailchimpNow } from './actions'
import { SyncPanel } from './sync-panel'

export const metadata = { title: 'Email' }

/**
 * The Mailchimp overview.
 *
 * Read-only by design: the mirror tables are written by the sync jobs alone,
 * and the only thing a person changes from here is a subscriber's contact
 * link, which lives on the unmatched queue.
 */
export default async function MailchimpPage() {
  const profile = await requireProfile()
  const admin = isAdmin(profile)
  const unavailable = mailchimpUnavailableReason()
  const overview = await getMailchimpOverview()

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="Email"
        description="What Mailchimp knows about the people you write to, mirrored into the CRM."
        action={
          overview.totals.unmatched > 0 ? (
            <LinkButton href="/mailchimp/unmatched" variant="secondary">
              Review {pluralize(overview.totals.unmatched, 'unmatched subscriber')}
            </LinkButton>
          ) : null
        }
      />

      {unavailable ? <SetupExplainer reason={unavailable} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Audiences"
          value={overview.totals.audiences}
          hint={
            overview.lastSyncedAt
              ? `Last synced ${formatRelative(overview.lastSyncedAt)}`
              : 'Not synced yet'
          }
        />
        <StatTile
          label="Subscribers"
          value={overview.totals.subscribers.toLocaleString()}
          hint="Mirrored locally across every audience"
        />
        <StatTile
          label="Unmatched"
          value={overview.totals.unmatched.toLocaleString()}
          hint={
            overview.totals.unmatched === 0
              ? 'Everyone is linked to a contact'
              : 'Not yet linked to a contact'
          }
          tone={overview.totals.unmatched > 0 ? 'amber' : 'emerald'}
          href={overview.totals.unmatched > 0 ? '/mailchimp/unmatched' : undefined}
        />
        <StatTile
          label="Campaigns"
          value={overview.totals.campaigns.toLocaleString()}
          hint="Sent campaigns with performance recorded"
        />
      </div>

      {admin && !unavailable ? (
        <SyncPanel action={syncMailchimpNow} lastSyncedAt={overview.lastSyncedAt} />
      ) : null}

      <Audiences audiences={overview.audiences} configured={!unavailable} />
      <Campaigns campaigns={overview.campaigns} />
      <SyncRuns runs={overview.runs} admin={admin} />
    </div>
  )
}

function SetupExplainer({ reason }: { reason: string }) {
  return (
    <Callout tone="warning" title="Mailchimp is not connected">
      <p>{reason}</p>
      <p className="mt-2">Set these in the deployment&rsquo;s environment, then redeploy:</p>
      <ul className="mt-1.5 space-y-1">
        <EnvVar name="MAILCHIMP_API_KEY" note="From Account → Extras → API keys." />
        <EnvVar
          name="MAILCHIMP_SERVER_PREFIX"
          note="Optional. Derived from the key's suffix, e.g. us21."
        />
        <EnvVar
          name="MAILCHIMP_AUDIENCE_ID"
          note="Optional. Leave blank to sync every audience the key can see."
        />
        <EnvVar
          name="MAILCHIMP_AUTO_CREATE_CONTACTS"
          note="Optional, defaults to true. Set false to review every new subscriber by hand."
        />
        <EnvVar
          name="SUPABASE_SERVICE_ROLE_KEY"
          note="Required. The sync writes rows nobody is signed in for."
        />
        <EnvVar
          name="CRON_SECRET"
          note="Required in production for the hourly POST /api/cron/mailchimp job."
        />
      </ul>
    </Callout>
  )
}

function EnvVar({ name, note }: { name: string; note: string }) {
  return (
    <li>
      <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">{name}</code>{' '}
      <span className="text-xs">{note}</span>
    </li>
  )
}

function Audiences({
  audiences,
  configured,
}: {
  audiences: AudienceSummary[]
  configured: boolean
}) {
  return (
    <Card>
      <CardHeader
        title="Audiences"
        description="Member counts as Mailchimp reports them, beside what is mirrored here."
      />
      {audiences.length === 0 ? (
        <EmptyState
          title="No audiences yet"
          description={
            configured
              ? 'Run the audiences sync to mirror the lists this API key can see.'
              : 'Once Mailchimp is connected, every list the key can see appears here.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Mailchimp audiences and their sync state</caption>
            <thead className="bg-slate-50">
              <tr>
                <Th>Audience</Th>
                <Th align="right">Members</Th>
                <Th align="right">Mirrored</Th>
                <Th align="right">Unmatched</Th>
                <Th align="right">Unsubscribed</Th>
                <Th>Last synced</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audiences.map((audience) => (
                <tr key={audience.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">{audience.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-slate-500">
                      {audience.mailchimp_list_id}
                    </span>
                  </td>
                  <Td align="right">{audience.member_count.toLocaleString()}</Td>
                  <Td align="right">{audience.stored.toLocaleString()}</Td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                    {audience.unmatched === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <Badge tone="amber">{audience.unmatched.toLocaleString()}</Badge>
                    )}
                  </td>
                  <Td align="right">{audience.unsubscribe_count.toLocaleString()}</Td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                    {audience.last_synced_at ? (
                      <time
                        dateTime={audience.last_synced_at}
                        title={formatDateTime(audience.last_synced_at)}
                      >
                        {formatRelative(audience.last_synced_at)}
                      </time>
                    ) : (
                      <span className="text-slate-400">Never</span>
                    )}
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

function Campaigns({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <Card>
      <CardHeader
        title="Recent campaigns"
        description="Sends, opens and clicks as reported by Mailchimp."
      />
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Sent campaigns appear here once the campaigns sync has run."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Recently sent Mailchimp campaigns</caption>
            <thead className="bg-slate-50">
              <tr>
                <Th>Campaign</Th>
                <Th>Sent</Th>
                <Th align="right">Recipients</Th>
                <Th align="right">Opens</Th>
                <Th align="right">Clicks</Th>
                <Th align="right">Bounces</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">
                      {campaign.subject_line?.trim() || campaign.title?.trim() || 'Untitled campaign'}
                    </span>
                    {campaign.archive_url ? (
                      <a
                        href={campaign.archive_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block text-xs text-brand-700 underline-offset-2 hover:underline"
                      >
                        View the sent email
                      </a>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                    {campaign.send_time ? (
                      <time dateTime={campaign.send_time}>{formatDateTime(campaign.send_time)}</time>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <Td align="right">{campaign.emails_sent.toLocaleString()}</Td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {campaign.unique_opens.toLocaleString()}
                    <span className="ml-1.5 text-xs text-slate-500">
                      {formatRate(campaign.open_rate)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {campaign.subscriber_clicks.toLocaleString()}
                    <span className="ml-1.5 text-xs text-slate-500">
                      {formatRate(campaign.click_rate)}
                    </span>
                  </td>
                  <Td align="right">{campaign.bounces.toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function SyncRuns({ runs, admin }: { runs: SyncRunSummary[]; admin: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Sync history"
        description="Every run is recorded, whether it was scheduled or started by hand."
      />
      {runs.length === 0 ? (
        <EmptyState
          title="Nothing has run yet"
          description={
            admin
              ? 'Start a sync above, or wait for the hourly scheduled job.'
              : 'An administrator can start a sync, and the hourly job runs on its own.'
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {runs.map((run) => {
            const warnings = statWarnings(run.stats)
            const summary = summariseStats(run.stats)
            return (
              <li key={run.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{jobLabel(run.job)}</span>
                    <Badge tone={SYNC_STATUS_TONES[run.status]}>
                      {SYNC_STATUS_LABELS[run.status]}
                    </Badge>
                  </span>
                  <span className="text-xs text-slate-500">
                    <time dateTime={run.started_at} title={formatDateTime(run.started_at)}>
                      {formatRelative(run.started_at)}
                    </time>
                    {' · '}
                    {durationLabel(run.started_at, run.finished_at)}
                  </span>
                </div>

                {summary ? <p className="mt-1 text-xs text-slate-600">{summary}</p> : null}

                {run.error ? (
                  <p className="mt-1.5 text-xs font-medium text-red-700">{run.error}</p>
                ) : null}

                {warnings.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {warnings.map((warning, index) => (
                      <li key={index} className="text-xs text-amber-800">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** A stored run could name a job this build no longer knows; show it verbatim. */
function jobLabel(job: string): string {
  const parsed = parseMailchimpJob(job)
  return parsed && parsed !== 'all' ? MAILCHIMP_JOB_LABELS[parsed] : job
}

function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, align }: { children: ReactNode; align?: 'right' }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </td>
  )
}
