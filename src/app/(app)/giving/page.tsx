import { parseISO } from 'date-fns'
import Link from 'next/link'
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/display'
import { requireProfile } from '@/lib/auth'
import {
  getGivingOverview,
  hasGivingFilters,
  parseGivingFilters,
  type GivingBreakdownItem,
  type GivingGift,
  type TopGiver,
} from '@/lib/queries/giving'
import { formatCurrency, formatDate, pluralize } from '@/lib/utils'
import type { GiftMethod } from '@/types/database'
import { GivingFilters } from './giving-filters'

export const metadata = { title: 'Giving' }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * `given_on` and the range bounds are DATE columns. `new Date('2026-08-05')`
 * reads as UTC midnight and then formats a day early west of Greenwich, so the
 * string is parsed as a local calendar day first.
 */
function formatDay(value: string): string {
  return formatDate(parseISO(value))
}

const METHOD_LABELS: Record<GiftMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  stock: 'Stock',
  in_kind: 'In kind',
  other: 'Other',
}

export default async function GivingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireProfile()
  const params = await searchParams
  const filters = parseGivingFilters(params)
  const now = new Date()
  const overview = await getGivingOverview(filters, now)
  const filtered = hasGivingFilters(filters)

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="Giving" description="Generosity in context, across the whole ministry." />

      {/* One quiet band of figures, led by the range being reported —
          stewardship, not an accounting widget row. */}
      <Card>
        <div className="flex flex-col gap-6 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:gap-10">
          <dl className="lg:w-72 lg:shrink-0">
            <dt className="text-xs font-medium text-slate-500">
              Received in this range
            </dt>
            <dd className="mt-1.5 text-3xl font-semibold leading-none tabular-nums text-brand-700">
              {formatCurrency(overview.range.totalCents)}
            </dd>
            <dd className="mt-2 text-xs leading-snug text-slate-500">
              {formatDay(overview.range.from)} – {formatDay(overview.range.to)}
              {overview.range.giftCount === 0 ? (
                <> · no gifts in this window</>
              ) : (
                <>
                  {' · '}
                  {pluralize(overview.range.giftCount, 'gift')} ·{' '}
                  {formatCurrency(overview.range.averageCents)} average
                </>
              )}
            </dd>
          </dl>

          <div aria-hidden="true" className="hidden w-px self-stretch bg-slate-200 lg:block" />
          <div aria-hidden="true" className="h-px w-full bg-slate-200 lg:hidden" />

          <dl className="grid flex-1 grid-cols-1 gap-x-8 gap-y-5 min-[420px]:grid-cols-3">
            <SupportingFigure
              label="This month"
              value={formatCurrency(overview.totals.monthToDateCents)}
              hint="So far this calendar month"
            />
            <SupportingFigure
              label="Year to date"
              value={formatCurrency(overview.totals.yearToDateCents)}
              hint="Since 1 January"
            />
            <SupportingFigure
              label="Trailing 12 months"
              value={formatCurrency(overview.totals.trailing12moCents)}
              hint="The last 365 days"
            />
          </dl>
        </div>
      </Card>

      {overview.truncated ? (
        <Callout tone="warning" title="Totals are partial">
          More gifts matched than this page can read at once, so the figures cover the most recent
          ones only. Narrow the date range for an exact total.
        </Callout>
      ) : null}

      <GivingFilters filters={filters} range={overview.range} funds={overview.funds} />

      {overview.range.giftCount === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              title="No gifts in this window"
              description="Nothing was received in that date range, or under that fund. Widen the range or reset the filters."
            />
          ) : (
            <EmptyState
              title="No giving recorded yet"
              description="Once gifts are imported or synced from the giving platform, totals, funds and top supporters appear here."
            />
          )}
        </Card>
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Breakdown
              title="Top funds"
              description="By total given in this range."
              items={overview.topFunds}
              emptyDescription="No gifts in this range carry a fund."
            />
            <Breakdown
              title="Top campaigns"
              description="By total given in this range."
              items={overview.topCampaigns}
              emptyDescription="No gifts in this range belong to a campaign."
            />
          </div>

          <RecentGifts gifts={overview.recent} total={overview.range.giftCount} />
        </>
      )}

      <TopGivers givers={overview.topGivers} />
    </div>
  )
}

function SupportingFigure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-slate-900">
        {value}
      </dd>
      <dd className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</dd>
    </div>
  )
}

