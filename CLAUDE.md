# Grace Lead Manager — notes for Claude Code

Relationship management for the ministry. Next.js 15 App Router · React 19 ·
TypeScript strict · Tailwind 3 · Supabase.

## Read first

- `docs/CONVENTIONS.md` — house style, UI primitives, accessibility bar
- `docs/DATA_MODEL.md` — schema and the reasoning behind it
- `docs/SECURITY.md` — roles, RLS, threat notes
- `docs/IMPLEMENTATION_STATUS.md` — current build state and next task
- `docs/UX_AUDIT.md` — why the interface is shaped the way it is

## Things that will bite you

**Row Level Security is the security boundary.** Query through
`@/lib/supabase/server` and let Postgres decide which rows come back. Only lead
intake, integration sync and the notification outbox may use
`@/lib/supabase/admin` (service role, bypasses RLS). ESLint blocks importing it
elsewhere.

**Database triggers already write timeline activities** for engagement changes,
pipeline card create/move/close, follow-up create/complete, gift inserts,
contact reassignment, event attendance, proposal create/stage/close and call
report filing. Writing them from application code as well double-posts every
event.

**Related constituents are one directed row.** `contact_relationships` reads
"<from> is the <kind> of <to>"; the two sides render the kind and its inverse
from `@/lib/relationships`. Never write a mirrored second row.

**Capability and proposals follow `can_view_giving()`, not the contact
permission.** That is why `contact_capability` is its own table — RLS is
row-level, so a column on `contacts` would be readable by anyone who can read
the person.

**Generated columns must never be written**: `contacts.full_name`,
`email_normalized`, `phone_normalized`, `search_vector`, and the equivalents on
`leads` and the Mailchimp tables.

**Check constraints pair fields**, and violating them is a 500 rather than a
validation message unless you handle it:
- `engagements` — `status='ended'` requires `ended_on`; any other status forbids it
- `follow_ups` — `status='completed'` requires `completed_at`
- `pipeline_cards` — `status='open'` requires `closed_at IS NULL`, otherwise it must be set
- `proposals` — `funded`/`declined` require `closed_at`; every other status forbids it
- `call_reports` — `status='filed'` requires `filed_at`; a draft forbids it
- `notifications` — `recipients` may be empty only when `status='skipped'`

**A submit button's `name`/`value` does not survive a real-browser
server-action POST.** Use a per-button `formAction`, or a hidden field in a
form of its own. Never a multi-button form dispatching on `intent`.

**Uploads have two body ceilings, and the smaller wins silently.**
`serverActions.bodySizeLimit` is the obvious one;
`experimental.middlewareClientMaxBodySize` defaults to 10MB and applies to
every route with middleware — which here is every authenticated route. Both
are set in `next.config.ts` and both must stay above the total in
`@/lib/attachments`, or a large file is truncated mid-stream and fails as
`Unexpected end of form`.

**Money is integer cents** everywhere. Never floats.

**`NEXT_PUBLIC_*` is inlined at build time**, including into the middleware
bundle. Changing one requires a rebuild, not a restart — this is why the
Playwright config builds before serving.

**Soft deletes**: filter `.is('deleted_at', null)` on contacts.

## Validation

```bash
npm run typecheck
npm run lint
npm test            # unit + db + ui
npm run test:db     # schema + RLS against real Postgres (PGlite, no Docker needed)
npm run e2e:public  # browser tests that need no live backend
npm run build
npm run verify      # all of the above except e2e
```

`npm run test:db` boots Postgres in-process, reproduces Supabase's auth schema
and roles, applies every migration, and exercises policies as the real
`anon` / `authenticated` / `service_role` roles. If you change a migration, run
it.

## Adding a migration

1. Add `supabase/migrations/<timestamp>_<name>.sql` — filename order is apply
   order.
2. Enable RLS and write explicit policies; a table with RLS and no policies is
   unreachable (that is intentional only for `rate_limit_hits`).
3. Any `SECURITY DEFINER` function must pin `search_path = ''` and
   schema-qualify everything — the test suite asserts this.
4. Any view must set `security_invoker = on` — likewise asserted.
5. Update `src/types/database.ts` to match.
6. Run `npm run test:db`.
