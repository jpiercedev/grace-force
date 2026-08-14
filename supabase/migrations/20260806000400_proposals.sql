-- ---------------------------------------------------------------------------
-- Proposals and planned gifts.
--
-- A pipeline card tracks a person moving through a process. A proposal is a
-- specific charitable instrument under discussion — a trust, a gift annuity,
-- an estate provision — with its own type, its own financial shape and its own
-- documents. They are different objects and conflating them was what made the
-- planned-gift requirement unrepresentable.
--
-- The financial columns are all nullable on purpose: an outright gift has no
-- estimated deduction, and forcing every type to carry every field is exactly
-- the "fill in the tax return" experience the redesign is removing.
-- ---------------------------------------------------------------------------

create table if not exists public.proposals (
  id                      uuid primary key default gen_random_uuid(),

  -- The donor this proposal belongs to. A second contact covers the ordinary
  -- case of a couple giving jointly; anything larger than two parties is a
  -- note, not a data structure worth the join table.
  contact_id              uuid not null references public.contacts (id) on delete cascade,
  joint_contact_id        uuid references public.contacts (id) on delete set null,

  title                   text not null,
  kind                    public.proposal_kind not null default 'outright_gift',
  status                  public.proposal_status not null default 'exploring',

  -- Purpose / designation: which work the gift is intended for.
  purpose                 text,
  notes                   text,

  opened_on               date not null default current_date,
  expected_close_on       date,
  closed_at               timestamptz,

  owner_id                uuid references public.profiles (id) on delete set null,

  -- Financial context, minor units. `charitable_amount_cents` is the headline
  -- figure staff quote; the rest is planned-giving detail that stays behind a
  -- disclosure in the interface.
  currency                text not null default 'USD',
  charitable_amount_cents bigint,
  fair_market_value_cents bigint,
  estimated_deduction_cents bigint,
  expected_benefit_cents  bigint,

  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint proposals_has_a_title check (btrim(title) <> ''),
  constraint proposals_joint_is_someone_else check (
    joint_contact_id is null or joint_contact_id <> contact_id
  ),
  constraint proposals_amounts_non_negative check (
    (charitable_amount_cents   is null or charitable_amount_cents   >= 0) and
    (fair_market_value_cents   is null or fair_market_value_cents   >= 0) and
    (estimated_deduction_cents is null or estimated_deduction_cents >= 0) and
    (expected_benefit_cents    is null or expected_benefit_cents    >= 0)
  ),
  -- Same discipline as pipeline_cards: a funded or declined proposal always
  -- records when it settled, and an open one never claims to have.
  constraint proposals_closed_consistency check (
    (status in ('funded', 'declined') and closed_at is not null) or
    (status not in ('funded', 'declined') and closed_at is null)
  )
);

comment on table public.proposals is
  'Charitable proposals and planned gifts attached to a donor. Stage moves post to the timeline by trigger.';
comment on column public.proposals.joint_contact_id is
  'The second donor on a joint proposal. Two parties covers the real cases; more than that belongs in notes.';

create index if not exists proposals_contact_idx on public.proposals (contact_id);
create index if not exists proposals_joint_idx
  on public.proposals (joint_contact_id) where joint_contact_id is not null;
create index if not exists proposals_owner_idx on public.proposals (owner_id);
create index if not exists proposals_open_idx
  on public.proposals (expected_close_on) where status not in ('funded', 'declined');

create trigger proposals_set_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- --- Timeline --------------------------------------------------------------

alter table public.activities
  add column if not exists proposal_id uuid references public.proposals (id) on delete set null;

create index if not exists activities_proposal_idx
  on public.activities (proposal_id) where proposal_id is not null;

-- The ordinary timeline is visible to every active team member, but proposal
-- activities carry planned-gift titles and amounts. Gift activities already
-- carry the same class of sensitive data in metadata, so keep all dedicated
-- giving events behind the same capability as the source tables. This policy
-- protects historical rows as well as everything the trigger writes below.
drop policy if exists activities_select on public.activities;

create policy activities_select on public.activities
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.can_view_giving()
      or type not in (
        'gift_recorded',
        'proposal_created',
        'proposal_stage_changed',
        'proposal_closed'
      )
    )
  );

/**
 * Proposals post their own history, so a proposal that moves stage is visible
 * on the donor's timeline without any caller remembering to log it — the same
 * guarantee engagements and pipeline cards already have.
 */
create or replace function public.log_proposal_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind_label text;
begin
  kind_label := replace(new.kind::text, '_', ' ');

  if tg_op = 'INSERT' then
    insert into public.activities
      (contact_id, proposal_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.id, 'proposal_created', 'system',
      'Proposal opened — ' || new.title,
      (select auth.uid()),
      jsonb_build_object('kind', new.kind, 'status', new.status,
                         'amount_cents', new.charitable_amount_cents)
    );
    return null;
  end if;

  if new.status is distinct from old.status and new.status in ('funded', 'declined') then
    insert into public.activities
      (contact_id, proposal_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.id, 'proposal_closed', 'system',
      new.title || ' — ' || new.status,
      (select auth.uid()),
      jsonb_build_object('kind', new.kind, 'status', new.status,
                         'amount_cents', new.charitable_amount_cents)
    );
  elsif new.status is distinct from old.status then
    insert into public.activities
      (contact_id, proposal_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.id, 'proposal_stage_changed', 'system',
      new.title || ': ' || old.status || ' → ' || new.status,
      (select auth.uid()),
      jsonb_build_object('from', old.status, 'to', new.status, 'kind', new.kind)
    );
  end if;

  return null;
end;
$$;

revoke all on function public.log_proposal_activity()
  from public, anon, authenticated;

create trigger proposals_log_activity
  after insert or update of status on public.proposals
  for each row execute function public.log_proposal_activity();

-- --- RLS --------------------------------------------------------------------
--
-- Proposals carry gift amounts, so reading one follows the giving permission
-- rather than the general contact permission — consistent with `gifts` and
-- `contact_capability`.

alter table public.proposals enable row level security;

create policy proposals_select on public.proposals
  for select to authenticated
  using (public.can_view_giving());

create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (public.can_write() and public.can_view_giving());

create policy proposals_update on public.proposals
  for update to authenticated
  using (public.can_write() and public.can_view_giving())
  with check (public.can_write() and public.can_view_giving());

create policy proposals_delete on public.proposals
  for delete to authenticated
  using (public.is_admin());
