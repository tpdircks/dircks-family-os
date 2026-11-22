-- Nov 22, 2026: private calendar and Elite Mindset Book outreach tables.
-- Same pattern as 011_health.sql: RLS enabled and forced, owner-only policies
-- via private.family_is_owner(), security-invoker views in family_api,
-- grants to authenticated for reads only. Service role can write these new
-- objects so bots can insert through Supabase. Schema only. No personal rows.
--
-- Time zone convention:
--   starts_at and ends_at are absolute instants (timestamptz).
--   tz is the IANA zone the event was scheduled in (America/Belem, America/Denver, ...).
--   ends_at is exclusive. A block that ends at 10:00 does not overlap one that starts at 10:00.
--   all_day events cover local midnights in tz: [start midnight, midnight after the last day).
--
-- Overlaps are stored on purpose. Call family_api.calendar_conflicts before inserting
-- and let the dashboard flag whatever still overlaps.

create table if not exists family_private.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  tz text not null,
  all_day boolean not null default false,
  category text not null default 'general' check (category ~ '^[a-z][a-z0-9_]{0,40}$'),
  source text not null check (char_length(btrim(source)) between 1 and 80),
  location text,
  link text check (link is null or link ~ '^https://[^[:space:]]+$'),
  notes text,
  status text not null default 'tentative' check (status in ('tentative', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists family_private.book_outreach (
  id text primary key check (id ~ '^EM-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$'),
  date_found date,
  place text,
  url text check (url is null or url ~ '^https?://[^[:space:]]+$'),
  language text,
  stage text not null check (stage in ('found', 'drafted', 'pending_approval', 'sent', 'replied', 'booked', 'skipped')),
  raw_status text,
  posted_date date,
  notes text,
  updated_at timestamptz not null default now()
);

create or replace function family_private.calendar_events_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title = btrim(new.title);
  new.tz = btrim(new.tz);
  new.source = btrim(new.source);
  new.status = lower(btrim(new.status));
  new.category = lower(regexp_replace(btrim(coalesce(new.category, 'general')), '[^A-Za-z0-9]+', '_', 'g'));
  new.category = trim(both '_' from new.category);
  if new.category = '' then
    new.category = 'general';
  end if;
  if new.link is not null and btrim(new.link) = '' then
    new.link = null;
  elsif new.link is not null then
    new.link = btrim(new.link);
  end if;
  if new.location is not null then
    new.location = nullif(btrim(new.location), '');
  end if;
  new.updated_at = now();

  if new.title is null or new.title = '' then
    raise exception 'calendar_events.title is required';
  end if;
  if new.source is null or new.source = '' then
    raise exception 'calendar_events.source is required';
  end if;
  if new.status not in ('tentative', 'confirmed', 'cancelled') then
    raise exception 'calendar_events.status must be tentative, confirmed, or cancelled';
  end if;
  if new.category !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'calendar_events.category must be a short label such as podcast or interview';
  end if;
  if new.ends_at <= new.starts_at then
    raise exception 'calendar_events.ends_at must be after starts_at';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.tz) then
    raise exception 'calendar_events.tz must be an IANA time zone name';
  end if;
  if new.link is not null and new.link !~ '^https://[^[:space:]]+$' then
    raise exception 'calendar_events.link must start with https://';
  end if;
  return new;
end;
$$;

create or replace function family_private.book_outreach_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id = btrim(new.id);
  new.stage = lower(regexp_replace(btrim(new.stage), '[^A-Za-z0-9]+', '_', 'g'));
  new.stage = trim(both '_' from new.stage);
  if new.url is not null then
    new.url = nullif(btrim(new.url), '');
  end if;
  if new.place is not null then
    new.place = nullif(btrim(new.place), '');
  end if;
  if new.language is not null then
    new.language = nullif(btrim(new.language), '');
  end if;
  if new.raw_status is not null then
    new.raw_status = nullif(btrim(new.raw_status), '');
  end if;
  new.updated_at = now();

  if new.id !~ '^EM-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$' then
    raise exception 'book_outreach.id must look like EM-2026-11-15-01';
  end if;
  if new.stage not in ('found', 'drafted', 'pending_approval', 'sent', 'replied', 'booked', 'skipped') then
    raise exception 'book_outreach.stage must be found, drafted, pending_approval, sent, replied, booked, or skipped';
  end if;
  if new.url is not null and new.url !~ '^https?://[^[:space:]]+$' then
    raise exception 'book_outreach.url must start with http:// or https://';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_before_write on family_private.calendar_events;
create trigger calendar_events_before_write
  before insert or update on family_private.calendar_events
  for each row execute function family_private.calendar_events_before_write();

drop trigger if exists book_outreach_before_write on family_private.book_outreach;
create trigger book_outreach_before_write
  before insert or update on family_private.book_outreach
  for each row execute function family_private.book_outreach_before_write();

revoke all on function family_private.calendar_events_before_write() from public, anon, authenticated;
revoke all on function family_private.book_outreach_before_write() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['calendar_events', 'book_outreach'] loop
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

create index if not exists calendar_events_starts_idx
  on family_private.calendar_events (starts_at);
create index if not exists calendar_events_active_range_idx
  on family_private.calendar_events (starts_at, ends_at)
  where status <> 'cancelled';
create index if not exists calendar_events_category_idx
  on family_private.calendar_events (category, starts_at);
create index if not exists book_outreach_updated_idx
  on family_private.book_outreach (updated_at desc);
create index if not exists book_outreach_stage_idx
  on family_private.book_outreach (stage);

create or replace view family_api.calendar_events with (security_invoker = true) as
  select id, title, starts_at, ends_at, tz, all_day, category, source, location, link, notes, status, created_at, updated_at
  from family_private.calendar_events;

create or replace view family_api.book_outreach with (security_invoker = true) as
  select id, date_found, place, url, language, stage, raw_status, posted_date, notes, updated_at
  from family_private.book_outreach;

revoke all on family_api.calendar_events, family_api.book_outreach from anon, public;
grant select on family_api.calendar_events, family_api.book_outreach to authenticated;

-- Bots use the service role (or SQL as the table owner). The browser role stays read-only.
grant usage on schema family_api to service_role;
grant usage on schema family_private to service_role;
grant select, insert, update, delete on family_private.calendar_events to service_role;
grant select, insert, update, delete on family_private.book_outreach to service_role;
grant select, insert, update, delete on family_api.calendar_events to service_role;
grant select, insert, update, delete on family_api.book_outreach to service_role;

-- Half-open overlap: existing.starts_at < ends_at and existing.ends_at > starts_at.
-- Cancelled rows are ignored. Pass exclude_id when checking an update.
create or replace function family_api.calendar_conflicts(
  starts_at timestamptz,
  ends_at timestamptz,
  exclude_id uuid default null
)
returns setof family_api.calendar_events
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  range_start timestamptz := starts_at;
  range_end timestamptz := ends_at;
  skip_id uuid := exclude_id;
begin
  if range_start is null or range_end is null or range_end <= range_start then
    raise exception 'calendar_conflicts needs a starts_at that is before ends_at';
  end if;
  return query
  select e.id, e.title, e.starts_at, e.ends_at, e.tz, e.all_day, e.category, e.source,
         e.location, e.link, e.notes, e.status, e.created_at, e.updated_at
  from family_private.calendar_events e
  where e.status <> 'cancelled'
    and (skip_id is null or e.id <> skip_id)
    and e.starts_at < range_end
    and e.ends_at > range_start
  order by e.starts_at, e.id;
end;
$$;

revoke all on function family_api.calendar_conflicts(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function family_api.calendar_conflicts(timestamptz, timestamptz, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
