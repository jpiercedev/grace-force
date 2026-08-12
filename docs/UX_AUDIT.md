# Simplification audit — requirements, complexity, plan

> Written before the redesign, from the working application. It records what
> the product could already do, what it could not, and why the interface felt
> heavy. `docs/DESIGN.md` stays the visual authority; this document is the
> reasoning behind the *structure* the redesign moved to.

## 1. Functional gap analysis

Every requirement in the brief, mapped against the application as it stood.

### Fully supported before this work

| Requirement | Where it lived |
| --- | --- |
| Name, preferred name, address, phone, email | `contacts` |
| Organization / employer, job title | `contacts.organization_name`, `job_title` |
| Giving history | `gifts` + `contact_giving_summary` |
| Relationship owner / assigned staff | `contacts.owner_id`, reassignment action |
| Status, source | `contacts.status`, `lifecycle_stage`, `source` |
| General relationship summary | `contacts.notes` (free text, search-indexed) |
| Communication history (note/call/email/meeting/text/visit) | `activities` + manual logging |
| Direction — "they called us" vs "we called them" | `activities.direction` |
| Follow-ups with dates, owners, completion | `follow_ups` |
| Attachments-free workflows: leads, imports, exports, Mailchimp, Resend | as built |

### Partially supported

| Requirement | What existed | What was missing |
| --- | --- | --- |
| Communication preferences | `do_not_contact`, `do_not_email` | do-not-call, do-not-text, do-not-mail, preferred method, preferred phone, preferred email, best time to contact, a preferences note — and nowhere in the UI where staff actually contact someone |
| Interaction logging | a collapsed form on the contact page with type/direction/summary/detail/when | no **outcome**, no link to a proposal, no "set a follow-up while you are here", and it asked for CRM vocabulary (`direction`, `subject`) before it asked what happened |
| Planned gifts / proposals | `pipeline_cards` (title, value, stage, owner, expected close) | no proposal *type* (trust, CGA, outright, estate), no financial context (fair market value, charitable amount, estimated deduction, expected benefit), no purpose/designation, no attachments |
| Occupation | `job_title` | only a label problem — reused, relabelled |

### Missing entirely

| Requirement | Consequence |
| --- | --- |
| **Related constituents** | no way to record that Jonathan is Ginny's spouse, or that Bill referred Howard, in either direction |
| **Philanthropic interests and goals** | only a flat `tags[]` array shared with every other kind of label |
| **Giving capability** | no capability level, range, confidence, source or review date |
| **Events and attendance** | no events at all; no event context on a donor record |
| **Call reports / donor meeting reports** | the major stated workflow had no home |
| **Attachments** | no storage, no file records, nothing to attach a proposal document to |

Everything in "missing" and "partial" is implemented by this change. The
schema work is seven migrations (`20260806000100`–`20260806000700`), each with
RLS, indexes and tests; see `docs/DATA_MODEL.md`.

## 2. Where the application felt overwhelming

Observations from walking every route.

**The donor record was one long scroll of equal-weight cards.** Nine surfaces
stacked in two columns — log-activity form, follow-up form, timeline, next
follow-ups, engagements, giving, email engagement, details, plus the header —
all rendered simultaneously, all with the same border, radius and shadow. The
two most common actions (log a call, add a follow-up) were *forms* occupying
permanent space before anyone asked for them. There was no answer to "what is
the state of this relationship" above the fold, only a list of every fact the
database held.

**Four primary actions competed in the header.** "Log activity", "Add
follow-up", "Add engagement" and "Edit" were rendered at the same visual
weight, so none of them read as the thing to do.

**Navigation exposed the database.** Twelve destinations in four labelled
groups — including Search (a page, not a destination), Import and Export
(twice-a-year tools) and two settings screens — sat at the same weight as
Contacts and Follow-ups.

**The dashboard was a summary, not a queue.** Three KPI tiles, a sentence of
computed prose, an ownership line, four panels and a giving strip. It answered
"how is the CRM doing" rather than "what should I do today".

**Forms demanded completeness.** Creating one person presented 25 fields
across six field-sets, most of which nobody knows at the moment they meet
someone.

**Vocabulary was internal.** "Contacts", "Engagements", "Pipelines",
"Activities", "Lifecycle stage", "Direction: internal/outbound/inbound".
Staff manage *people*, *conversations* and *proposals*.

**Redundant metadata.** The contact header showed lifecycle badge, status
badge, do-not-contact badge, do-not-email badge and every tag; the details
panel then repeated source, created, updated; the timeline repeated the same
type labels as its own filter row.

## 3. The plan that was implemented

1. **Navigation down to six.** Dashboard, People, Follow-ups, Proposals,
   Events, Reports. Giving, Pipelines, Leads and Email move into a collapsed
   **More** group; Import, Export and the three settings screens are reached
   from **Settings**, which sits by itself at the foot of the rail. Search
   leaves the rail entirely and becomes a field in the header, present on
   every page. No route moved — grouping only.
2. **One primary action per screen.** Dashboard → work the follow-up queue.
   People → Add person. Donor → **Log interaction**. Everything else is
   secondary or lives in an overflow menu.
3. **The donor record becomes a workspace with tabs.** A header that answers
   who/owner/how-to-reach/preferences, an at-a-glance strip that answers
   next-follow-up / last-interaction / active-proposal / giving / capability,
   then one tab at a time: Activity (default), Overview, Giving, Proposals,
   Events, Relationships, Files. Tabs are links (`?tab=`), so they are
   server-rendered, shareable and work without JavaScript.
4. **Logging an interaction becomes a dialog.** Open donor → Log interaction →
   pick a plain-language type → write a note → optionally set a follow-up →
   Save. Five controls, no CRM vocabulary, one screen.
5. **Progressive disclosure everywhere else.** Proposal financial fields sit
   behind a "Financial details" disclosure. The new-person form asks for six
   things and hides the rest behind "Add more detail". Capability is shown
   quietly, never as a headline figure.
6. **Preferences where staff communicate.** Contact methods render as buttons
   (Call / Text / Email) with the donor's preference marked and any
   do-not-contact rule shown as a plain sentence next to them, not as a badge
   in a row of badges.
7. **Fewer boxes.** Lists sit on the canvas with hairline rules; the card is
   reserved for a genuine panel. Badges are limited to status that changes
   behaviour. Repeated labels removed.

## 4. Verification standard

Each requirement is exercised by a test at the level it lives at: schema and
RLS in `tests/db`, validation and label mapping in `tests/unit`, rendering and
disclosure behaviour in `tests/ui`. `npm run verify` covers typecheck, lint,
all three suites and a production build.
