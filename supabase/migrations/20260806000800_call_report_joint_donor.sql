-- ---------------------------------------------------------------------------
-- A meeting is frequently with two people.
--
-- The requirement says a call report supports "donor(s)", and the common case
-- is a couple at their own kitchen table. `external_attendees` covers people
-- outside the organisation, but a spouse who is themselves on the record is
-- not an external attendee — they are the other half of the conversation, and
-- the report should be reachable from their record too.
--
-- Two parties, as on `proposals`, and for the same reason: it covers the real
-- cases without a join table carrying its own policies and its own UI.
-- ---------------------------------------------------------------------------

alter table public.call_reports
  add column if not exists joint_contact_id uuid references public.contacts (id) on delete set null;

comment on column public.call_reports.joint_contact_id is
  'The second person the meeting was with. Distinct from external_attendees, which names people outside the organisation.';

do $$ begin
  alter table public.call_reports
    add constraint call_reports_joint_is_someone_else
    check (joint_contact_id is null or joint_contact_id <> contact_id);
exception when duplicate_object then null; end $$;

create index if not exists call_reports_joint_idx
  on public.call_reports (joint_contact_id) where joint_contact_id is not null;

/**
 * Filing posts to both donors' timelines. The dedupe key carries the contact
 * id as well as the report id, so the two entries are distinct rows and
 * re-filing still posts neither of them twice.
 */
create or replace function public.log_call_report_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if new.status <> 'filed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'filed' then
    return null;
  end if;

  foreach target in array array_remove(array[new.contact_id, new.joint_contact_id], null)
  loop
    insert into public.activities
      (contact_id, proposal_id, call_report_id, type, source, subject, body,
       occurred_at, actor_id, metadata, dedupe_key)
    values (
      target, new.proposal_id, new.id, 'call_report', 'system',
      'Call report — ' || to_char(new.met_on, 'FMMonth FMDD, YYYY'),
      new.summary,
      (new.met_on + coalesce(new.met_at_time, time '12:00'))::timestamptz,
      coalesce(new.author_id, (select auth.uid())),
      jsonb_build_object('meeting_kind', new.meeting_kind, 'location', new.location),
      'call_report:' || new.id::text || ':' || target::text
    )
    on conflict do nothing;
  end loop;

  return null;
end;
$$;

-- CREATE OR REPLACE preserves the earlier ACL, but repeat the revocation next
-- to the final body so future edits cannot accidentally reopen the RPC path.
revoke all on function public.log_call_report_activity()
  from public, anon, authenticated;
