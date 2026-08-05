import {
  Ban,
  CheckCircle2,
  CheckSquare,
  HandCoins,
  HandHeart,
  Handshake,
  Inbox,
  KanbanSquare,
  Mail,
  MailOpen,
  MailX,
  MapPin,
  MessageSquare,
  MousePointerClick,
  Phone,
  Pin,
  Send,
  Settings,
  StickyNote,
  Upload,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  ACTIVITY_DIRECTION_LABELS,
  ACTIVITY_TYPE_LABELS,
} from '@/components/domain/contact-badges'
import { EmptyState } from '@/components/ui/display'
import type { TimelineActivity, TimelineDay } from '@/lib/queries/contacts'
import { formatDate, formatDateTime, formatRelative } from '@/lib/utils'
import type { ActivitySource, ActivityType } from '@/types/database'

/**
 * The unified timeline: everything that happened to a relationship, newest
 * first, grouped by the day it happened on.
 *
 * A server component — nothing here is interactive, and rendering it on the
 * server keeps two dozen icon components out of the browser bundle.
 */

interface TimelineStyle {
  icon: LucideIcon
  className: string
}

/**
 * Icons are mapped explicitly rather than derived, so the type checker forces a
 * decision when a new activity type is added to the enum instead of silently
 * falling back to a generic dot.
 */
const TIMELINE_STYLES: Record<ActivityType, TimelineStyle> = {
  note: { icon: StickyNote, className: 'bg-slate-100 text-slate-600' },
  call: { icon: Phone, className: 'bg-sky-50 text-sky-700' },
  email: { icon: Mail, className: 'bg-indigo-50 text-indigo-700' },
  meeting: { icon: Users, className: 'bg-violet-50 text-violet-700' },
  text_message: { icon: MessageSquare, className: 'bg-sky-50 text-sky-700' },
  visit: { icon: MapPin, className: 'bg-emerald-50 text-emerald-700' },
  prayer_request: { icon: HandHeart, className: 'bg-brand-50 text-brand-700' },
  follow_up_created: { icon: CheckSquare, className: 'bg-amber-50 text-amber-700' },
  follow_up_completed: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700' },
  engagement_started: { icon: Handshake, className: 'bg-emerald-50 text-emerald-700' },
  engagement_changed: { icon: Handshake, className: 'bg-slate-100 text-slate-600' },
  pipeline_stage_changed: { icon: KanbanSquare, className: 'bg-violet-50 text-violet-700' },
  pipeline_card_created: { icon: KanbanSquare, className: 'bg-violet-50 text-violet-700' },
  pipeline_card_closed: { icon: CheckCircle2, className: 'bg-slate-100 text-slate-600' },
  gift_recorded: { icon: HandCoins, className: 'bg-emerald-50 text-emerald-700' },
  assignment_changed: { icon: UserCog, className: 'bg-slate-100 text-slate-600' },
  lead_submitted: { icon: Inbox, className: 'bg-amber-50 text-amber-700' },
  lead_converted: { icon: UserPlus, className: 'bg-emerald-50 text-emerald-700' },
  mailchimp_subscribed: { icon: Mail, className: 'bg-indigo-50 text-indigo-700' },
  mailchimp_unsubscribed: { icon: MailX, className: 'bg-rose-50 text-rose-700' },
  mailchimp_campaign_sent: { icon: Send, className: 'bg-indigo-50 text-indigo-700' },
  mailchimp_campaign_opened: { icon: MailOpen, className: 'bg-indigo-50 text-indigo-700' },
  mailchimp_campaign_clicked: { icon: MousePointerClick, className: 'bg-indigo-50 text-indigo-700' },
  mailchimp_bounced: { icon: Ban, className: 'bg-rose-50 text-rose-700' },
  import: { icon: Upload, className: 'bg-slate-100 text-slate-600' },
  system: { icon: Settings, className: 'bg-slate-100 text-slate-600' },
}

/** Manual entries need no provenance line; everything else says where it came from. */
const SOURCE_LABELS: Record<ActivitySource, string | null> = {
  manual: null,
  system: 'Automatic',
  mailchimp: 'Mailchimp',
  import: 'Import',
  lead_form: 'Lead form',
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Calendar-relative headings, because "Today" is easier to place than a date. */
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Undated'
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return formatDate(date)
}

/** Who did it: a staff profile if we have one, otherwise the machine that did. */
function actorName(activity: TimelineActivity): string {
  return activity.actor?.name ?? activity.actor_label?.trim() ?? 'Grace Force CRM'
}

export function Timeline({
  days,
  /** The instant the page was rendered, so every heading and relative label agrees. */
  nowIso,
  filtered,
}: {
  days: TimelineDay[]
  nowIso: string
  filtered: boolean
}) {
  if (days.length === 0) {
    return filtered ? (
      <EmptyState
        title="No activity of that kind"
        description="Nothing on this contact matches the filter. Choose a different type to widen it."
      />
    ) : (
      <EmptyState
        title="Nothing has happened yet"
        description="Log a call, a note or a visit and it will show up here, alongside gifts, follow-ups and email activity."
      />
    )
  }

  const now = new Date(nowIso)

  return (
    <ol className="divide-y divide-slate-100">
      {days.map((day) => (
        <li key={day.key} className="px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            <time dateTime={day.date}>{dayLabel(day.date, now)}</time>
          </h3>
          <ol className="mt-3 space-y-4">
            {day.activities.map((activity) => (
              <TimelineEntry key={activity.id} activity={activity} now={now} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

function TimelineEntry({ activity, now }: { activity: TimelineActivity; now: Date }) {
  const style = TIMELINE_STYLES[activity.type]
  const Icon = style.icon
  const typeLabel = ACTIVITY_TYPE_LABELS[activity.type]
  const sourceLabel = SOURCE_LABELS[activity.source]
  const heading = activity.subject?.trim() || typeLabel

  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.className}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-slate-900">{heading}</p>
          {activity.is_pinned ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              <Pin className="h-3 w-3" aria-hidden="true" />
              Pinned
            </span>
          ) : null}
        </div>

        {activity.body ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
            {activity.body}
          </p>
        ) : null}

        {/* Colour alone never carries the type, so it is repeated in this line. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          <span>{typeLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{actorName(activity)}</span>
          {activity.direction !== 'internal' ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{ACTIVITY_DIRECTION_LABELS[activity.direction]}</span>
            </>
          ) : null}
          {sourceLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{sourceLabel}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <time dateTime={activity.occurred_at} title={formatDateTime(activity.occurred_at)}>
            {formatRelative(activity.occurred_at, now)}
          </time>
        </p>
      </div>
    </li>
  )
}
