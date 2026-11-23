-- Nov 23, 2026: tell book_outreach rows apart by book.
-- Apply this in the private database after review. The site does not run it.
-- Until it is applied, the Books tab still loads: rows with no book value
-- stay on Elite Mindset, and Signal Over Noise outreach stays empty.
-- Schema only. No personal rows. No outreach contacts.
--
-- book values:
--   elite_mindset       existing rows, and the default for new rows
--   signal_over_noise   presale and marketing for Signal Over Noise
--
-- Ids stay dated. The prefix matches the book:
--   EM-2026-11-15-01    elite_mindset
--   SON-2026-12-01-01   signal_over_noise

alter table family_private.book_outreach
  add column if not exists book text;

update family_private.book_outreach
  set book = 'elite_mindset'
  where book is null or btrim(book) = '';

alter table family_private.book_outreach
  alter column book set default 'elite_mindset';

alter table family_private.book_outreach
  alter column book set not null;

alter table family_private.book_outreach
  drop constraint if exists book_outreach_book_check;

alter table family_private.book_outreach
  add constraint book_outreach_book_check
  check (book in ('elite_mindset', 'signal_over_noise'));

comment on column family_private.book_outreach.book is
  'Which book this outreach row belongs to. Existing rows are elite_mindset.';

alter table family_private.book_outreach
  drop constraint if exists book_outreach_id_check;

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'family_private'
      and rel.relname = 'book_outreach'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%EM-%'
  loop
    execute format('alter table family_private.book_outreach drop constraint %I', r.conname);
  end loop;
end $$;

alter table family_private.book_outreach
  add constraint book_outreach_id_check
  check (id ~ '^(EM|SON)-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$');

create or replace function family_private.book_outreach_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id = btrim(new.id);
  new.stage = lower(regexp_replace(btrim(new.stage), '[^A-Za-z0-9]+', '_', 'g'));
  new.stage = trim(both '_' from new.stage);
  new.book = lower(regexp_replace(btrim(coalesce(new.book, 'elite_mindset')), '[^A-Za-z0-9]+', '_', 'g'));
  new.book = trim(both '_' from new.book);
  if new.book = '' then
    new.book = 'elite_mindset';
  end if;
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

  if new.book not in ('elite_mindset', 'signal_over_noise') then
    raise exception 'book_outreach.book must be elite_mindset or signal_over_noise';
  end if;
  if new.book = 'elite_mindset' and new.id !~ '^EM-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$' then
    raise exception 'elite_mindset outreach ids must look like EM-2026-11-15-01';
  end if;
  if new.book = 'signal_over_noise' and new.id !~ '^SON-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$' then
    raise exception 'signal_over_noise outreach ids must look like SON-2026-12-01-01';
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

revoke all on function family_private.book_outreach_before_write() from public, anon, authenticated;

create index if not exists book_outreach_book_updated_idx
  on family_private.book_outreach (book, updated_at desc);

-- Append book. Replacing a view can add columns at the end and keeps grants.
create or replace view family_api.book_outreach with (security_invoker = true) as
  select id, date_found, place, url, language, stage, raw_status, posted_date, notes, updated_at, book
  from family_private.book_outreach;

revoke all on family_api.book_outreach from anon, public;
grant select on family_api.book_outreach to authenticated;
grant select, insert, update, delete on family_api.book_outreach to service_role;

notify pgrst, 'reload schema';
