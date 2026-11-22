-- Nov 22, 2026: private health tables (weigh-ins, body assessments, nutrition plans)
-- for the Dircks Family OS "Physical Progress" tab. Same pattern as 007:
-- RLS enabled + forced, owner-only policies via private.family_is_owner(),
-- security-invoker views in family_api, grants to authenticated only, nothing to anon.
-- Schema only. No personal or health data in this file.
create table if not exists family_private.health_weighins (
  id uuid primary key default gen_random_uuid(),
  measured_on date not null,
  time_of_day text default 'morning' check (time_of_day in ('morning','evening','other')),
  weight_kg numeric(5,2) not null check (weight_kg between 30 and 250),
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now()
);
create table if not exists family_private.health_assessments (
  id uuid primary key default gen_random_uuid(),
  assessed_on date not null,
  method text not null check (method in ('skinfold','bioimpedance','smart_scale')),
  assessor text,
  is_reference boolean not null default false,
  summary jsonb not null,
  measurements jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists family_private.health_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  title text not null,
  goal text,
  is_active boolean not null default true,
  data jsonb not null,
  created_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['health_weighins','health_assessments','health_plans'] loop
    execute format('alter table family_private.%I enable row level security', t);
    execute format('alter table family_private.%I force row level security', t);
    execute format('drop policy if exists owner_read on family_private.%I', t);
    execute format('drop policy if exists owner_insert on family_private.%I', t);
    execute format('drop policy if exists owner_update on family_private.%I', t);
    execute format('drop policy if exists owner_delete on family_private.%I', t);
    execute format('create policy owner_read on family_private.%I for select to authenticated using ((select private.family_is_owner()))', t);
    execute format('create policy owner_insert on family_private.%I for insert to authenticated with check ((select private.family_is_owner()))', t);
    execute format('create policy owner_update on family_private.%I for update to authenticated using ((select private.family_is_owner())) with check ((select private.family_is_owner()))', t);
    execute format('create policy owner_delete on family_private.%I for delete to authenticated using ((select private.family_is_owner()))', t);
    execute format('revoke all on family_private.%I from anon, public', t);
    execute format('grant select on family_private.%I to authenticated', t);
  end loop;
end $$;
-- Weigh-ins are logged and removed from the app through the security-invoker view,
-- so the invoker (authenticated) also needs insert/delete on the base table; RLS still
-- limits every row to the owner.
grant insert, delete on family_private.health_weighins to authenticated;
create index if not exists health_weighins_date_idx on family_private.health_weighins (measured_on desc);
create index if not exists health_assessments_date_idx on family_private.health_assessments (assessed_on desc);
create or replace view family_api.health_weighins with (security_invoker = true) as
  select id, measured_on, time_of_day, weight_kg, source, note, created_at
  from family_private.health_weighins;
create or replace view family_api.health_assessments with (security_invoker = true) as
  select id, assessed_on, method, assessor, is_reference, summary, measurements, results, notes, created_at
  from family_private.health_assessments;
create or replace view family_api.health_plans with (security_invoker = true) as
  select id, plan_date, title, goal, is_active, data, created_at
  from family_private.health_plans;
revoke all on family_api.health_weighins, family_api.health_assessments, family_api.health_plans from anon, public;
grant select on family_api.health_assessments, family_api.health_plans to authenticated;
grant select, insert, delete on family_api.health_weighins to authenticated;
notify pgrst, 'reload schema';
