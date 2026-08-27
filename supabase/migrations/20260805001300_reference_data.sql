-- ---------------------------------------------------------------------------
-- Reference data.
--
-- Shipped as a migration (not a seed script) because the app relies on these
-- slugs: lead intake maps a form's `interest` field onto an engagement type,
-- and the default pipeline backs the "add to pipeline" quick action.
--
-- Every statement is idempotent, so re-running against an existing database
-- leaves operator customisations (labels, colours, ordering) untouched.
-- ---------------------------------------------------------------------------

insert into public.engagement_types (slug, label, description, color, icon, sort_order)
values
  ('donor',            'Donor',            'Gives financially to the ministry',               'emerald', 'hand-coins',   10),
  ('volunteer',        'Volunteer',        'Serves on a team or at events',                   'sky',     'users',        20),
  ('prayer_partner',   'Prayer Partner',   'Committed to praying for the ministry',           'violet',  'heart-handshake', 30),
  ('event_attendee',   'Event Attendee',   'Has attended a ministry event',                   'amber',   'calendar',     40),
  ('partner_church',   'Partner Church',   'Leader or liaison at a partnering church',        'indigo',  'church',       50),
  ('small_group',      'Small Group',      'Participates in a small group or cohort',         'rose',    'users-round',  60),
  ('newsletter',       'Newsletter',       'Subscribed to email updates',                     'slate',   'mail',         70),
  ('staff_team',       'Staff / Team',     'Internal team member or contractor',              'zinc',    'briefcase',    80)
on conflict (slug) do nothing;

insert into public.pipelines (slug, name, description, tracks_value, is_default, sort_order, engagement_type_id)
values
  ('supporter_journey', 'Supporter Journey',
   'New contacts from first touch through to committed partnership.',
   false, true, 10, (select id from public.engagement_types where slug = 'donor')),
  ('major_gift', 'Major Gift Cultivation',
   'Relationship track for significant giving conversations.',
   true, false, 20, (select id from public.engagement_types where slug = 'donor')),
  ('volunteer_onboarding', 'Volunteer Onboarding',
   'From interest through screening to an active serving role.',
   false, false, 30, (select id from public.engagement_types where slug = 'volunteer'))
on conflict (slug) do nothing;

-- Stages. `(pipeline_id, slug)` is unique, so re-running is a no-op.
insert into public.pipeline_stages (pipeline_id, slug, name, position, is_won, is_lost, color)
select p.id, s.slug, s.name, s.position, s.is_won, s.is_lost, s.color
from public.pipelines p
join (values
  ('supporter_journey', 'new',            'New',              10, false, false, 'slate'),
  ('supporter_journey', 'contacted',      'Contacted',        20, false, false, 'sky'),
  ('supporter_journey', 'conversation',   'In Conversation',  30, false, false, 'indigo'),
  ('supporter_journey', 'committed',      'Committed',        40, true,  false, 'emerald'),
  ('supporter_journey', 'not_now',        'Not Now',          50, false, true,  'zinc'),

  ('major_gift', 'identified',   'Identified',    10, false, false, 'slate'),
  ('major_gift', 'qualified',    'Qualified',     20, false, false, 'sky'),
  ('major_gift', 'cultivating',  'Cultivating',   30, false, false, 'violet'),
  ('major_gift', 'ask_made',     'Ask Made',      40, false, false, 'amber'),
  ('major_gift', 'committed',    'Committed',     50, true,  false, 'emerald'),
  ('major_gift', 'declined',     'Declined',      60, false, true,  'zinc'),

  ('volunteer_onboarding', 'interested',  'Interested',   10, false, false, 'slate'),
  ('volunteer_onboarding', 'screening',   'Screening',    20, false, false, 'amber'),
  ('volunteer_onboarding', 'training',    'Training',     30, false, false, 'sky'),
  ('volunteer_onboarding', 'serving',     'Serving',      40, true,  false, 'emerald'),
  ('volunteer_onboarding', 'withdrew',    'Withdrew',     50, false, true,  'zinc')
) as s(pipeline_slug, slug, name, position, is_won, is_lost, color)
  on s.pipeline_slug = p.slug
on conflict (pipeline_id, slug) do nothing;
