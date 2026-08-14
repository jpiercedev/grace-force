-- ---------------------------------------------------------------------------
-- Attachments — proposal documents, estate papers, scans, photographs.
--
-- The bytes live in Supabase Storage; this table is the record of what a file
-- *is* and who it belongs to. Keeping the metadata in Postgres is what makes
-- "every document on this donor" a query rather than a directory listing, and
-- it is what lets RLS answer the question at all.
--
-- `contact_id` is always set, even when the file hangs off a call report or a
-- proposal. That denormalisation is the whole point of the Files tab: one
-- index per donor, no matter which workflow produced the document.
-- ---------------------------------------------------------------------------

create table if not exists public.attachments (
  id             uuid primary key default gen_random_uuid(),

  contact_id     uuid not null references public.contacts (id) on delete cascade,
  call_report_id uuid references public.call_reports (id) on delete cascade,
  proposal_id    uuid references public.proposals (id) on delete cascade,

  -- Object key inside the `attachments` bucket. Unique so a row can never
  -- point at bytes another row also claims to own.
  storage_path   text not null unique,
  file_name      text not null,
  mime_type      text,
  size_bytes     bigint,

  uploaded_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint attachments_has_a_name check (btrim(file_name) <> ''),
  constraint attachments_size_non_negative check (size_bytes is null or size_bytes >= 0)
);

comment on table public.attachments is
  'Metadata for files stored in the `attachments` bucket, always anchored to a contact.';

create index if not exists attachments_contact_idx
  on public.attachments (contact_id, created_at desc);

create index if not exists attachments_call_report_idx
  on public.attachments (call_report_id) where call_report_id is not null;

create index if not exists attachments_proposal_idx
  on public.attachments (proposal_id) where proposal_id is not null;

alter table public.attachments enable row level security;

create policy attachments_select on public.attachments
  for select to authenticated
  using (public.is_active_user());

create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (public.can_write() and uploaded_by = (select auth.uid()));

-- Attachment metadata is immutable. Replacing it would break the audit link
-- between uploader, object owner and the file originally accepted. The app
-- has no metadata-edit path; removal and a fresh upload are the honest edit.

-- Whoever uploaded it can remove it; administrators can remove anything.
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (public.can_write() and (uploaded_by = (select auth.uid()) or public.is_admin()));

-- --- Storage bucket ---------------------------------------------------------
--
-- Guarded on `storage.buckets` existing so the migration is still applicable
-- to a bare Postgres — which is exactly what the PGlite test harness is. The
-- policies mirror the table policies above: read for any active user, write
-- for staff, delete for the uploader or an administrator.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets
    (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'attachments',
    'attachments',
    false,
    20 * 1024 * 1024,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'text/plain',
      'text/markdown',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.apple.pages',
      'application/vnd.apple.numbers',
      'application/vnd.apple.keynote',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/tiff',
      'image/bmp'
    ]::text[]
  )
  on conflict (id) do update set
    name               = excluded.name,
    public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  -- Recreate rather than only CREATE IF ABSENT so re-running this guarded
  -- block also upgrades a bucket whose policies predate this hardening.
  execute 'drop policy if exists attachments_read on storage.objects';
  execute $p$
    create policy attachments_read on storage.objects
      for select to authenticated
      using (bucket_id = 'attachments' and public.is_active_user())
  $p$;

  execute 'drop policy if exists attachments_write on storage.objects';
  execute $p$
    create policy attachments_write on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and public.can_write()
        and owner_id = (select auth.uid()::text)
        and lower(storage.extension(name)) = any (array[
          'pdf', 'doc', 'docx', 'rtf', 'txt', 'md', 'pages',
          'xls', 'xlsx', 'csv', 'numbers', 'ppt', 'pptx', 'key',
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
          'tif', 'tiff', 'bmp'
        ]::text[])
      )
  $p$;

  execute 'drop policy if exists attachments_remove on storage.objects';
  execute $p$
    create policy attachments_remove on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'attachments'
        and public.can_write()
        and (
          owner_id = (select auth.uid()::text)
          or public.is_admin()
        )
      )
  $p$;
end $$;
