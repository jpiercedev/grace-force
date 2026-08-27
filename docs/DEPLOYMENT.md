# Deployment runbook

Getting Grace Lead Manager onto Vercel, connected to the hosted Supabase project.

Everything here is a dashboard or CLI action. It is written as a checklist
because the ordering matters in two places, both called out below.

## Before you start

| Thing | Value |
| --- | --- |
| Repository | `jpiercedev/grace-force` |
| Branch | `claude/crm-bridge-implementation-zj6y21` |
| Supabase project ref | `phhkhvewcclzjkdbjmqw` |
| Supabase API URL | `https://phhkhvewcclzjkdbjmqw.supabase.co` |
| Supabase region | `us-east-2` |

The repository, Vercel project and Supabase project keep their original
`grace-force` slugs. They predate the rename to Grace Lead Manager and are what
every URL, remote and deployment hook already addresses, so renaming them would
buy nothing and break several things.

The database is already provisioned, and everything through the `20260814`
sales/shared-visibility set is applied, plus
`20260827000200_force_password_rotation.sql`. Only
`20260827000100_rebrand_to_grace_lead_manager.sql` is outstanding, and it
rewrites shipped copy rather than schema. Nothing in this document changes the
schema.

**One trap when you next run `supabase db push`.** The `20260814` migrations
were applied through the management API, which stamps its own apply-time
version, so the history table records them as `20260814183037`–`20260814183353`
while this repository names them `20260814000100`–`20260814000400`. A push
compares by version, sees four it has no record of, and will try to re-apply
them. They are written idempotently, but confirm that before pushing — or
realign the recorded versions to the filename prefixes first, the way the
original sixteen were.

## 1. Create the Vercel project

Vercel dashboard → **Add New → Project** → import `jpiercedev/grace-force`.

- Framework preset: **Next.js** (auto-detected)
- Root directory: repository root
- Build command / output directory: leave as detected
- Production branch: set to whichever branch you intend to promote from. Until
  a `main` exists, the feature branch is the only candidate.

Do **not** deploy yet. Set the environment variables first — see the ordering
note in step 3.

## 2. Environment variables

Add these under **Settings → Environment Variables**. Apply each to Production,
Preview and Development unless noted.

### Non-secret — safe to paste anywhere

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://phhkhvewcclzjkdbjmqw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The **publishable** key from Supabase → Project Settings → API (starts `sb_publishable_`) |
| `NEXT_PUBLIC_SITE_URL` | The deployment origin, e.g. `https://grace-force-crm.vercel.app`. Per-environment: set the preview URL for Preview and the real domain for Production. |
| `SUPABASE_PROJECT_ID` | `phhkhvewcclzjkdbjmqw` (only used by `npm run db:types`) |

The publishable key is designed to be public — it ships inside the browser
bundle either way. It is also close to inert here: the `anon` role holds **no
table privileges at all** in this schema, so a leaked key reads nothing.

### Secret — you must enter these yourself

These are never printed, logged, or committed by any tooling in this repo.

