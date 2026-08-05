-- ---------------------------------------------------------------------------
-- CSV import staging.
--
-- Imports are two-phase: upload validates every row into `import_rows` and
-- shows a preview; committing then applies only the rows that passed. The
-- staging rows are retained so an operator can see exactly what a past import
-- did, and why a given row was skipped.
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  filename       text,
  status         public.import_status not null default 'pending',

  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  error_rows     integer not null default 0,
  created_rows   integer not null default 0,
  updated_rows   integer not null default 0,
  skipped_rows   integer not null default 0,

  -- Operator's CSV-header → CRM-field mapping, retained for reproducibility.
  column_mapping jsonb not null default '{}'::jsonb,
  options        jsonb not null default '{}'::jsonb,
  error          text,

  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  committed_at   timestamptz,

  constraint import_batches_kind_known check (kind in ('contacts', 'gifts'))
);

comment on table public.import_batches is
  'One CSV upload. Validated on upload, applied on commit.';

create index if not exists import_batches_recent_idx
  on public.import_batches (created_at desc);

create trigger import_batches_set_updated_at
  before update on public.import_batches
  for each row execute function public.set_updated_at();

create table if not exists public.import_rows (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.import_batches (id) on delete cascade,
  row_number  integer not null,

  raw         jsonb not null default '{}'::jsonb,
  normalized  jsonb not null default '{}'::jsonb,
  errors      jsonb not null default '[]'::jsonb,

  -- What validation decided should happen, and what actually happened.
  action      text not null default 'create',
  applied     boolean not null default false,

  contact_id  uuid references public.contacts (id) on delete set null,
  gift_id     uuid references public.gifts (id) on delete set null,

  created_at  timestamptz not null default now(),

  unique (batch_id, row_number),
  constraint import_rows_action_known check (action in ('create', 'update', 'skip', 'error'))
);

create index if not exists import_rows_batch_action_idx
  on public.import_rows (batch_id, action);

-- --- RLS -------------------------------------------------------------------

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

create policy import_batches_select on public.import_batches
  for select to authenticated using (public.can_write());

create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (public.can_write() and created_by = (select auth.uid()));

create policy import_batches_update on public.import_batches
  for update to authenticated
  using (public.is_admin() or created_by = (select auth.uid()))
  with check (public.can_write());

create policy import_batches_delete on public.import_batches
  for delete to authenticated
  using (public.is_admin() or created_by = (select auth.uid()));

-- Row visibility follows the batch that owns it.
create policy import_rows_select on public.import_rows
  for select to authenticated
  using (
    public.can_write() and exists (
      select 1 from public.import_batches b where b.id = batch_id
    )
  );

create policy import_rows_insert on public.import_rows
  for insert to authenticated
  with check (
    public.can_write() and exists (
      select 1 from public.import_batches b
      where b.id = batch_id
        and (public.is_admin() or b.created_by = (select auth.uid()))
    )
  );

create policy import_rows_update on public.import_rows
  for update to authenticated
  using (
    public.can_write() and exists (
      select 1 from public.import_batches b
      where b.id = batch_id
        and (public.is_admin() or b.created_by = (select auth.uid()))
    )
  )
  with check (public.can_write());
