-- Plays each role against the schema and checks what it can and cannot do.
-- Run with scripts/test-db.sh. Any failed expectation stops the script.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Seed as the database owner. -----------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'director@x'),
  ('00000000-0000-0000-0000-0000000000a1', 'grader@x'),
  ('00000000-0000-0000-0000-0000000000b1', 'proctor@x'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach@x'),
  ('00000000-0000-0000-0000-000000000051', 'student-online@x'),
  ('00000000-0000-0000-0000-000000000052', 'student-inperson@x'),
  ('00000000-0000-0000-0000-0000000000ff', 'outsider@x');

insert into organizations (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'SF Math Initiative', 'sfmi');
insert into memberships values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'director');
insert into contests (id, org_id, name, short_name, slug) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'San Francisco Math Open 2027', 'SFMO 2027', 'sfmo-2027');
insert into divisions (id, contest_id, name, mode) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'In person', 'in_person'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Online', 'online');
insert into rounds (id, contest_id, name, kind, minutes, starts_at, status, opened_at, integrity) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Individual', 'individual', 60, now(), 'open', now(), '{"policy": "lock", "lock_after": 2}'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Guts', 'guts', 60, now(), 'open', now(), '{"policy": "log"}');
insert into problems (id, round_id, number, set_no, body) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, null, 'One'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 2, null, 'Two'),
  ('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000002', 1, 1, 'G1'),
  ('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000002', 2, 2, 'G2');
insert into answer_keys values ('50000000-0000-0000-0000-000000000001', '{8}'), ('50000000-0000-0000-0000-000000000002', '{9}');
insert into teams (id, contest_id, division_id, code, name, contact_name, contact_email, coach_id, status) values
  ('60000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '16', 'Sea Urchin Sums', 'Megan', 'megan@x', '00000000-0000-0000-0000-0000000000c1', 'confirmed'),
  ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '05', 'Coral Lemma', 'Hannah', 'hannah@x', null, 'confirmed');
insert into competitors (id, team_id, slot, public_id, name, user_id, guardian_name, guardian_email, waiver_signed_at) values
  ('70000000-0000-0000-0000-00000000016a', '60000000-0000-0000-0000-000000000016', 'A', '16A', 'Carter', '00000000-0000-0000-0000-000000000051', 'Megan', 'megan@x', now()),
  ('70000000-0000-0000-0000-00000000016c', '60000000-0000-0000-0000-000000000016', 'C', '16C', 'Jacob', null, 'Miriam', 'miriam@x', null),
  ('70000000-0000-0000-0000-00000000005a', '60000000-0000-0000-0000-000000000005', 'A', '05A', 'Hannah', '00000000-0000-0000-0000-000000000052', 'Joon', 'joon@x', now());
insert into contest_roles (contest_id, user_id, role, round_ids) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'grader', '{40000000-0000-0000-0000-000000000001}');
insert into zoom_rooms (contest_id, name, url, proctor_id, team_ids) values ('20000000-0000-0000-0000-000000000001', 'Room 1', 'https://zoom.us/j/1', '00000000-0000-0000-0000-0000000000b1', '{60000000-0000-0000-0000-000000000016}');
update waiver_tokens set token = 'tok-16c' where competitor_id = '70000000-0000-0000-0000-00000000016c';  -- made by the trigger

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;
create or replace function pg_temp.become(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false);
$$;
set client_min_messages = notice;