| Variable | Where to get it | What breaks without it |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role`. **Bypasses Row Level Security.** Server-side only; never prefix with `NEXT_PUBLIC_`. | Public lead intake (`POST /api/leads`), the Mailchimp sync runner, the notification outbox, and the follow-up reminder cron. The rest of the app works. |
| `CRON_SECRET` | Generate one: `openssl rand -hex 32`. Sent by Vercel Cron as `Authorization: Bearer …` and compared in constant time. | Both `/api/cron/*` endpoints refuse to run. |
| `LEAD_INTAKE_SECRET` | Optional. Generate as above if you want the public form to require a shared secret in the `x-crm-intake-key` header. | Nothing — intake still works, protected by the origin allow-list, honeypot and rate limit. Set it if the form is embedded somewhere you control the request headers. |

### Deliberately left unset

`MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER_PREFIX`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `NOTIFY_INTERNAL_EMAILS`.

Leaving these blank is a supported mode, not a broken one: the Mailchimp screen
explains what is missing, the sync endpoints return `503`, and notifications are
recorded with status `skipped` instead of vanishing. It also guarantees no real
campaign or email can be sent from a test deployment. Add them only when you
intend live sends — see [`INTEGRATIONS.md`](INTEGRATIONS.md).

### Optional

| Variable | Purpose |
| --- | --- |
| `LEAD_INTAKE_ALLOWED_ORIGINS` | Comma-separated origins permitted to POST to `/api/leads`. Blank means same-origin only. |
| `LEAD_INTAKE_RATE_LIMIT` | Submissions per IP per hour. Defaults to 10. |

## 3. Ordering note — `NEXT_PUBLIC_*` is baked in at build time

Next.js inlines `NEXT_PUBLIC_*` during the build, **including into the
middleware bundle**. Changing one of these later requires a *redeploy*, not a
restart, and a deployment built before the variables existed will keep behaving
as though they are missing — every route redirecting to `/setup`.

So: set the variables, *then* trigger the first deployment. If you deployed
first, redeploy after adding them.

## 4. Supabase auth configuration

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: the deployment origin, e.g. `https://grace-force-crm.vercel.app`
- **Redirect URLs**: add `<origin>/auth/callback`

Vercel preview deployments get a new URL per commit. To exercise auth on
previews, add the wildcard `https://grace-force-crm-*.vercel.app/auth/callback`
alongside the stable one.

Under **Authentication → Providers**, keep **Email** enabled. The app handles
email confirmation being either on or off: with it on, sign-up lands on
`/check-email`; with it off, the user is signed straight in.

Once the team is onboarded, consider disabling public sign-up — profiles are
created by a database trigger on `auth.users`, so users invited from the
dashboard still get one automatically.

## 5. Scheduled jobs

`vercel.json` already declares both crons:

| Endpoint | Schedule |
| --- | --- |
| `/api/cron/mailchimp?job=all` | hourly |
| `/api/cron/follow-up-reminders` | every 15 minutes |

They activate on a Production deployment and require `CRON_SECRET`. Until
Mailchimp is configured the first one returns `503` and records nothing, which
is harmless.

## 6. First sign-in

Visit the deployment and create an account. **The first account becomes the
administrator** and is granted giving access; everyone after starts as staff,
adjustable at `/settings/team`.

If a verification account still exists from setup, remove it first so the real
first sign-up gets the admin role:

```sql
delete from auth.users where email = 'e2e.admin@graceforce.test';
```

## 7. Verifying the deployment

```bash
# Against the deployed origin, from a machine with normal network egress.
E2E_BASE_URL=https://<your-deployment> \
E2E_EMAIL=<staff or admin account> \
E2E_PASSWORD=<password> \
npm run e2e
```

Setting `E2E_BASE_URL` makes Playwright test the deployed app instead of
starting a local server. The `@authed` suite probes the Supabase API first and
skips with the real reachability error if it cannot connect, so a network
problem reports itself rather than looking like broken auth.

Then check, in the Vercel dashboard:

- **Runtime Logs** — filter to errors. Expect none on `/dashboard`, `/contacts`,
  `/login` or the middleware.
- **Build Logs** — the build should report ~36 routes.

And in the Supabase dashboard, **Advisors** — see the accepted findings recorded
in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); anything beyond those
is new and worth investigating.

## 8. Before a public production launch

- [ ] Remove or rotate any verification account
- [ ] Confirm `NEXT_PUBLIC_SITE_URL` matches the production domain
- [ ] Confirm Supabase Site URL and redirect list match the production domain
- [ ] Decide whether public sign-up stays open
- [ ] Consider enabling MFA (Supabase project-level setting)
- [ ] Consider a custom domain, and update both of the URL settings again
- [ ] Set up database backups appropriate to the plan
- [ ] Add Mailchimp and Resend credentials only when live sends are intended
