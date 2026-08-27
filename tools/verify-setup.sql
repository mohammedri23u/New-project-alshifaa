-- ===========================================================================
-- verify-setup.sql — check that schema.sql installed correctly.
--
-- HOW TO USE
--   1. Run supabase/schema.sql first.
--   2. Supabase → SQL Editor → New query.
--   3. Paste this ENTIRE file and click Run.
--   4. Read the `result` column. The last row is the overall verdict.
--
-- This script is READ-ONLY. It creates nothing, changes nothing and deletes
-- nothing — it only inspects the PostgreSQL catalogs. It is safe to run at any
-- time, including during a live course.
--
-- RESULTS
--   PASS  as expected
--   FAIL  something is wrong; the portal will not behave as documented
--   WARN  not wrong, but probably a step you have not done yet
-- ===========================================================================

with

-- ---------------------------------------------------------------- expected --
expected_tables(t) as (values
  ('admins'), ('app_settings'), ('attendance'), ('component_windows'),
  ('feedback_answers'), ('feedback_submissions'), ('participants'),
  ('test_answers'), ('test_submissions')),

expected_views(v) as (values
  ('v_admin_attendance'), ('v_admin_feedback'), ('v_admin_feedback_answers'),
  ('v_admin_participants'), ('v_admin_test_answers'), ('v_admin_test_submissions'),
  ('v_my_progress'), ('v_progress')),

-- The columns the application actually reads or writes. Extra columns of your
-- own are fine; these must be present.
expected_columns(t, c) as (values
  ('participants','id'), ('participants','participant_code'), ('participants','full_name'),
  ('participants','email'), ('participants','demographics'), ('participants','created_at'),
  ('component_windows','key'), ('component_windows','opens_at'),
  ('component_windows','closes_at'), ('component_windows','override'),
  ('attendance','participant_id'), ('attendance','day_index'), ('attendance','checked_in_at'),
  ('test_submissions','participant_id'), ('test_submissions','phase'),
  ('test_submissions','submitted_at'), ('test_submissions','score_raw'),
  ('test_submissions','score_max'), ('test_submissions','score_percent'),
  ('test_submissions','duration_seconds'),
  ('test_answers','submission_id'), ('test_answers','participant_id'),
  ('test_answers','phase'), ('test_answers','item_id'), ('test_answers','response'),
  ('test_answers','is_correct'),
  ('feedback_submissions','participant_id'), ('feedback_submissions','submitted_at'),
  ('feedback_answers','participant_id'), ('feedback_answers','item_id'), ('feedback_answers','response'),
  ('admins','user_id'), ('admins','email'),
  ('app_settings','course_timezone'), ('app_settings','code_prefix'),
  ('app_settings','total_days'), ('app_settings','cert_required_components'),
  ('app_settings','cert_min_attendance_days'), ('app_settings','cert_min_post_percent')),

-- One policy per operation the application needs. See schema.sql section 12.
expected_policies(t, n) as (values
  ('app_settings', 1), ('admins', 1), ('participants', 2), ('component_windows', 1),
  ('attendance', 3), ('test_submissions', 2), ('test_answers', 2),
  ('feedback_submissions', 2), ('feedback_answers', 2)),

expected_functions(f) as (values
  ('is_admin'), ('component_is_open'), ('assign_participant_code'),
  ('protect_participant_identity'), ('handle_new_auth_user'),
  ('record_attendance'), ('submit_test'), ('submit_feedback'),
  ('admin_set_window_override'), ('admin_publish_config')),

-- ------------------------------------------------------------- catalogues --
have_tables as (
  select c.relname::text as t, c.oid, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),

