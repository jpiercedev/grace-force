# Grace Lead Manager — Design System

> The visual language of the product. Read this before styling anything.
> Tokens live in `tailwind.config.ts` and `src/app/globals.css`; primitives in
> `src/components/ui`. This document is why they are the way they are.

## The idea: a bright, practical CRM

Grace Lead Manager is a working tool for a development office. The benchmark is
HubSpot's usability — approachable despite real capability — tailored to donor
development and deliberately simpler than Salesforce. The interface should be
professional, warm, bright, familiar and operational: someone who has used any
mainstream CRM should know how to use this one without being told, and it
should still feel custom to this ministry.

What it must never feel like: an admin template, a developer tool, a marketing
site, or a dashboard product. Three earlier tells to guard against — oversized
typography, editorial serif styling, and dark chrome — are all retired.

Four commitments follow:

1. **One practical sans.** Source Sans 3 everywhere — a humanist face designed
   for interfaces, excellent at 13–14px. Typography disappears into the
   experience; hierarchy comes from weight and muted color, never from
   decoration. No small-caps eyebrows, no display serif, no dramatic tracking.
2. **Bright, bordered surfaces.** Warm-white canvas (`slate-50`), white
   surfaces defined by solid 1px hairlines, a whisper of shadow. Structure
   comes from section headers, dividers and spacing — a card is for a genuine
   self-contained object, not for every group of content.
3. **One confident action color.** Spruce green carries primary actions,
   links, record names and selected states. Semantic colors are reserved for
   status. Everything else stays neutral, and the neutrals stay near-white.
4. **Useful density.** A working CRM shows more rows, more timeline, more
   context per screen — compact paddings, 13px operational text, tables that
   behave like database views — while keeping readable line-height, AA
   contrast and comfortable targets.

## Color

Defined in `tailwind.config.ts`. The neutral scale keeps the historical token
name `slate` (renaming ~56 files of class usage would churn the entire diff)
but its values are a near-neutral ramp with a faint warm cast — treat
`slate-*` as "neutral".

| Role | Token | Value | Notes |
| --- | --- | --- | --- |
| Canvas | `slate-50` on body | `#f8f7f5` | warm white, not gray |
| Surface | `white` | `#ffffff` | one card level only |
| Surface tint | `slate-100` | `#f1efec` | hovers, table heads — sparingly |
| Hairline | `slate-200` | `#e5e3df` | borders, rules, row separators |
| Control border | `slate-300` | `#d4d1cc` | inputs at rest |
| Muted text floor | `slate-500` | `#6b6862` | 5.55:1 on white — never lighter for meaning |
| Ink | `slate-900` | `#1f1d1a` | primary text |
| Brand | `brand-600` | `#0e7a52` | spruce; primary fills (white text 5.35:1) |
| Brand text | `brand-700` | `#0b6647` | links, record names, selected tabs (6.99:1) |
| Brand tint | `brand-50/100` | | selected nav, preferred pills |
| Accent | `accent-*` | amber-clay | "today", pins, avatar wheel — rare |
| Success / Warning / Danger | `emerald` / `amber` / `red` | | always paired with text |

Record names and primary links render in `brand-700` — the familiar CRM
convention that says "this opens a record".

## Typography

- **One family**: Source Sans 3 (variable, latin subset), self-hosted in
  `src/app/fonts/` via `next/font/local` — no build-time network, no runtime
  dependency, SIL OFL license alongside the files.
- **Weights**: page title bold (`text-xl`/`text-2xl`); section title semibold
  (`text-sm`–`text-base`); primary data medium; labels medium 12–13px;
  supporting text regular; metadata regular muted.
- **Sizes**: 14px default; 13px operational (tables, rails, meta); 12px labels
  and table headers, sentence case, ordinary tracking. Reading surfaces
  (notes, empty states, public forms) may use 15–16px.
- Numbers compared in columns: `tabular-nums`.
- Inputs stay 16px below the `sm` breakpoint so iOS does not zoom on focus.

## Surfaces, borders, shadows, radius

- Cards: `bg-white rounded-lg border border-slate-200 shadow-card` — the
  border does the work; `shadow-card` is a 1px hint, not elevation. Floating
  layers (menus, dialogs, the preview panel) use `shadow-raised`.
- Radius: `rounded-lg` (8px) surfaces, `rounded-md` (6px) controls, full for
  pills and avatars. Nothing larger.
- Hovers are color shifts (`hover:bg-slate-50`, `hover:border-slate-300`) —
  no translate lifts, no glow.
