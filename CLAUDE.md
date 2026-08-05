# Grace Force CRM — notes for Claude Code

Relationship management for Grace Force. Next.js 15 App Router · React 19 ·
TypeScript strict · Tailwind 3 · Supabase.

## Read first

- `docs/CONVENTIONS.md` — house style, UI primitives, accessibility bar
- `docs/DATA_MODEL.md` — schema and the reasoning behind it
- `docs/SECURITY.md` — roles, RLS, threat notes
- `docs/IMPLEMENTATION_STATUS.md` — current build state and next task

## Things that will bite you

**Row Level Security is the security boundary.** Query through
`@/lib/supabase/server` and let Postgres decide which rows come back. Only lead
intake, integration sync and the notification outbox may use
`@/lib/supabase/admin` (service role, bypasses RLS). ESLint blocks importing it
elsewhere.

**Database triggers already write timeline activities** for engagement changes,
pipeline card create/move/close, follow-up create/complete, gift inserts and
contact reassignment. Writing them from application code as well double-posts
every event.

**Generated columns must never be written**: `contacts.full_name`,
`email_normalized`, `phone_normalized`, `search_vector`, and the equivalents on
`leads` and the Mailchimp tables.

**Check constraints pair fields**, and violating them is a 500 rather than a
validation message unless you handle it:
- `engagements` — `status='ended'` requires `ended_on`; any other status forbids it
- `follow_ups` — `status='completed'` requires `completed_at`
- `pipeline_cards` — `status='open'` requires `closed_at IS NULL`, otherwise it must be set
- `notifications` — `recipients` may be empty only when `status='skipped'`

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