function Breakdown({
  title,
  description,
  items,
  emptyDescription,
}: {
  title: string
  description: string
  items: GivingBreakdownItem[]
  emptyDescription: string
}) {
  // Bars are scaled against the largest row, which keeps small funds visible.
  const largest = items.reduce((max, item) => Math.max(max, item.total_cents), 0)

  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState title="Nothing to show" description={emptyDescription} />
      ) : (
        <CardBody>
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.label}>
                {/* No flex-wrap: a long fund name must wrap inside its own
                    box rather than push the amount off the right edge. */}
                <div className="flex items-baseline justify-between gap-x-3">
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                    {item.label}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrency(item.total_cents)}
                  </span>
                </div>
                {/* The bar restates the number beside it, so it is decorative. */}
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100" aria-hidden="true">
                  <div
                    className="h-1.5 rounded-full bg-brand-500"
                    style={{ width: `${largest === 0 ? 0 : (item.total_cents / largest) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">{pluralize(item.gift_count, 'gift')}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      )}
    </Card>
  )
}

function RecentGifts({ gifts, total }: { gifts: GivingGift[]; total: number }) {
  return (
    <Card>
      <CardHeader
        title="Recent gifts"
        description={
          total > gifts.length
            ? `The ${gifts.length} most recent of ${total.toLocaleString()} in this range`
            : pluralize(gifts.length, 'gift')
        }
      />
      {/* The table is wider than a phone; without a cue the columns past the
          right edge are simply never discovered. */}
      <p className="px-5 py-2 text-sm text-slate-500 sm:hidden">
        Scroll sideways for fund and method.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Recent gifts in the selected range</caption>
          <thead>
            <tr>
              <Th className="pl-5">Contact</Th>
              <Th align="right">Amount</Th>
              <Th>Date</Th>
              <Th>Fund</Th>
              <Th className="pr-5">Method</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {gifts.map((gift) => (
              <tr key={gift.id} className="align-top transition-colors hover:bg-slate-100/60">
                <td className="min-w-[14rem] py-3.5 pl-5 pr-3">
                  {gift.contact ? (
                    <span className="flex items-start gap-2.5">
                      <Avatar name={gift.contact.name} size="sm" className="mt-px" />
                      <Link
                        href={`/contacts/${gift.contact.id}`}
                        className="min-w-0 font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        {gift.contact.name}
                      </Link>
                    </span>
                  ) : (
                    <span className="text-slate-500">Unknown contact</span>
                  )}
                  {gift.is_anonymous ? (
                    <span className="ml-1.5">
                      <Badge tone="zinc">Anonymous</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-slate-900">
                  {formatCurrency(gift.amount_cents, gift.currency)}
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 text-slate-600">
                  <time dateTime={gift.given_on}>{formatDay(gift.given_on)}</time>
                </td>
                <td className="px-3 py-3.5 text-slate-600">
                  {gift.fund ?? <span className="text-slate-500">—</span>}
                  {gift.campaign ? (
                    <div className="text-xs text-slate-500">{gift.campaign}</div>
                  ) : null}
                </td>
                <td className="py-3.5 pl-3 pr-5 text-slate-600">
                  {METHOD_LABELS[gift.method]}
                  {gift.is_recurring ? (
                    <div className="mt-0.5">
                      <Badge tone="brand">Recurring</Badge>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function TopGivers({ givers }: { givers: TopGiver[] }) {
  return (
    <Card>
      <CardHeader
        title="Top supporters"
        description="By total given over the trailing twelve months."
      />
      {givers.length === 0 ? (
        <EmptyState
          title="No supporters yet"
          description="Once gifts are recorded, the people giving most consistently appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {givers.map((giver) => (
            <li
              key={giver.contact.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-slate-100/60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={giver.contact.name} size="md" />
                <span className="min-w-0">
                  <Link
                    href={`/contacts/${giver.contact.id}`}
                    className="text-sm font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {giver.contact.name}
                  </Link>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {pluralize(giver.giftCount, 'gift')} all time
                    {giver.lastGiftOn ? (
                      <>
                        {' · last '}
                        <time dateTime={giver.lastGiftOn}>{formatDay(giver.lastGiftOn)}</time>
                      </>
                    ) : null}
                  </span>
                </span>
              </span>
              <span className="pl-11 text-left sm:pl-0 sm:text-right">
                <span className="block text-sm font-semibold tabular-nums text-slate-900">
                  {formatCurrency(giver.trailing12moCents)}
                  <span className="font-normal text-slate-500"> past 12 months</span>
                </span>
                {/* A single-window supporter's two figures are identical;
                    printing the same amount twice reads as a glitch. */}
                {giver.totalCents !== giver.trailing12moCents ? (
                  <span className="block text-xs tabular-nums text-slate-500">
                    {formatCurrency(giver.totalCents)} all time
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Th({
  children,
  align,
  className,
}: {
  children: React.ReactNode
  align?: 'right'
  className?: string
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2.5 text-xs font-medium text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className ?? ''}`}
    >
      {children}
    </th>
  )
}