- Lists that are streams (timeline, queues) sit on the canvas with hairline
  rules; table heads get the `slate-50` tint.

## Application shell

- **Left nav**: white, compact (`w-56`), always fully visible — six primary
  destinations (Dashboard, People, Follow-ups, Planned gifts, Events, Call
  reports), a labelled "More" group (Giving, Pipelines, New leads, Marketing,
  Import, Export), Settings and the account pinned at the foot. Selected =
  `brand-50` wash + `brand-800` semibold. 32px rows, 16px icons.
- **Header**: white, slim (48px), carries global search. On phones the nav
  becomes a modal drawer (scroll lock, focus trap, Escape).
- Content: `slate-50` canvas, `max-w-screen-2xl`.

## Records

- **Index pages** are database views: compact sortable tables, record-link
  names in `brand-700`, badges for stage, quiet preview affordance per row.
  Below `md` they become stacked summaries — never a squeezed table.
- **Preview panel** (`?preview=<id>`): a server-rendered, non-modal slide-over
  for inspecting a person without leaving the list — identity, quick actions,
  next follow-up, last interaction, interests, active planned gift, related
  people, recent activity. Speed is its whole job; the full record is one
  click away.
- **The donor record** is three zones: identity rail (About card — actionable
  channel rows with the preference pinned and blocked channels explained,
  then owner/stage/work/address, rare properties behind "View all details"),
  center workspace (Overview · Activity · Planned gifts · Giving · Events as
  `?tab=` links), association rail (Related people · Planned gifts · Events ·
  Files as collapsible counted sections with their own add actions).

## Components

- **Buttons**: primary = spruce fill; secondary = white outlined (the familiar
  CRM pattern); outline = brand-outlined for a screen's "open" affordance;
  ghost = text; danger = red fill. Sizes 32/36/40px — `sm` only inline with
  dense content. One primary action per screen.
- **Badges**: 4px-radius tags, soft tint + colored dot + sentence-case text —
  the dot restates the tone so color is never the only signal.
- **Avatars**: deterministic hue from the name (six muted tones, AA white
  initials). 24px in tables, 32px default.
- **Forms**: `Field` wires label/hint/error ARIA; labels 13px medium;
  controls white with `slate-300` ring, brand focus ring; two-column groups
  where fields pair; optional fields behind disclosures that open themselves
  when they hold data. Lightweight edits happen in dialogs/drawers, not
  full pages.
- **Timeline**: quick actions (Note · Call · Email · Meeting · Follow-up)
  above a day-grouped stream. Human entries lead with semibold subjects;
  system entries are a register smaller and grayer. Long notes clamp to two
  lines with a native show-more. Icons sit on one continuous rail.
- **EmptyState**: small icon, plain semibold title, one useful sentence, one
  action. Copy explains value, never says "no data".

## Motion

150–200ms `ease-out` color transitions; drawer/preview slide-ins; disclosure
fades. No hover lifts, no loops, no bounces. Everything respects
`prefers-reduced-motion`.

## Accessibility riders

Binding, not aspirational: AA contrast floor for anything that carries
meaning (the values in the color table are verified); visible brand focus
ring everywhere; full keyboard operability (dialogs trap focus and return it,
Escape closes anything that opens, the preview panel takes focus on open);
labels on every control; tables scroll in their own container; layouts work
from 360px; color is never the only signal.

## Structure: progressive disclosure

The rules from the simplification pass stay binding:

**One primary action per screen.** Dashboard → work the queue. People → Add
person. Donor → Log interaction. Everything else is secondary or lives in the
overflow menu (`ui/menu.tsx`).

**Tabs are links, not state** (`ui/tabs.tsx`) — server-rendered, shareable,
back-button-correct. A tab shows a count only when it has one.

**Disclosure carries a summary** (`ui/disclosure.tsx`) and opens itself when
it already holds data. Collapsed fields still post.

**Sections, not cards.** `SectionHeading` — a plain semibold line — replaces
the card header for anything that is not a genuine panel.

**Ask the question, not the field name.** "What happened?" not "Activity
type". The database keeps its vocabulary; the interface does not borrow it.

**Modals are for workflows, not navigation.** `ui/dialog.tsx` owns focus
capture and return, Escape, scroll lock and the Tab trap.

**Sensitive data is quiet.** Giving capability gets a level, a range in small
type, and when it was last reviewed. No large figure, no colour, no chart.

## The design test

Before shipping a screen, ask: *Would a HubSpot user immediately understand
how to use this?* — *Does this feel significantly simpler than Salesforce?* —
*Does this still feel custom rather than copied?* All three must be yes.