-- Student, online ----------------------------------------------------
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.expect((select count(*) from answer_keys) = 0, 'a student cannot read the answer key');
select pg_temp.expect((select count(*) from problems) = 0, 'a student cannot read problems directly');
select pg_temp.expect((select count(*) from teams where code = '05') = 0, 'a student cannot see other teams');
select pg_temp.expect((select (start_attempt('40000000-0000-0000-0000-000000000001', 'Carter')).id) is not null, 'a student starts an open round');
select pg_temp.expect((select count(*) from round_problems((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'))) = 2, 'after starting, the student gets the problems');
select pg_temp.expect(save_response((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), '50000000-0000-0000-0000-000000000001', '8') is not null, 'an answer saves before the deadline');
select pg_temp.expect((select count(*) from responses) = 1, 'the student reads their own answer back');
do $$ begin
  insert into responses (attempt_id, problem_id, value) select id, '50000000-0000-0000-0000-000000000002', '9' from attempts limit 1;
  raise exception 'FAILED: direct insert into responses was allowed';
exception when insufficient_privilege then raise notice 'ok  a student cannot write answers except through save_response';
end $$;

-- Integrity: two exits lock the test under the 'lock' policy.
select pg_temp.expect(log_integrity_event((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), 'blur', 3000) = 'warn', 'first exit warns');
select pg_temp.expect(log_integrity_event((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), 'hidden', 9000) = 'lock', 'second exit locks the test');
do $$ begin
  perform save_response((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), '50000000-0000-0000-0000-000000000002', '9');
  raise exception 'FAILED: saved while locked';
exception when others then if sqlerrm not like '%locked%' then raise; end if; raise notice 'ok  a locked test refuses answers';
end $$;
do $$ begin
  perform set_attempt_lock((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), false);
  raise exception 'FAILED: student unlocked themself';
exception when others then if sqlerrm not like '%proctor%' then raise; end if; raise notice 'ok  a student cannot unlock themself';
end $$;

-- Proctor of the room unlocks.
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) from integrity_events) >= 3, 'the proctor sees the integrity log for their room');
select set_attempt_lock((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), false);
select pg_temp.expect((select count(*) from competitors) = 0, 'a proctor cannot read competitors’ contact details');

-- Back to the student: saving works again; after the deadline it does not.
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.expect(save_response((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), '50000000-0000-0000-0000-000000000002', '9') is not null, 'after unlocking, answers save again');
reset role;
update attempts set deadline = now() - interval '5 minutes';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000051');
do $$ begin
  perform save_response((select id from attempts where competitor_id = '70000000-0000-0000-0000-00000000016a'), '50000000-0000-0000-0000-000000000002', '7');
  raise exception 'FAILED: saved after the deadline';
exception when others then if sqlerrm not like '%Time is up%' then raise; end if; raise notice 'ok  the database clock refuses a late answer';
end $$;

-- Guts: only the current set is served and writable.
select (start_attempt('40000000-0000-0000-0000-000000000002', 'Carter')).id is not null as started_guts \gset
select pg_temp.expect((select count(*) from round_problems((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016'))) = 1, 'guts serves only the first set');
do $$ begin
  perform save_response((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016'), '50000000-0000-0000-0000-000000000012', '1');
  raise exception 'FAILED: answered a later guts set';
exception when others then if sqlerrm not like '%set is closed%' then raise; end if; raise notice 'ok  a later guts set cannot be answered early';
end $$;
select submit_guts_set((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016'));
select pg_temp.expect((select count(*) from round_problems((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016'))) = 2, 'handing in a set reveals the next');

-- Student in person cannot start online.
select pg_temp.become('00000000-0000-0000-0000-000000000052');
do $$ begin
  perform start_attempt('40000000-0000-0000-0000-000000000001', 'Hannah');
  raise exception 'FAILED: in-person student started online';
exception when others then if sqlerrm not like '%paper%' then raise; end if; raise notice 'ok  in-person competitors cannot start online';
end $$;

-- Coach ----------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect((select count(*) from competitors) = 2, 'a coach sees their own students only');
select pg_temp.expect((select count(*) from teams) = 1, 'a coach sees their own team only');
do $$ begin
  perform save_response((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016'), '50000000-0000-0000-0000-000000000012', '1');
  raise exception 'FAILED: coach answered';
exception when others then if sqlerrm not like '%Coaches cannot%' then raise; end if; raise notice 'ok  a coach cannot answer for students';
end $$;

-- Grader ---------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from competitors) = 0, 'a grader cannot read the roster or contacts');
select pg_temp.expect((select count(*) from grader_roster('40000000-0000-0000-0000-000000000001')) = 1, 'a grader gets in-person names and IDs only');
select pg_temp.expect((select count(*) from answer_keys) = 2, 'a grader reads the key for their round');
select save_paper_sheet('40000000-0000-0000-0000-000000000001', '05a', '{"50000000-0000-0000-0000-000000000001": "8", "50000000-0000-0000-0000-000000000002": ""}'::jsonb);
select pg_temp.expect((select count(*) from responses r join attempts a on a.id = r.attempt_id where a.competitor_id = '70000000-0000-0000-0000-00000000005a') = 1, 'a keyed sheet saves, blanks left out');
do $$ begin
  perform save_paper_sheet('40000000-0000-0000-0000-000000000002', '05', '{}'::jsonb);
  raise exception 'FAILED: grader keyed an unassigned round';
exception when others then if sqlerrm not like '%not grading%' then raise; end if; raise notice 'ok  a grader cannot key a round they are not assigned';
end $$;
do $$ begin
  perform set_ruling('50000000-0000-0000-0000-000000000001', '0.5', true);
  raise exception 'FAILED: grader ruled';
exception when others then if sqlerrm not like '%director%' then raise; end if; raise notice 'ok  only a director rules on answers';
end $$;

-- Director -------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect((select count(*) from competitors) = 3, 'the director sees the whole roster');
select set_ruling('50000000-0000-0000-0000-000000000001', '0.5', false);
select pg_temp.expect((select count(*) from rulings) = 1, 'the director rules on an answer');

-- Outsider -------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000ff');
select pg_temp.expect((select count(*) from teams) = 0 and (select count(*) from attempts) = 0, 'someone outside the contest sees nothing private');
do $$ begin
  perform start_attempt('40000000-0000-0000-0000-000000000001', 'Nobody');
  raise exception 'FAILED: outsider started';
exception when others then if sqlerrm not like '%not registered%' then raise; end if; raise notice 'ok  an unregistered user cannot start a test';
end $$;

-- Signed out: public schedule, guardian waiver link -----------------------
reset role;
set role anon;
select pg_temp.become('');
select pg_temp.expect((select count(*) from contests) = 1, 'the public sees the contest');
select pg_temp.expect((select count(*) from teams) = 0 and (select count(*) from competitors) = 0, 'the public sees no roster');
select pg_temp.expect(sign_waiver('tok-16c', 'Miriam Klein') = '16C', 'a guardian signs from the emailed link without an account');
reset role;
select pg_temp.expect((select waiver_signed_by from competitors where public_id = '16C') = 'Miriam Klein', 'the signature is stored');
\echo ALL CHECKS PASSED
