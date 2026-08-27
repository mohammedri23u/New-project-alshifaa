-- ===========================================================================
-- Course Portal — complete database schema.
--
-- HOW TO USE: open your Supabase project, click SQL Editor, click New query,
-- paste this ENTIRE file, click Run. It is safe to run more than once.
--
-- WHAT IT GUARANTEES
--   * Every learner gets one immutable, server-issued participant code.
--   * A learner can read and write ONLY their own rows (Row Level Security).
--   * Only accounts listed in `admins` can see anyone else's data.
--   * Submissions cannot be edited or deleted after the fact.
--   * Closed windows are refused by the DATABASE, not merely hidden by the UI.
--   * Certificate eligibility is computed here, not in the browser.
--
-- WHAT IT DELIBERATELY DOES NOT CONTAIN
--   * No public directory of participants. There is no function anywhere that
--     lets an unauthenticated visitor look up a name, an email address or a
--     participant code. Anonymous visitors can read the timetable and nothing else.
--   * No shared or default password of any kind.
--   * No bulk password reset. Password recovery is Supabase's own email flow.
-- ===========================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Settings (a single row) ------------------------------------------------
-- Written by the admin console's "Publish schedule to server" button so that
-- the database always enforces exactly what course.config.js says.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                          boolean primary key default true,
  course_timezone             text        not null default 'UTC',
  code_prefix                 text        not null default 'CP',
  total_days                  integer     not null default 1,
  cert_required_components    text[]      not null default array['registration','pre','post','feedback'],
  cert_min_attendance_days    integer     not null default 0,
  cert_min_post_percent       numeric     null,
  updated_at                  timestamptz not null default now(),
  constraint app_settings_single_row check (id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Administrator allow-list ----------------------------------------------
-- Being an administrator is membership of this table. Nothing else grants it:
-- not an email domain, not a flag the browser can set, not a magic password.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text,
  added_at  timestamptz not null default now()
);

-- SECURITY DEFINER so that checking "am I an admin?" does not itself have to
-- pass the admins table's own RLS policy (which would recurse forever).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 3. Participants -----------------------------------------------------------
-- One row per learner. `id` IS the auth user id, so RLS is a simple comparison
-- against auth.uid() and there is no way to impersonate another participant.
-- ---------------------------------------------------------------------------
create sequence if not exists public.participant_code_seq start with 1;

