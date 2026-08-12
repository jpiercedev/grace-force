# Grace Force CRM — Design System

> The visual language of the product. Read this before styling anything.
> Tokens live in `tailwind.config.ts` and `src/app/globals.css`; primitives in
> `src/components/ui`. This document is why they are the way they are.

## The idea: a warm ledger

Grace Force is about people — donors, prayer partners, congregations,
conversations that span years. The interface should feel like a well-kept
relational ledger: warm paper, confident ink, one deep accent, and a serif
voice reserved for the moments that are about people rather than software.

It should feel professional, warm, calm, and quietly premium. It should never
feel like an admin template, a developer tool, or accounting software.

Three commitments follow from that:

1. **Warm neutrals, not gray.** The canvas is warm parchment, the text is warm
   ink. Cold gray is the fastest way back to "internal tool."
2. **A serif voice for people and titles.** Page titles, contact names, and
   key figures speak in a serif (Charter/Georgia stack — no font download,
   no new dependency). Everything operational stays in the sans. The contrast
   between the two voices IS the brand.
3. **Fewer boxes, stronger zones.** Structure comes from whitespace, hairline
   rules, and tinted zones — not from wrapping every section in an identical
   white card.

## Color

Defined in `tailwind.config.ts`. The neutral scale keeps the historical token
name `slate` (renaming ~56 files of class usage would churn the entire diff)
but its values are the warm stone scale — treat `slate-*` as "neutral".

| Role | Token | Value | Notes |
| --- | --- | --- | --- |
| Canvas | `slate-50` on body | `#f7f5f2` | warm parchment, not gray |
| Surface | `white` | `#ffffff` | one card level only |
| Surface tint | `slate-100` | `#f0eeea` | zones inside surfaces, hovers |
| Hairline | `slate-200` | `#e5e2dc` | rules and row separators |
| Muted text floor | `slate-500` | `#736c64` | ≥4.5:1 on white — never lighter for meaning |
| Ink | `slate-900` | `#211d19` | primary text |
| Sidebar ink | `ink` | `#1b2420` | near-black evergreen; the identity surface |
| Brand | `brand-600` | `#2b6a4d` | deep evergreen; primary actions, links, focus |
| Brand deep | `brand-700/800` | | hover/active |
| Accent | `accent-500` | `#bf6f3f` | warm clay; highlights, pins, "today" — sparingly |
| Success | `emerald-*` | | tuned tints, always with text |
| Warning | `amber-*` | | |
| Danger | `red-*` | `#b42318` family | warm red |

Blue is gone. Anything that was `brand` blue is evergreen now; `sky` for
informational tones is replaced by neutral ink on tint.

## Typography

- **Serif display** (`font-display`): `Charter, 'Iowan Old Style', Georgia,
  Cambria, serif`. Used for: the wordmark, page titles, contact names on
  their own page, empty-state titles, and large figures (giving totals,
  dashboard counts). Weight 600–700, tight tracking (`tracking-tight`).
- **Sans** (`font-sans`): system stack. All UI, labels, tables, forms.
- **Labels/eyebrows**: 11–12px, semibold, `tracking-wider`, uppercase,
  `slate-500`. Used for section eyebrows, table headers, data labels.
- **Body**: 14px operational, 15–16px for reading surfaces (notes, empty
  states, public forms).
- Numbers that are compared in columns: `tabular-nums`.

Hierarchy comes from voice (serif vs sans), weight, and tracking — never from
size alone.

## Surfaces, borders, shadows, radius

- One elevation of card: `bg-white rounded-xl shadow-card` (soft, warm,
  layered shadow — defined as `shadow-card` token; hairline optional).
  Interactive cards may raise to `shadow-raised` on hover.
- Zones inside a card use `slate-100` tints or hairline `divide-y`, never
  nested cards.
- Sections that are lists (timeline, queues) sit directly on the canvas with
  rules between entries — no box per entry.
- Radius: `rounded-xl` (12px) for surfaces, `rounded-lg` (8px) for controls,
  full for pills/avatars. Nothing else.
- The sidebar is `ink` (near-black evergreen) with parchment text — the one
  place the product is dark, which makes the canvas feel lighter and gives
  the app its silhouette.

## Components

- **Buttons**: primary = evergreen fill; secondary = tonal (`slate-100` fill,
  no border); ghost = text only; danger = warm red fill. No outlined
  secondaries, no blue anywhere. Sizes 36/40/48px.
- **Chips (Badge)**: soft tint + colored dot + text. The dot carries status
  redundantly with the text so color is never the only signal.
- **Avatars**: deterministic warm hue from the name (six-hue wheel), initials
  in white. People get faces everywhere they appear.
- **StatFigure**: label eyebrow + serif figure, inline on the surface — the
  five-identical-tiles pattern is retired.
- **EmptyState**: icon in a tinted circle, serif title, one sentence of
  useful copy, one action. Copy explains value, never says "no data".
- **Inputs**: white on parchment with hairline ring; evergreen focus ring;
  16px on touch.

## Motion

150–200ms, `ease-out`, translate ≤4px. Hover elevation on interactive cards,
drawer slide-in, disclosure fade-slide, button color transitions. Nothing
loops, nothing bounces, nothing blocks. All motion is disabled by the
existing `prefers-reduced-motion` rule.

## Accessibility riders

Everything in the polish pass stays binding: AA contrast floor for meaning,
44px touch targets, single visible focus ring (evergreen), modal drawer with
scroll lock + focus trap, semantic lists/tables, labels on every control.
Dark sidebar text sits at parchment-on-ink (≈12:1).

## Structure: progressive disclosure

The visual language above stayed; what changed in the simplification pass is
how much of it appears at once. `docs/UX_AUDIT.md` records the audit; these are
the rules that came out of it.

**One primary action per screen.** Dashboard → work the queue. People → Add
person. Donor → Log interaction. Everything else is secondary, or lives in the
overflow menu (`ui/menu.tsx`). Five buttons at equal weight means no button.

**Tabs are links, not state.** The donor record splits seven areas across
`?tab=` links, so each is server-rendered, shareable, refreshable and correct
under the back button. `ui/tabs.tsx`. A tab shows a count only when it has one
— an empty area is not news.

**Disclosure carries a summary.** `ui/disclosure.tsx` shows what is inside
while it is closed, so opening it is an informed choice, and opens itself when
it already holds data. Collapsed fields still post: `hidden` does not exclude a
control from form submission, which is what lets the contact form keep five
sections folded without clearing them on save.

**Sections, not cards.** `SectionHeading` — a small-caps eyebrow on the canvas
— replaces the card header for anything that is not a genuine panel. Lists sit
on the canvas with hairline rules between rows. The card is reserved for a
surface that really is a container.

**Ask the question, not the field name.** "What happened?" not "Activity
type". "Where are we with them?" not "Lifecycle stage". "How did we meet them?"
not "Source". The database keeps its vocabulary; the interface does not borrow
it.

**Modals are for workflows, not navigation.** `ui/dialog.tsx` owns focus
capture and return, Escape, the scroll lock and the Tab trap, so no call site
can forget one. Its form wraps body *and* footer: the submit button lives in
the pinned footer while fields scroll, and `useFormStatus` only reports pending
for a button inside its own form.

**Sensitive data is quiet.** Giving capability gets a level, a range in small
type, and when it was last reviewed. No large figure, no colour, no chart.
