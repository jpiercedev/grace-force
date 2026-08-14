# Integrations

Both integrations are optional. When a key is absent the CRM runs normally: the
relevant screen explains what is missing, sync endpoints return `503` with a
clear message, and notifications are recorded with status `skipped` rather than
silently vanishing.

That "unconfigured" path is a supported mode, not an error state, and it is
covered by tests.

---

## Mailchimp

Mirrors Mailchimp into the CRM so that a contact record shows what that person
has actually received and engaged with.

### Setup

1. **Account → Extras → API keys** in Mailchimp, create a key.
2. Set:

   ```
   MAILCHIMP_API_KEY=<key>
   MAILCHIMP_SERVER_PREFIX=us21          # optional; derived from the key suffix
   MAILCHIMP_AUDIENCE_ID=                # optional; blank syncs every audience
   MAILCHIMP_AUTO_CREATE_CONTACTS=true
   ```

   Mailchimp keys end in `-<datacenter>`. The prefix is derived from that suffix
   when `MAILCHIMP_SERVER_PREFIX` is unset; a mismatch between the two is the
   most common cause of 401s.

3. Trigger a sync from `/mailchimp` (admins) or schedule
   `POST /api/cron/mailchimp?job=all`.

### What is synced

| Job | Source | Local table | Key |
| --- | --- | --- | --- |
| `audiences` | `/lists` | `mailchimp_audiences` | `mailchimp_list_id` |
| `members` | `/lists/{id}/members` | `mailchimp_members` | `(audience_id, mailchimp_member_id)` |
| `campaigns` | `/campaigns` + `/reports/{id}` | `mailchimp_campaigns` | `mailchimp_campaign_id` |
| `activity` | `/reports/{id}/email-activity` | `mailchimp_campaign_activity` | `dedupe_key` |

Every run is recorded in `integration_sync_runs` with row counts in `stats`.

### Contact matching

Mailchimp knows email addresses; the CRM knows people. Matching resolves one to
the other in a fixed, documented order:

1. Exact match on `contacts.email_normalized` (non-deleted). Ties break by
   oldest `created_at`, so the result is deterministic.
2. Match on `contacts.secondary_email`, lowercased.
3. If `MAILCHIMP_AUTO_CREATE_CONTACTS` is true, create a contact with
   `source = 'mailchimp'` and names from the `FNAME` / `LNAME` merge fields.
4. Otherwise leave `contact_id` null. Those subscribers appear at
   `/mailchimp/unmatched`, where an admin can link them by hand.

The method used is stored in `match_method`, so a surprising link can be
explained later.

Subscribed, matched contacts also get a `newsletter` engagement, which is what
makes "who is on the list" answerable from the CRM side.

### Idempotency

Re-running any job against unchanged provider data must produce zero new rows.
That is structural, not careful coding:

- Members upsert on `(audience_id, mailchimp_member_id)`.
- Campaign activity upserts on a deterministic
  `dedupe_key = mc:<campaignId>:<action>:<email>[:<url>]`.
- Subscribe/unsubscribe timeline entries use
  `mailchimp:<status>:<listId>:<memberHash>:<lastChanged>`, so replaying a page
  of members re-inserts nothing.

The unit suite asserts this by running each job twice against the same fake
payload and comparing row counts.

### Rate limits and failures

Mailchimp allows 10 concurrent connections per key. The client paginates
serially, retries `429` a bounded number of times honouring `Retry-After`, and
raises a typed `MailchimpError` carrying the provider's status and `detail` for
anything else. A failed job marks its `integration_sync_runs` row `failed` with
the error text; a partially completed one is marked `partial`.

---

## Resend

Sends internal notifications — a new lead arrived, a follow-up is due — to the
Grace team. It never emails contacts; this is staff-facing only.

### Setup

1. Create an API key at <https://resend.com/api-keys>.
2. Verify a sending domain.
3. Set:

   ```
   RESEND_API_KEY=<key>
   RESEND_FROM_EMAIL=Grace Lead Management <crm@yourdomain.org>
   NOTIFY_INTERNAL_EMAILS=team@yourdomain.org,director@yourdomain.org
   ```

`RESEND_FROM_EMAIL` must be a verified identity or Resend rejects the send.
Setting `RESEND_API_KEY` without `RESEND_FROM_EMAIL` is a configuration error
and is reported as one rather than failing at send time.

### Deduplication

The `notifications` table *is* the deduplication mechanism, not a log written
afterwards. Sending follows claim-then-send:

```sql
insert into notifications (kind, dedupe_key, ...) values (...)
on conflict (dedupe_key) do nothing
returning id;
```

If that returns no row, another request or cron run already claimed the event
and this caller sends nothing. Because the claim is a single atomic statement
against a unique index, two concurrent callers cannot both win — which is what
makes "notify once" hold under concurrency, not just on retry.

| Event | Dedupe key | Recipients |
| --- | --- | --- |
| Lead created | `lead_created:<lead_id>` | `NOTIFY_INTERNAL_EMAILS` |
| Follow-up due | `follow_up_due:<id>:<YYYY-MM-DD>` | assignee |
| Follow-up assigned | `follow_up_assigned:<id>:<assignee_id>` | assignee |

The date component on "follow-up due" is deliberate: a daily reminder should be
able to repeat across days, but never twice in one day.

### Unconfigured behaviour

With no `RESEND_API_KEY`, or with no recipients configured, the notification row
is still written and marked `skipped`. The event is recorded, nothing is sent,
and nothing throws. `/settings/integrations` shows the outbox so an admin can
see what would have gone out.

---

## Scheduled jobs

Both cron endpoints require `CRON_SECRET` as a bearer token:

```
Authorization: Bearer $CRON_SECRET
```

| Endpoint | Suggested schedule |
| --- | --- |
| `/api/cron/mailchimp?job=all` | hourly |
| `/api/cron/follow-up-reminders` | every 15 minutes |

`vercel.json` declares both. The secret must never reach the browser, so the
"Sync now" control in the UI is a server action guarded by `requireAdmin()`
rather than a client-side call to the cron route.