create table if not exists public.participants (
  id               uuid primary key references auth.users(id) on delete cascade,
  participant_code text        not null unique,
  full_name        text        not null default '',
  email            text,
  demographics     jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists participants_code_idx on public.participants (participant_code);

-- The code is issued HERE. The browser never supplies it and cannot change it.
create or replace function public.assign_participant_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
begin
  select code_prefix into v_prefix from public.app_settings where id;
  new.participant_code :=
    coalesce(v_prefix, 'CP') || '-' || to_char(nextval('public.participant_code_seq'), 'FM0000');
  return new;
end;
$$;

drop trigger if exists participants_assign_code on public.participants;
create trigger participants_assign_code
  before insert on public.participants
  for each row execute function public.assign_participant_code();

-- The code, the id and the registration timestamp are immutable for everyone.
create or replace function public.protect_participant_identity()
returns trigger
language plpgsql
as $$
begin
  new.id               := old.id;
  new.participant_code := old.participant_code;
  new.created_at       := old.created_at;
  return new;
end;
$$;

drop trigger if exists participants_protect_identity on public.participants;
create trigger participants_protect_identity
  before update on public.participants
  for each row execute function public.protect_participant_identity();

-- A new confirmed auth user automatically becomes a participant. The name and
-- demographics come from the sign-up payload; the code comes from the trigger above.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.participants (id, full_name, email, demographics)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->'demographics', '{}'::jsonb)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 4. Component windows ------------------------------------------------------
-- `key` is 'registration', 'pre', 'post', 'feedback' or 'attendance_<n>'.
-- Times are absolute (timestamptz). They are produced from the wall-clock
-- times in course.config.js using the course timezone, so the browser and the
-- database are talking about the same instant — including across a daylight
-- saving change.
-- ---------------------------------------------------------------------------
create table if not exists public.component_windows (
  key        text primary key,
  opens_at   timestamptz,
  closes_at  timestamptz,
  override   boolean,          -- null = follow the schedule, true = force open,
                               -- false = force closed
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create or replace function public.component_is_open(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when w.key is null           then false          -- never configured: closed
           when w.override is not null  then w.override
           when w.opens_at  is not null and now() < w.opens_at  then false
           when w.closes_at is not null and now() > w.closes_at then false
           else true
         end
  from (select p_key as k) q
  left join public.component_windows w on w.key = q.k;
$$;

-- ---------------------------------------------------------------------------
-- 5. Attendance -------------------------------------------------------------
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  day_index      integer not null check (day_index between 1 and 5),
  checked_in_at  timestamptz not null default now(),
  unique (participant_id, day_index)
);

create index if not exists attendance_participant_idx on public.attendance (participant_id);

-- ---------------------------------------------------------------------------
-- 6. Pre-test and post-test -------------------------------------------------
-- ---------------------------------------------------------------------------
create table if not exists public.test_submissions (
  id                uuid primary key default gen_random_uuid(),
  participant_id    uuid not null references public.participants(id) on delete cascade,
  phase             text not null check (phase in ('pre','post')),
  submitted_at      timestamptz not null default now(),
  score_raw         numeric,
  score_max         numeric,
  score_percent     numeric,
  duration_seconds  integer,
  unique (participant_id, phase)
);

create table if not exists public.test_answers (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.test_submissions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  phase          text not null check (phase in ('pre','post')),
  item_id        text not null,
  response       text,
  -- Recorded for convenience only. The exports RE-SCORE every answer from the
  -- item bank rather than trusting this column, so a tampered value cannot
  -- change any reported result.
  is_correct     boolean,
  unique (participant_id, phase, item_id)
);

create index if not exists test_answers_participant_idx on public.test_answers (participant_id);

-- ---------------------------------------------------------------------------
-- 7. Feedback ---------------------------------------------------------------
-- ---------------------------------------------------------------------------
create table if not exists public.feedback_submissions (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  submitted_at   timestamptz not null default now()
);

create table if not exists public.feedback_answers (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  item_id        text not null,
  response       text,
  unique (participant_id, item_id)
);

create index if not exists feedback_answers_participant_idx on public.feedback_answers (participant_id);

-- ---------------------------------------------------------------------------
-- 8. Write paths ------------------------------------------------------------
-- These run as the CALLING user, so Row Level Security still applies. They
-- exist to make each submission a single atomic round trip and to give a
-- clear error message when a window is closed.
-- ---------------------------------------------------------------------------
create or replace function public.record_attendance(p_day_index integer)
returns public.attendance
language plpgsql
as $$
declare
  v_row public.attendance;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.component_is_open('attendance_' || p_day_index) then
    raise exception 'Attendance for day % is not open.', p_day_index using errcode = 'P0001';
  end if;

  insert into public.attendance (participant_id, day_index)
  values (auth.uid(), p_day_index)
  on conflict (participant_id, day_index) do nothing;

  select * into v_row from public.attendance
   where participant_id = auth.uid() and day_index = p_day_index;
  return v_row;
end;
$$;

create or replace function public.submit_test(
  p_phase            text,
  p_score_raw        numeric,
  p_score_max        numeric,
  p_score_percent    numeric,
  p_duration_seconds integer,
  p_answers          jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_submission uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_phase not in ('pre','post') then
    raise exception 'Unknown test phase %.', p_phase using errcode = 'P0001';
  end if;
  if not public.component_is_open(p_phase) then
    raise exception 'The % is not open.', p_phase using errcode = 'P0001';
  end if;
  if exists (select 1 from public.test_submissions
              where participant_id = auth.uid() and phase = p_phase) then
    raise exception 'You have already submitted the % test.', p_phase using errcode = 'P0001';
  end if;

  insert into public.test_submissions
    (participant_id, phase, score_raw, score_max, score_percent, duration_seconds)
  values
    (auth.uid(), p_phase, p_score_raw, p_score_max, p_score_percent, p_duration_seconds)
  returning id into v_submission;

  insert into public.test_answers (submission_id, participant_id, phase, item_id, response, is_correct)
  select v_submission, auth.uid(), p_phase,
         a->>'item_id', a->>'response', (a->>'is_correct')::boolean
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as a
   where coalesce(a->>'item_id', '') <> '';

  return v_submission;
end;
$$;

create or replace function public.submit_feedback(p_answers jsonb)
returns uuid
language plpgsql
as $$
declare
  v_submission uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.component_is_open('feedback') then
    raise exception 'Feedback is not open.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.feedback_submissions where participant_id = auth.uid()) then
    raise exception 'You have already submitted feedback.' using errcode = 'P0001';
  end if;

  insert into public.feedback_submissions (participant_id)
  values (auth.uid())
  returning id into v_submission;

  insert into public.feedback_answers (participant_id, item_id, response)
  select auth.uid(), a->>'item_id', a->>'response'
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as a
   where coalesce(a->>'item_id', '') <> '';

  return v_submission;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Administrator actions --------------------------------------------------
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_window_override(p_key text, p_override boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;
  insert into public.component_windows (key, override, updated_at, updated_by)
  values (p_key, p_override, now(), auth.uid())
  on conflict (key) do update
    set override = excluded.override, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- Copies course.config.js into the database. This is what keeps the times the
-- browser shows and the times the database enforces from ever drifting apart:
-- both come from the same source, converted with the same timezone name.
create or replace function public.admin_publish_config(p_config jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz    text := coalesce(p_config->>'timezone', 'UTC');
  v_key   text;
  v_win   jsonb;
  v_keys  text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  update public.app_settings set
    course_timezone          = v_tz,
    code_prefix              = coalesce(p_config->>'code_prefix', code_prefix),
    total_days               = coalesce((p_config->>'total_days')::integer, total_days),
    cert_required_components = coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(p_config#>'{certificate,requiredComponents}') as value),
      cert_required_components),
    cert_min_attendance_days = coalesce((p_config#>>'{certificate,minAttendanceDays}')::integer, 0),
    cert_min_post_percent    = nullif(p_config#>>'{certificate,minPostScorePercent}', '')::numeric,
    updated_at               = now()
  where id;

  for v_key, v_win in select * from jsonb_each(coalesce(p_config->'windows', '{}'::jsonb)) loop
    v_keys := v_keys || v_key;
    insert into public.component_windows (key, opens_at, closes_at, updated_at, updated_by)
    values (
      v_key,
      -- A wall-clock string is interpreted IN THE COURSE TIMEZONE. This is the
      -- exact counterpart of the browser-side conversion in src/tz.js.
      nullif(v_win->>'opensAt','')::timestamp  at time zone v_tz,
      nullif(v_win->>'closesAt','')::timestamp at time zone v_tz,
      now(), auth.uid()
    )
    on conflict (key) do update
      set opens_at   = excluded.opens_at,
          closes_at  = excluded.closes_at,
          updated_at = now(),
          updated_by = auth.uid();
    -- note: an existing manual override is intentionally preserved
  end loop;

  -- Windows removed from the configuration are removed here too.
  delete from public.component_windows where not (key = any(v_keys));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Progress and eligibility ----------------------------------------------
-- The certificate rule is evaluated HERE. The browser only displays the answer.
-- This mirrors, condition for condition, certificateEligibility() in
-- src/scoring.js, which is the version demo mode uses.
-- ---------------------------------------------------------------------------
create or replace view public.v_progress
with (security_invoker = on) as
with s as (select * from public.app_settings where id)
select
  p.id                                          as participant_id,
  p.participant_code,
  p.created_at                                  as registered_at,
  (select count(*) from public.attendance a where a.participant_id = p.id)::int
                                                as attendance_days,
  exists (select 1 from public.test_submissions t where t.participant_id = p.id and t.phase = 'pre')
                                                as pre_done,
  exists (select 1 from public.test_submissions t where t.participant_id = p.id and t.phase = 'post')
                                                as post_done,
  exists (select 1 from public.feedback_submissions f where f.participant_id = p.id)
                                                as feedback_done,
  (select t.score_percent from public.test_submissions t
    where t.participant_id = p.id and t.phase = 'pre')   as pre_score_percent,
  (select t.score_percent from public.test_submissions t
    where t.participant_id = p.id and t.phase = 'post')  as post_score_percent,
  (
    ( not ('pre' = any(s.cert_required_components))
      or exists (select 1 from public.test_submissions t where t.participant_id = p.id and t.phase = 'pre') )
    and
    ( not ('post' = any(s.cert_required_components))
      or exists (select 1 from public.test_submissions t where t.participant_id = p.id and t.phase = 'post') )
    and
    ( not ('feedback' = any(s.cert_required_components))
      or exists (select 1 from public.feedback_submissions f where f.participant_id = p.id) )
    and
    ( (select count(*) from public.attendance a where a.participant_id = p.id)
        >= least(s.cert_min_attendance_days, s.total_days) )
    and
    ( s.cert_min_post_percent is null
      or coalesce((select t.score_percent from public.test_submissions t
                    where t.participant_id = p.id and t.phase = 'post'), -1) >= s.cert_min_post_percent )
  )                                             as certificate_eligible
from public.participants p, s;

-- What a learner sees about themselves.
create or replace view public.v_my_progress
with (security_invoker = on) as
select * from public.v_progress where participant_id = auth.uid();

-- ---------------------------------------------------------------------------
-- 11. Administrator views ---------------------------------------------------
-- Each is filtered by is_admin(), so a learner calling them gets zero rows
-- rather than their own row — there is no ambiguity about who may read what.
-- participant_code is joined in so that exports never need the raw user id.
-- ---------------------------------------------------------------------------
create or replace view public.v_admin_participants with (security_invoker = on) as
  select p.participant_code, p.full_name, p.email, p.demographics, p.created_at
    from public.participants p where public.is_admin();

create or replace view public.v_admin_attendance with (security_invoker = on) as
  select p.participant_code, a.day_index, a.checked_in_at
    from public.attendance a join public.participants p on p.id = a.participant_id
   where public.is_admin();

create or replace view public.v_admin_test_submissions with (security_invoker = on) as
  select p.participant_code, t.phase, t.submitted_at, t.score_raw, t.score_max,
         t.score_percent, t.duration_seconds
    from public.test_submissions t join public.participants p on p.id = t.participant_id
   where public.is_admin();

create or replace view public.v_admin_test_answers with (security_invoker = on) as
  select p.participant_code, a.phase, a.item_id, a.response, a.is_correct
    from public.test_answers a join public.participants p on p.id = a.participant_id
   where public.is_admin();

create or replace view public.v_admin_feedback with (security_invoker = on) as
  select p.participant_code, f.submitted_at
    from public.feedback_submissions f join public.participants p on p.id = f.participant_id
   where public.is_admin();

create or replace view public.v_admin_feedback_answers with (security_invoker = on) as
  select p.participant_code, a.item_id, a.response
    from public.feedback_answers a join public.participants p on p.id = a.participant_id
   where public.is_admin();

-- ---------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY ----------------------------------------------------
-- Every table is deny-by-default. A policy has to exist for an operation to be
-- possible at all; where no policy is listed below, the operation is refused
-- for everyone using the anon key — including administrators.
-- ---------------------------------------------------------------------------
alter table public.app_settings       enable row level security;
alter table public.admins             enable row level security;
alter table public.participants       enable row level security;
alter table public.component_windows  enable row level security;
alter table public.attendance         enable row level security;
alter table public.test_submissions   enable row level security;
alter table public.test_answers       enable row level security;
alter table public.feedback_submissions enable row level security;
alter table public.feedback_answers   enable row level security;

-- settings: readable by signed-in users (no personal data), writable by admins
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

-- admins: you may see your own membership row; admins see the whole list.
-- Nobody can add themselves — there is no INSERT policy at all, so the first
-- administrator must be added from the SQL editor (see SETUP.md step 8).
drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- participants: your own row, or everything if you are an admin.
drop policy if exists participants_select_own on public.participants;
create policy participants_select_own on public.participants
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists participants_update_own on public.participants;
create policy participants_update_own on public.participants
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- (the participants_protect_identity trigger still prevents changing the code)

-- component_windows: the timetable is public information; only admins write,
-- and they do so through admin_publish_config / admin_set_window_override.
drop policy if exists windows_read_all on public.component_windows;
create policy windows_read_all on public.component_windows
  for select to anon, authenticated using (true);

-- attendance: insert your own, read your own, admins read all.
-- No UPDATE policy: a check-in cannot be back-dated or altered.
drop policy if exists attendance_insert_own on public.attendance;
create policy attendance_insert_own on public.attendance
  for insert to authenticated
  with check (participant_id = auth.uid() and public.component_is_open('attendance_' || day_index));

drop policy if exists attendance_select_own on public.attendance;
create policy attendance_select_own on public.attendance
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

-- An administrator may remove a check-in made in error. This is the only
-- destructive operation anyone can perform through the anon key.
drop policy if exists attendance_delete_admin on public.attendance;
create policy attendance_delete_admin on public.attendance
  for delete to authenticated using (public.is_admin());

-- test submissions and answers: insert once, read your own, never modify.
drop policy if exists test_submissions_insert_own on public.test_submissions;
create policy test_submissions_insert_own on public.test_submissions
  for insert to authenticated
  with check (participant_id = auth.uid() and public.component_is_open(phase));

drop policy if exists test_submissions_select_own on public.test_submissions;
create policy test_submissions_select_own on public.test_submissions
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

drop policy if exists test_answers_insert_own on public.test_answers;
create policy test_answers_insert_own on public.test_answers
  for insert to authenticated
  with check (participant_id = auth.uid() and public.component_is_open(phase));

drop policy if exists test_answers_select_own on public.test_answers;
create policy test_answers_select_own on public.test_answers
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

-- feedback: same shape.
drop policy if exists feedback_submissions_insert_own on public.feedback_submissions;
create policy feedback_submissions_insert_own on public.feedback_submissions
  for insert to authenticated
  with check (participant_id = auth.uid() and public.component_is_open('feedback'));

drop policy if exists feedback_submissions_select_own on public.feedback_submissions;
create policy feedback_submissions_select_own on public.feedback_submissions
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

drop policy if exists feedback_answers_insert_own on public.feedback_answers;
create policy feedback_answers_insert_own on public.feedback_answers
  for insert to authenticated
  with check (participant_id = auth.uid() and public.component_is_open('feedback'));

drop policy if exists feedback_answers_select_own on public.feedback_answers;
create policy feedback_answers_select_own on public.feedback_answers
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 13. Function privileges ---------------------------------------------------
-- PostgreSQL grants EXECUTE on a new function to PUBLIC automatically, which
-- would let the anonymous role call the submission functions. They all refuse
-- a null auth.uid(), so this was never exploitable — but an anonymous visitor
-- has no business being able to invoke them at all, so every function is
-- revoked from PUBLIC here and then granted back only where it is needed.
--
-- Trigger functions are granted to nobody: PostgreSQL does not check EXECUTE
-- when firing a trigger, so they keep working while being uncallable directly.
-- ---------------------------------------------------------------------------
revoke all on function public.is_admin()                                     from public;
revoke all on function public.component_is_open(text)                        from public;
revoke all on function public.assign_participant_code()                      from public;
revoke all on function public.protect_participant_identity()                 from public;
revoke all on function public.handle_new_auth_user()                         from public;
revoke all on function public.record_attendance(integer)                     from public;
revoke all on function public.submit_test(text, numeric, numeric, numeric, integer, jsonb) from public;
revoke all on function public.submit_feedback(jsonb)                         from public;
revoke all on function public.admin_set_window_override(text, boolean)       from public;
revoke all on function public.admin_publish_config(jsonb)                    from public;

-- The ONLY function an anonymous visitor may call: it reveals whether a
-- component is open, which is already public information on the landing page.
grant execute on function public.component_is_open(text) to anon, authenticated;

grant execute on function public.is_admin()                                  to authenticated;
grant execute on function public.record_attendance(integer)                  to authenticated;
grant execute on function public.submit_test(text, numeric, numeric, numeric, integer, jsonb) to authenticated;
grant execute on function public.submit_feedback(jsonb)                      to authenticated;
grant execute on function public.admin_set_window_override(text, boolean)    to authenticated;
grant execute on function public.admin_publish_config(jsonb)                 to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Table grants ----------------------------------------------------------
-- RLS decides row visibility; these decide which operations are offered at all.
-- anon gets the timetable and nothing else.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.component_windows to anon, authenticated;
grant select on public.app_settings      to authenticated;
grant select on public.admins            to authenticated;

grant select, update on public.participants          to authenticated;
grant select, insert on public.attendance            to authenticated;
grant delete         on public.attendance            to authenticated;  -- admins only, via RLS
grant select, insert on public.test_submissions      to authenticated;
grant select, insert on public.test_answers          to authenticated;
grant select, insert on public.feedback_submissions  to authenticated;
grant select, insert on public.feedback_answers      to authenticated;

grant select on public.v_progress              to authenticated;
grant select on public.v_my_progress           to authenticated;
grant select on public.v_admin_participants    to authenticated;
grant select on public.v_admin_attendance      to authenticated;
grant select on public.v_admin_test_submissions to authenticated;
grant select on public.v_admin_test_answers    to authenticated;
grant select on public.v_admin_feedback        to authenticated;
grant select on public.v_admin_feedback_answers to authenticated;

commit;

-- ===========================================================================
-- FINAL STEP — MAKE YOURSELF AN ADMINISTRATOR
--
-- Register through the portal first so that your account exists, then run the
-- two lines below in the SQL editor with your own address. There is no way to
-- do this from inside the application, by design.
--
--   insert into public.admins (user_id, email)
--   select id, email from auth.users where email = 'you@example.org'
--   on conflict (user_id) do nothing;
--
-- To check it worked:
--   select email from public.admins;
-- ===========================================================================
