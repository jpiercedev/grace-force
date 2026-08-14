import {
  Ban,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  FileSignature,
  FileText,
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
  PhoneMissed,
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
  MANUAL_ACTIVITY_TYPES,
} from '@/components/domain/contact-badges'
import { Badge, EmptyState } from '@/components/ui/display'
import type { TimelineActivity, TimelineDay } from '@/lib/queries/contacts'
import { cn, formatDate, formatDateTime, formatRelative } from '@/lib/utils'
import type { ActivitySource, ActivityType } from '@/types/database'

/**
 * The unified timeline: everything that happened to a relationship, newest
 * first, grouped by the day it happened on and hung on one continuous rail.
 *
 * Human moments — a call, a visit, a prayer request — carry more weight than
 * the system's own bookkeeping, which steps back a size so the story of the
 * relationship stays legible through the machinery.
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
 * falling back to a generic dot. Tints stay inside the warm ledger: evergreen
 * for conversations, clay for being in the room together, emerald for good
 * news, amber for attention, neutral for the machinery.
 */
const TIMELINE_STYLES: Record<ActivityType, TimelineStyle> = {
  note: { icon: StickyNote, className: 'bg-slate-100 text-slate-600' },
  call: { icon: Phone, className: 'bg-brand-50 text-brand-700' },
  email: { icon: Mail, className: 'bg-brand-50 text-brand-700' },
  meeting: { icon: Users, className: 'bg-accent-50 text-accent-700' },
  text_message: { icon: MessageSquare, className: 'bg-brand-50 text-brand-700' },
  visit: { icon: MapPin, className: 'bg-accent-50 text-accent-700' },
  prayer_request: { icon: HandHeart, className: 'bg-accent-50 text-accent-700' },
  outreach_attempt: { icon: PhoneMissed, className: 'bg-slate-100 text-slate-600' },
  call_report: { icon: FileText, className: 'bg-accent-50 text-accent-700' },
  proposal_created: { icon: FileSignature, className: 'bg-brand-50 text-brand-700' },
  proposal_stage_changed: { icon: FileSignature, className: 'bg-slate-100 text-slate-600' },
  proposal_closed: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700' },
  event_attended: { icon: CalendarDays, className: 'bg-accent-50 text-accent-700' },
  follow_up_created: { icon: CheckSquare, className: 'bg-amber-50 text-amber-700' },
  follow_up_completed: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700' },
  engagement_started: { icon: Handshake, className: 'bg-emerald-50 text-emerald-700' },
  engagement_changed: { icon: Handshake, className: 'bg-slate-100 text-slate-600' },
  pipeline_stage_changed: { icon: KanbanSquare, className: 'bg-slate-100 text-slate-600' },
  pipeline_card_created: { icon: KanbanSquare, className: 'bg-slate-100 text-slate-600' },
  pipeline_card_closed: { icon: CheckCircle2, className: 'bg-slate-100 text-slate-600' },
  gift_recorded: { icon: HandCoins, className: 'bg-emerald-50 text-emerald-700' },
  assignment_changed: { icon: UserCog, className: 'bg-slate-100 text-slate-600' },
  lead_submitted: { icon: Inbox, className: 'bg-amber-50 text-amber-700' },
  lead_converted: { icon: UserPlus, className: 'bg-emerald-50 text-emerald-700' },
  mailchimp_subscribed: { icon: Mail, className: 'bg-slate-100 text-slate-600' },
  mailchimp_unsubscribed: { icon: MailX, className: 'bg-rose-50 text-rose-700' },
  mailchimp_campaign_sent: { icon: Send, className: 'bg-slate-100 text-slate-600' },
  mailchimp_campaign_opened: { icon: MailOpen, className: 'bg-slate-100 text-slate-600' },
  mailchimp_campaign_clicked: { icon: MousePointerClick, className: 'bg-slate-100 text-slate-600' },
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

/** The kinds a person logs by hand — the human beats of the story. */
const HUMAN_TYPES: readonly ActivityType[] = MANUAL_ACTIVITY_TYPES

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
  return activity.actor?.name ?? activity.actor_label?.trim() ?? 'Grace Lead Management'
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
    <ol>
      {days.map((day) => (
        <li key={day.key} className="pt-4 first:pt-1">
          <h3 className="flex items-center gap-3 text-xs font-semibold text-slate-500">
            <time dateTime={day.date}>{dayLabel(day.date, now)}</time>
            <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
          </h3>
          {/* One continuous rail per day; the icons sit on it, so the eye can
              run down the story without re-reading the layout each entry. */}
          <ol className="ml-3 mt-3 border-l border-slate-200 pb-1">
            {day.activities.map((activity) => (
              <TimelineEntry key={activity.id} activity={activity} now={now} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

/**
 * Past this length a note starts pushing the next entry off screen, so it
 * clamps to a preview with a native disclosure to read the rest. The whole
 * body stays in the DOM — find-in-page still works.
 */
const CLAMP_BODY_AT = 280

function ActivityBody({ body, human }: { body: string; human: boolean }) {
  const textClass = human
    ? 'whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700'
    : 'whitespace-pre-wrap break-words text-[13px] text-slate-600'

  if (body.length <= CLAMP_BODY_AT && !/\n[\s\S]*\n[\s\S]*\n/.test(body)) {
    return <p className={cn(human ? 'mt-1' : 'mt-0.5', textClass)}>{body}</p>
  }

  return (
    <details className={cn('group', human ? 'mt-1' : 'mt-0.5')}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className={cn(textClass, 'line-clamp-2 group-open:hidden')}>{body}</span>
        <span className="mt-0.5 inline-block text-xs font-medium text-brand-700 hover:underline group-open:hidden">
          Show more
        </span>
        <span className="mt-0.5 hidden text-xs font-medium text-brand-700 hover:underline group-open:inline-block">
          Show less
        </span>
      </summary>
      <p className={textClass}>{body}</p>
    </details>
  )
}

function TimelineEntry({ activity, now }: { activity: TimelineActivity; now: Date }) {
  const style = TIMELINE_STYLES[activity.type]
  const Icon = style.icon
  const typeLabel = ACTIVITY_TYPE_LABELS[activity.type]
  const sourceLabel = SOURCE_LABELS[activity.source]
  const subject = activity.subject?.trim()
  const heading = subject || typeLabel
  const human = HUMAN_TYPES.includes(activity.type)

  return (
    <li className={cn('relative pl-6 sm:pl-7', human ? 'pb-4 last:pb-1' : 'pb-3.5 last:pb-1')}>
      {/* The ring matches the canvas and punches a gap in the rail so the
          circle reads as a bead on the line rather than a sticker over it. */}
      <span
        className={cn(
          'absolute flex items-center justify-center rounded-full ring-4 ring-slate-50',
          human ? '-left-3 top-0 h-6 w-6' : '-left-[11px] top-0.5 h-5 w-5',
          style.className,
        )}
      >
        <Icon className={human ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden="true" />
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p
            className={
              human
                ? 'text-sm font-semibold text-slate-900'
                : 'text-[13px] font-medium text-slate-600'
            }
          >
            {heading}
          </p>
          {activity.is_pinned ? (
            <Badge tone="amber">
              <Pin className="h-3 w-3" aria-hidden="true" />
              Pinned
            </Badge>
          ) : null}
        </div>

        {activity.body ? <ActivityBody body={activity.body} human={human} /> : null}

        {/* The outcome is the line someone scans when catching up, so it gets
            its own weight rather than being folded into the meta line. */}
        {activity.outcome ? (
          <p className="mt-1 text-[13px] font-medium text-slate-800">
            <span className="text-slate-500">Outcome: </span>
            {activity.outcome}
          </p>
        ) : null}

        {/* Colour alone never carries the type, so it is repeated in this
            line — except when the heading already is the type label, which
            would print the same words twice in a row. */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          {subject ? (
            <>
              <span>{typeLabel}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
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
