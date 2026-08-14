-- ---------------------------------------------------------------------------
-- Shared sales reference data.
--
-- Two starting pipelines for the team: General Sales and Relationship
-- Development. They are templates, not fixtures — staff may rename, reshape
-- or archive them from Sales → Manage pipelines.
--
-- Idempotent exactly like 20260805001300: every insert lands on a unique key
-- with ON CONFLICT DO NOTHING, so re-running (or re-deploying) never creates
-- duplicates and never overwrites an operator''s edits.
-- ---------------------------------------------------------------------------

insert into public.pipelines (slug, name, description, tracks_value, is_default, sort_order)
values
  ('general_sales', 'General Sales',
   'A sales conversation from first contact through to a closed deal.',
   true, false, 40),
  ('relationship_development', 'Relationship Development',
   'Deepening a relationship from first introduction to engaged partner.',
   false, false, 50)
on conflict (slug) do nothing;

insert into public.pipeline_stages (pipeline_id, slug, name, position, is_won, is_lost, color)
select p.id, s.slug, s.name, s.position, s.is_won, s.is_lost, s.color
from public.pipelines p
join (values
  ('general_sales', 'new',          'New',          10, false, false, 'slate'),
  ('general_sales', 'qualified',    'Qualified',    20, false, false, 'sky'),
  ('general_sales', 'proposal',     'Proposal',     30, false, false, 'indigo'),
  ('general_sales', 'negotiation',  'Negotiation',  40, false, false, 'amber'),
  ('general_sales', 'won',          'Won',          50, true,  false, 'emerald'),
  ('general_sales', 'lost',         'Lost',         60, false, true,  'zinc'),

  ('relationship_development', 'new_connection',     'New Connection',     10, false, false, 'slate'),
  ('relationship_development', 'getting_acquainted', 'Getting Acquainted', 20, false, false, 'sky'),
  ('relationship_development', 'building_trust',     'Building Trust',     30, false, false, 'violet'),
  ('relationship_development', 'engaged_partner',    'Engaged Partner',    40, true,  false, 'emerald'),
  ('relationship_development', 'paused',             'Paused',             50, false, true,  'zinc')
) as s(pipeline_slug, slug, name, position, is_won, is_lost, color)
  on s.pipeline_slug = p.slug
on conflict (pipeline_id, slug) do nothing;
