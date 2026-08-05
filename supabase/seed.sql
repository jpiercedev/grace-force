-- ---------------------------------------------------------------------------
-- Development seed data.
--
-- Gives a local database enough shape to exercise every screen: contacts with
-- overlapping engagements, a populated timeline, overdue and upcoming
-- follow-ups, giving history, pipeline cards in several stages, and untriaged
-- leads.
--
-- Everything here is fictional. Never seed real contact or donor data.
--
-- Safe to run repeatedly: every insert is keyed and guarded, so re-running
-- changes nothing. Ownership is attached to the oldest existing profile when
-- one exists, and left null otherwise — the seed does not create auth users,
-- because those belong to the auth system rather than to application data.
--
-- Usage:
--   supabase db reset          (applies migrations, then this file)
--   psql "$DATABASE_URL" -f supabase/seed.sql
-- ---------------------------------------------------------------------------

do $$
declare
  v_owner        uuid;
  v_donor        uuid;
  v_volunteer    uuid;
  v_prayer       uuid;
  v_partner      uuid;
  v_newsletter   uuid;
  v_pipeline     uuid;
  v_stage_new    uuid;
  v_stage_talk   uuid;
  v_stage_commit uuid;
  v_contact      uuid;
  v_engagement   uuid;
begin
  -- Attach to a real team member when the database already has one.
  select id into v_owner from public.profiles
   where is_active order by created_at limit 1;

  select id into v_donor      from public.engagement_types where slug = 'donor';
  select id into v_volunteer  from public.engagement_types where slug = 'volunteer';
  select id into v_prayer     from public.engagement_types where slug = 'prayer_partner';
  select id into v_partner    from public.engagement_types where slug = 'partner_church';
  select id into v_newsletter from public.engagement_types where slug = 'newsletter';

  select id into v_pipeline from public.pipelines where slug = 'supporter_journey';
  select id into v_stage_new    from public.pipeline_stages where pipeline_id = v_pipeline and slug = 'new';
  select id into v_stage_talk   from public.pipeline_stages where pipeline_id = v_pipeline and slug = 'conversation';
  select id into v_stage_commit from public.pipeline_stages where pipeline_id = v_pipeline and slug = 'committed';

  -- --- Contacts ------------------------------------------------------------
  -- (external_source, external_id) is unique, so this is the idempotency key.
  insert into public.contacts
    (first_name, last_name, email, phone, city, region, organization_name, job_title,
     lifecycle_stage, status, source, owner_id, tags, notes, external_source, external_id)
  values
    ('Miriam', 'Okonkwo', 'miriam.okonkwo@example.org', '(555) 214-8890',
     'Arlington', 'TX', null, null, 'active', 'active', 'referral', v_owner,
     array['monthly-partner','prayer-team'],
     'Introduced by the Delgados. Gives monthly and prays weekly.', 'seed', 'contact-1'),

    ('Samuel', 'Delgado', 'sam.delgado@example.org', '(555) 771-0043',
     'Fort Worth', 'TX', 'Cornerstone Fellowship', 'Associate Pastor',
     'active', 'active', 'event', v_owner,
     array['partner-church'],
     'Hosts the regional gathering each spring.', 'seed', 'contact-2'),

    ('Priya', 'Raman', 'priya.raman@example.org', '(555) 902-3317',
     'Dallas', 'TX', null, null, 'engaged', 'active', 'web_form', v_owner,
     array['volunteer'],
     'Signed up after the spring outreach. Available weekday evenings.',
     'seed', 'contact-3'),

    ('Thomas', 'Byrne', 'tom.byrne@example.org', '(555) 448-2201',
     'Plano', 'TX', 'Byrne & Associates', 'Managing Partner',
     'active', 'active', 'referral', v_owner,
     array['major-gift'],
     'Interested in funding the church-planting initiative.', 'seed', 'contact-4'),

    ('Grace', 'Whitfield', 'grace.whitfield@example.org', null,
     'Denton', 'TX', null, null, 'lapsed', 'active', 'import', v_owner,
     array['newsletter'],
     'Gave regularly through 2024, then went quiet. Worth a call.',
     'seed', 'contact-5'),

    ('Daniel', 'Osei', 'daniel.osei@example.org', '(555) 330-7712',
     'Irving', 'TX', null, null, 'prospect', 'active', 'web_form', null,
     array[]::text[],
     'Asked about volunteering with the youth team.', 'seed', 'contact-6'),

    ('Hopewell', 'Community Church', 'office@hopewell.example.org', '(555) 606-1180',
     'Garland', 'TX', 'Hopewell Community Church', null,
     'engaged', 'active', 'event', v_owner,
     array['partner-church'],
     'Sent a team to the summer conference.', 'seed', 'contact-7'),

    ('Naomi', 'Castellanos', 'naomi.c@example.org', '(555) 118-9964',
     'Mesquite', 'TX', null, null, 'active', 'active', 'manual', v_owner,
     array['prayer-team','volunteer'],
     'Coordinates the Tuesday prayer call.', 'seed', 'contact-8')
  on conflict (external_source, external_id) where external_id is not null do nothing;

  -- --- Engagements ---------------------------------------------------------
  -- A contact holds several at once; that is the point of the model. The
  -- partial unique index means a second run conflicts and is skipped.
  insert into public.engagements
    (contact_id, engagement_type_id, status, role_detail, owner_id, started_on, notes)
  select c.id, et.id, t.status, t.role_detail, v_owner, t.started_on, t.notes
  from (values
    ('contact-1', 'donor',          'active'::public.engagement_status, 'Monthly partner',      current_date - 900, 'Gives on the 1st.'),
    ('contact-1', 'prayer_partner', 'active'::public.engagement_status, 'Tuesday call',         current_date - 640, null),
    ('contact-2', 'partner_church', 'active'::public.engagement_status, 'Primary liaison',      current_date - 1200, 'Main contact at Cornerstone.'),
    ('contact-2', 'donor',          'active'::public.engagement_status, 'Church giving',        current_date - 1100, null),
    ('contact-3', 'volunteer',      'prospect'::public.engagement_status, 'Outreach team',      current_date - 60,  'Awaiting background check.'),
    ('contact-4', 'donor',          'prospect'::public.engagement_status, 'Major gift prospect', current_date - 120, null),
    ('contact-5', 'newsletter',     'active'::public.engagement_status, null,                   current_date - 1500, null),
    ('contact-5', 'donor',          'lapsed'::public.engagement_status, 'Former monthly',       current_date - 1400, 'Last gift over a year ago.'),
    ('contact-7', 'partner_church', 'active'::public.engagement_status, 'Sending church',       current_date - 300, null),
    ('contact-8', 'prayer_partner', 'active'::public.engagement_status, 'Call coordinator',     current_date - 500, null),
    ('contact-8', 'volunteer',      'active'::public.engagement_status, 'Events team',          current_date - 420, null)
  ) as t(ext_id, type_slug, status, role_detail, started_on, notes)
  join public.contacts c on c.external_source = 'seed' and c.external_id = t.ext_id
  join public.engagement_types et on et.slug = t.type_slug
  on conflict do nothing;

  -- --- Timeline entries ----------------------------------------------------
  -- Only the manually-logged kind: engagement, gift, follow-up and pipeline
  -- events are written by triggers, and duplicating them here would double-post.
  insert into public.activities
    (contact_id, type, direction, source, subject, body, occurred_at, actor_id, dedupe_key)
  select c.id, t.kind, t.direction, 'manual', t.subject, t.body,
         now() - make_interval(days => t.days_ago), v_owner, t.dedupe_key
  from (values
    ('contact-1', 'call'::public.activity_type,    'outbound'::public.activity_direction, 'Quarterly check-in call',   'Talked through the autumn appeal. Encouraged by the church-planting update.', 12, 'seed:activity:1'),
    ('contact-1', 'note'::public.activity_type,    'internal'::public.activity_direction, 'Prayer request',            'Asked for prayer for her mother''s surgery in October.', 9, 'seed:activity:2'),
    ('contact-2', 'meeting'::public.activity_type, 'outbound'::public.activity_direction, 'Coffee at Cornerstone',     'Discussed hosting the spring gathering again. He is keen.', 21, 'seed:activity:3'),
    ('contact-3', 'email'::public.activity_type,   'inbound'::public.activity_direction,  'Volunteer enquiry',         'Asked which teams need weekday evening help.', 45, 'seed:activity:4'),
    ('contact-4', 'meeting'::public.activity_type, 'outbound'::public.activity_direction, 'Introductory lunch',        'Walked through the initiative. Asked for a written proposal.', 30, 'seed:activity:5'),
    ('contact-5', 'note'::public.activity_type,    'internal'::public.activity_direction, 'Went quiet',                'No response to the last two appeals. Try a personal call.', 60, 'seed:activity:6'),
    ('contact-7', 'visit'::public.activity_type,   'outbound'::public.activity_direction, 'Visited Hopewell',          'Spoke briefly at the Sunday service.', 75, 'seed:activity:7'),
    ('contact-8', 'call'::public.activity_type,    'inbound'::public.activity_direction,  'Prayer call logistics',     'Wants to move the call to 7am.', 4, 'seed:activity:8')
  ) as t(ext_id, kind, direction, subject, body, days_ago, dedupe_key)
  join public.contacts c on c.external_source = 'seed' and c.external_id = t.ext_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  -- --- Follow-ups ----------------------------------------------------------
  -- A deliberate spread across overdue / today / upcoming so the queue's
  -- segments all have something in them.
  insert into public.follow_ups
    (contact_id, title, details, due_at, priority, status, assigned_to, created_by)
  select c.id, t.title, t.details,
         now() + make_interval(days => t.days_out), t.priority, 'open', v_owner, v_owner
  from (values
    ('contact-5', 'Call Grace about the lapsed pledge', 'She has not responded to two appeals.', -6, 'high'::public.follow_up_priority),
    ('contact-4', 'Send the church-planting proposal',  'He asked for it in writing after lunch.', -2, 'urgent'::public.follow_up_priority),
    ('contact-3', 'Chase the background check',          null, 0, 'normal'::public.follow_up_priority),
    ('contact-1', 'Thank-you note for the autumn gift',  null, 2, 'normal'::public.follow_up_priority),
    ('contact-2', 'Confirm spring gathering dates',      'Needs the venue booked by the end of the month.', 9, 'high'::public.follow_up_priority),
    ('contact-8', 'Move prayer call to 7am',             'Check it suits the rest of the group.', 4, 'low'::public.follow_up_priority)
  ) as t(ext_id, title, details, days_out, priority)
  join public.contacts c on c.external_source = 'seed' and c.external_id = t.ext_id
  where not exists (
    select 1 from public.follow_ups f where f.contact_id = c.id and f.title = t.title
  );

  -- --- Giving --------------------------------------------------------------
  insert into public.gifts
    (contact_id, amount_cents, given_on, method, fund, campaign, is_recurring,
     external_source, external_id)
  select c.id, t.amount_cents, current_date - t.days_ago, t.method, t.fund, t.campaign,
         t.is_recurring, 'seed', t.ext_ref
  from (values
    ('contact-1',  5000, 10,  'card'::public.gift_method,  'General Fund',    'Monthly Partners', true,  'gift-1'),
    ('contact-1',  5000, 40,  'card'::public.gift_method,  'General Fund',    'Monthly Partners', true,  'gift-2'),
    ('contact-1',  5000, 70,  'card'::public.gift_method,  'General Fund',    'Monthly Partners', true,  'gift-3'),
    ('contact-1', 25000, 95,  'card'::public.gift_method,  'Church Planting', 'Spring Appeal',    false, 'gift-4'),
    ('contact-2', 150000, 55, 'check'::public.gift_method, 'Church Planting', null,               false, 'gift-5'),
    ('contact-4', 500000, 200,'ach'::public.gift_method,   'Church Planting', 'Major Gifts',      false, 'gift-6'),
    ('contact-5',  7500, 400, 'card'::public.gift_method,  'General Fund',    'Monthly Partners', false, 'gift-7'),
    ('contact-5',  7500, 430, 'card'::public.gift_method,  'General Fund',    'Monthly Partners', false, 'gift-8'),
    ('contact-7', 60000, 120, 'check'::public.gift_method, 'General Fund',    'Summer Conference',false, 'gift-9'),
    ('contact-8',  3000, 25,  'card'::public.gift_method,  'General Fund',    null,               true,  'gift-10')
  ) as t(ext_id, amount_cents, days_ago, method, fund, campaign, is_recurring, ext_ref)
  join public.contacts c on c.external_source = 'seed' and c.external_id = t.ext_id
  on conflict (external_source, external_id) where external_id is not null do nothing;

  -- --- Pipeline ------------------------------------------------------------
  -- One open card per (pipeline, contact), so a second run is skipped.
  insert into public.pipeline_cards
    (pipeline_id, stage_id, contact_id, title, details, owner_id, expected_close_on, created_by)
  select v_pipeline, s.id, c.id, t.title, t.details, v_owner,
         current_date + t.close_in, v_owner
  from (values
    ('contact-3', 'new',          'Priya — volunteer onboarding', 'Waiting on the background check.', 30),
    ('contact-4', 'conversation', 'Thomas — church planting ask', 'Proposal sent; follow up in two weeks.', 45),
    ('contact-6', 'new',          'Daniel — youth team interest', 'Came through the web form.', 60)
  ) as t(ext_id, stage_slug, title, details, close_in)
  join public.contacts c on c.external_source = 'seed' and c.external_id = t.ext_id
  join public.pipeline_stages s
    on s.pipeline_id = v_pipeline and s.slug = t.stage_slug
  on conflict do nothing;

  -- --- Untriaged leads -----------------------------------------------------
  insert into public.leads
    (first_name, last_name, email, phone, organization_name, message, interest,
     source, form_key, status, dedupe_key)
  values
    ('Ruth', 'Adeyemi', 'ruth.adeyemi@example.org', '(555) 200-4417', null,
     'I heard about Grace Force at the conference and would love to help with the youth programme.',
     'volunteer', 'web_form', 'volunteer-signup', 'new', 'seed:lead:1'),
    ('Peter', 'Nowak', 'peter.nowak@example.org', null, 'Redeemer Chapel',
     'Our elders are interested in becoming a partner church. Who should we speak to?',
     'partner_church', 'web_form', 'partner-enquiry', 'new', 'seed:lead:2'),
    ('Anna', 'Fitzgerald', 'anna.fitz@example.org', '(555) 664-9021', null,
     'Please add me to the prayer list.',
     'prayer_partner', 'web_form', 'default', 'in_review', 'seed:lead:3')
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  -- Give the lapsed contact a stale marker so "needs attention" views have
  -- something to surface.
  update public.contacts
     set last_activity_at = now() - interval '95 days'
   where external_source = 'seed' and external_id = 'contact-5'
     and last_activity_at > now() - interval '90 days';
end $$;