have_views as (
  select c.relname::text as v, c.oid, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'),

have_columns as (
  select c.relname::text as t, a.attname::text as c
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped),

have_policies as (
  select tablename::text as t, count(*)::int as n
    from pg_policies where schemaname = 'public' group by tablename),

have_functions as (
  select p.proname::text as f, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (select f from expected_functions)),

-- Everything the anonymous role can reach, computed from effective privileges
-- (so a grant inherited from PUBLIC is caught too, not just an explicit one).
anon_relations as (
  select c.relname::text as rel,
         array_remove(array[
           case when has_table_privilege('anon', c.oid, 'SELECT') then 'SELECT' end,
           case when has_table_privilege('anon', c.oid, 'INSERT') then 'INSERT' end,
           case when has_table_privilege('anon', c.oid, 'UPDATE') then 'UPDATE' end,
           case when has_table_privilege('anon', c.oid, 'DELETE') then 'DELETE' end
         ], null) as privs
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v')),

anon_reachable as (
  select rel, privs from anon_relations where cardinality(privs) > 0),

anon_functions as (
  select f from have_functions where has_function_privilege('anon', oid, 'EXECUTE')),

-- The submission tables must offer no UPDATE and no DELETE to a signed-in
-- learner. attendance DELETE is the single deliberate exception (admins only,
-- enforced by the attendance_delete_admin policy).
mutable_submissions as (
  select c.relname::text as rel,
         array_remove(array[
           case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 'UPDATE' end,
           case when has_table_privilege('authenticated', c.oid, 'DELETE') then 'DELETE' end
         ], null) as privs
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('test_submissions','test_answers','feedback_submissions','feedback_answers')),

-- ----------------------------------------------------------------- checks --
checks as (

  select 1 as seq, 'Tables exist'::text as check_name,
         case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
         case when count(*) = 0 then (select count(*)::text from expected_tables) || ' of '
                                    || (select count(*)::text from expected_tables) || ' present'
              else 'MISSING: ' || string_agg(t, ', ') end as detail
    from (select t from expected_tables except select t from have_tables) m

  union all
  select 2, 'Views exist',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then (select count(*)::text from expected_views) || ' present'
              else 'MISSING: ' || string_agg(v, ', ') end
    from (select v from expected_views except select v from have_views) m

  union all
  select 3, 'Expected columns present',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then (select count(*)::text from expected_columns) || ' columns checked'
              else 'MISSING: ' || string_agg(t || '.' || c, ', ') end
    from (select t, c from expected_columns except select t, c from have_columns) m

  union all
  select 4, 'Row Level Security enabled on EVERY table',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'all ' || (select count(*)::text from have_tables) || ' tables protected'
              else 'RLS IS OFF ON: ' || string_agg(t, ', ') || ' — data is exposed, fix before use' end
    from have_tables where not relrowsecurity

  union all
  select 5, 'Policy count per table',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then (select sum(n)::text from expected_policies) || ' policies total'
              else string_agg(t || ': expected ' || exp || ', found ' || got, '; ') end
    from (select e.t, e.n as exp, coalesce(h.n, 0) as got
            from expected_policies e left join have_policies h on h.t = e.t
           where coalesce(h.n, 0) <> e.n) m

  union all
  select 6, 'anon can reach ONLY component_windows',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'anon has SELECT on component_windows and nothing else'
              else 'UNEXPECTED ANON ACCESS: ' || string_agg(rel || ' (' || array_to_string(privs, '+') || ')', ', ') end
    from anon_reachable
   where not (rel = 'component_windows' and privs = array['SELECT'])

  union all
  select 7, 'anon keeps its one intended read',
         case when exists (select 1 from anon_reachable where rel = 'component_windows'
                            and 'SELECT' = any(privs)) then 'PASS' else 'FAIL' end,
         'the landing page needs this to show the timetable'

  union all
  select 8, 'All expected functions exist',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then (select count(*)::text from expected_functions) || ' present'
              else 'MISSING: ' || string_agg(f, ', ') end
    from (select f from expected_functions except select f from have_functions) m

  union all
  select 9, 'anon can execute ONLY component_is_open',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'no other function is callable anonymously'
              else 'ANON CAN CALL: ' || string_agg(f, ', ')
                   || ' — re-run schema.sql, its REVOKE block was not applied' end
    from anon_functions where f <> 'component_is_open'

  union all
  select 10, 'anon can execute component_is_open',
         case when exists (select 1 from anon_functions where f = 'component_is_open')
              then 'PASS' else 'FAIL' end,
         'needed so a visitor can see whether registration is open'

  union all
  select 11, 'Submitted answers cannot be edited or deleted',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'no UPDATE or DELETE offered on any submission table'
              else 'MUTABLE: ' || string_agg(rel || ' (' || array_to_string(privs, '+') || ')', ', ') end
    from mutable_submissions where cardinality(privs) > 0

  union all
  select 12, 'Nobody can insert themselves into admins',
         case when not exists (select 1 from pg_policies
                                where schemaname = 'public' and tablename = 'admins'
                                  and cmd in ('INSERT','ALL'))
              then 'PASS' else 'FAIL' end,
         'admin rights must be granted from the SQL editor only'

  union all
  select 13, 'Participant-code sequence exists',
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'S'
                              and c.relname = 'participant_code_seq')
              then 'PASS' else 'FAIL' end,
         'participant_code_seq issues CP-0001, CP-0002, …'

  union all
  select 14, 'Participant-code trigger exists',
         case when exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                            join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relname = 'participants'
                              and tg.tgname = 'participants_assign_code' and not tg.tgisinternal)
              then 'PASS' else 'FAIL' end,
         'without this the server does not issue codes'

  union all
  select 15, 'Participant-code immutability trigger exists',
         case when exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                            join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relname = 'participants'
                              and tg.tgname = 'participants_protect_identity' and not tg.tgisinternal)
              then 'PASS' else 'FAIL' end,
         'without this a learner could change their own code'

  union all
  select 16, 'Signup trigger on auth.users exists',
         case when exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                            join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'auth' and c.relname = 'users'
                              and tg.tgname = 'on_auth_user_created' and not tg.tgisinternal)
              then 'PASS' else 'FAIL' end,
         'without this a new account never gets a participant row'

  union all
  select 17, 'Admin views run with the caller''s privileges',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'security_invoker=on on all admin views'
              else 'NOT security_invoker: ' || string_agg(v, ', ')
                   || ' — these views would bypass Row Level Security' end
    from have_views
   where v like 'v_%'
     and not coalesce(array_to_string(reloptions, ',') like '%security_invoker=on%', false)

  union all
  select 18, 'Settings row exists',
         case when (select count(*) from public.app_settings) = 1 then 'PASS' else 'FAIL' end,
         'app_settings holds ' || (select count(*)::text from public.app_settings)
         || ' row(s); exactly 1 is expected'

  union all
  select 19, 'Schedule has been published',
         case when (select count(*) from public.component_windows) > 0 then 'PASS' else 'WARN' end,
         case when (select count(*) from public.component_windows) > 0
              then (select count(*)::text from public.component_windows) || ' component window(s) stored'
              else 'none yet — sign in as an administrator and click '
                   || '"Publish schedule to server" (SETUP.md Part 9, step 5)' end

  union all
  select 20, 'At least one administrator exists',
         case when (select count(*) from public.admins) > 0 then 'PASS' else 'WARN' end,
         case when (select count(*) from public.admins) > 0
              then (select count(*)::text from public.admins) || ' administrator(s)'
              else 'none yet — register yourself, then run the INSERT at the '
                   || 'bottom of schema.sql (SETUP.md Part 9)' end
)

-- ----------------------------------------------------------------- output --
select seq as "#", check_name as "check", result, detail from checks
union all
select 99, '── OVERALL ──',
       case when exists (select 1 from checks where result = 'FAIL') then 'FAIL'
            when exists (select 1 from checks where result = 'WARN') then 'WARN'
            else 'PASS' end,
       case when exists (select 1 from checks where result = 'FAIL')
            then (select count(*)::text from checks where result = 'FAIL')
                 || ' check(s) FAILED — do not run a course on this database until they pass'
            when exists (select 1 from checks where result = 'WARN')
            then 'Schema is correct. Remaining WARNs are setup steps you have not done yet.'
            else 'Everything checks out. The database is ready.' end
order by 1;
