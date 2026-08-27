# Engineering conventions

House style for Grace Lead Manager. Read before adding code.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict (`noUncheckedIndexedAccess`) ·
Tailwind 3 · Supabase (Postgres + Auth) · Zod · Vitest · Playwright.

No other runtime dependencies may be added without updating `package.json`
deliberately — the dependency list is small on purpose.

## Security model

**Row Level Security is the security boundary.** Application code never
filters by permission for safety; it filters for relevance. Every query made
through `@/lib/supabase/server` runs as the signed-in user, and Postgres
decides which rows come back.

- `@/lib/supabase/server` — request-scoped, runs as the user. Default choice.
- `@/lib/supabase/admin` — service role, **bypasses RLS**. Only for the public
  lead-intake route, integration sync jobs, and the notification outbox.
- `@/lib/permissions` — pure predicates (`canWrite`, `isAdmin`). Safe in
  client components. These hide UI; they do not secure anything.
- `@/lib/auth` — server-only guards (`requireProfile`, `requireAdmin`,
  `requireWriteAccess`) plus re-exports of the predicates.

Never construct SQL by string concatenation with user input. Use the query
builder or parameterised RPC.

## Component conventions

- Server Components by default. Add `'use client'` only for interactivity.
- Mutations go through **server actions** in an `actions.ts` beside the route,
  marked `'use server'`, validated with Zod, returning
  `{ error?: string; fieldErrors?: Record<string,string> }` rather than
  throwing for user-facing failures.
- Revalidate with `revalidatePath` after a successful mutation.
- Shared primitives live in `@/components/ui`:
  - `button.tsx` — `Button`, `LinkButton`, `buttonClasses`
    (variants: `primary` `secondary` `outline` `ghost` `danger`; sizes `sm` `md` `lg`)
  - `form.tsx` (client) — `Field` (render-prop, wires label/hint/error ARIA),
    `Input`, `Textarea`, `Select`, `Checkbox`, `Label`, `Fieldset`
  - `display.tsx` — `Badge` (`tone`), `badgeTone`, `Card`, `CardHeader`,
    `CardBody`, `PageHeader`, `EmptyState`, `Callout` (`tone`, `role`),
    `Avatar`, `StatTile`
- `@/lib/utils` — `cn`, `formatCurrency`, `parseCurrencyToCents`, `formatDate`,
  `formatDateTime`, `formatRelative`, `isOverdue`, `contactDisplayName`,
  `initials`, `normalizeEmail`, `normalizePhone`, `truncate`, `pluralize`,
  `chunk`.

## Accessibility and responsiveness

Non-negotiable, not a later pass:

- Every control has an accessible name. Icon-only buttons need `aria-label`.
- Every form control is associated with a `<label>` — use `Field`.
- Focus is always visible (the global `:focus-visible` ring handles this;
  do not remove it).
- Full keyboard operability: no click-only interactions. Anything that opens
  must close on `Escape`.
- Tables scroll inside their own container; the page body never scrolls
  horizontally.
- Layouts work from 360px up. Test at mobile width.
- Colour is never the only signal — pair it with text or an icon.

## Money and time

- Money is stored and passed as **integer cents** (`*_cents`). Never floats.
- Timestamps are ISO strings from Postgres `timestamptz`. Format for display
  with the helpers; never hand-roll.

## Idempotency

Anything that ingests from outside the app must be safely repeatable:

- External records carry `(external_source, external_id)`.
- Timeline events carry a deterministic `dedupe_key`.
- Notifications claim their `dedupe_key` before sending.

Re-running any sync or import must change nothing the second time.

## Comments

Explain *why*, not *what*. A comment that restates the code is noise; a
comment that captures a constraint, a trade-off or a non-obvious failure mode
earns its place.

## Testing

- `tests/unit/**` — pure logic (sync engines, mappers, CSV, validation).
  Inject collaborators; never call a real network.
- `tests/db/**` — real Postgres via PGlite. Use `createTestDb()` from
  `tests/db/helpers/db.ts`, which applies every migration and gives you
  `asUser`, `asAnon`, `asServiceRole`, `asPostgres`.
- `tests/e2e/**` — Playwright. Tag `@public` for suites that need no live
  backend; `@authed` for those that do (they skip when unconfigured).
