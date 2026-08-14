# Grace Lead Management

People and relationship management for the **Grace** team.

Grace Lead Management exists because the team's relationships do not fit an
off-the-shelf sales CRM. The same person is often a monthly donor *and* a
volunteer team lead *and* the contact at a partner church — several
relationships with different owners, different histories and different next
steps. The product models that directly, puts everything that has ever
happened with that person on one timeline, and runs general sales
opportunities through the same shared people records.

## What it does

- **People** with multiple concurrent **engagements** (donor, volunteer,
  prayer partner, partner church, …), each with its own status, owner and dates.
- **Sales** — shared, team-configurable pipelines and opportunity boards built
  on the same people records; staff can create pipelines, reshape stages and
  work opportunities from first contact to won or lost.
- **Unified timeline** — notes, calls, meetings, opportunity moves, gifts,
  follow-ups, lead submissions and Mailchimp opens/clicks in one chronological
  view per person.
- **Follow-ups** with an overdue/today/this-week queue and reminder emails.
- **Dashboard** of what needs attention today.
- **Search** across people, activity and leads.
- **Giving context** — giving history beside the relationship, shared with the
  whole active team as supporting context rather than the product's center.
- **Lead intake** — a hardened public endpoint feeding a triage queue.
- **Mailchimp** — audiences, campaigns and per-contact email engagement,
  synchronised idempotently.
- **Resend** — internal notifications with at-most-once delivery per event.
- **Import / export** — CSV in and out, with stable external ids so a re-import
  updates rather than duplicates and an export can be round-tripped.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 3 ·
Supabase (Postgres + Auth) · Zod · Vitest · Playwright.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the Supabase values
npm run dev
```

Without Supabase credentials the app serves a `/setup` page explaining exactly
what is missing rather than failing with a stack trace.

Full instructions, including applying the migrations: [`docs/SETUP.md`](docs/SETUP.md).

The **first account to sign up becomes the administrator**; everyone after that
starts as staff.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | All Vitest projects |
| `npm run test:db` | Schema + RLS suite against real Postgres (PGlite) |
| `npm run test:unit` | Pure-logic suite |
| `npm run e2e` | Playwright |
| `npm run e2e:public` | Playwright suites needing no live backend |
| `npm run verify` | typecheck + lint + tests + build |

## Security model

Row Level Security is the boundary, not a convention. Every query a signed-in
user makes runs as that user, and Postgres decides which rows come back.
Application code filters for relevance, never for safety.

- `anon` has **no table privileges at all**. Public traffic reaches the database
  only through the service-role lead-intake route.
- Business records are shared: every *active* team member reads the same
  people, opportunities, leads, activity and giving context. Assignment and
  attribution columns record responsibility, never visibility.
- The service-role key is server-only and used in exactly three places: lead
  intake, integration sync, and the notification outbox.

Details: [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/SETUP.md`](docs/SETUP.md) | First-run setup |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + Supabase deployment runbook |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Schema, and why it is shaped this way |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Roles, RLS policies, threat notes |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Mailchimp and Resend setup and behaviour |
| [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) | Entity reference and export column definitions |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Engineering house style |
| [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) | Current build state |
