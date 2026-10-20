-- The app's additions: the live board, joining a team, results, email keys, profiles.
-- Runs after rules.sql and take_part.sql, on the same seeded contest.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;
create or replace function pg_temp.become(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false);
$$;
create or replace function pg_temp.refused(sql text, needle text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED: % (it was allowed)', what;
exception when others then
  if sqlerrm like 'FAILED:%' or sqlerrm not like '%' || needle || '%' then raise; end if;
  raise notice 'ok  %', what;
end $$;

-- As the owner: Guts problems with keys, a student who will join by code, names.
insert into answer_keys (problem_id, accepted, normalized) values
  ('50000000-0000-0000-0000-000000000011', '{4}', '{4}'),
  ('50000000-0000-0000-0000-000000000012', array['\frac{1}{2}'], '{1/2}')
on conflict (problem_id) do update set normalized = excluded.normalized;
update problems set points = 5 where id = '50000000-0000-0000-0000-000000000011';
update problems set points = 7 where id = '50000000-0000-0000-0000-000000000012';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000053', 'new-student@x', '{"name": "Rosa Lin"}'),
  ('00000000-0000-0000-0000-000000000054', 'managed@students.mathcloud.app', '{"name": "Theo", "username": "sfmo-17b", "managed": true}');
update contests set board = '{"freeze_minutes": 0, "revealed": false}' where id = '20000000-0000-0000-0000-000000000001';
set client_min_messages = notice;
select pg_temp.expect((select name from profiles where id = '00000000-0000-0000-0000-000000000053') = 'Rosa Lin', 'a new sign-in gets a profile with its name');
select pg_temp.expect((select username from profiles where id = '00000000-0000-0000-0000-000000000054') = 'sfmo-17b' and (select managed from profiles where id = '00000000-0000-0000-0000-000000000054'), 'a managed account keeps its username');

-- The online student plays Guts; the grader keys a paper team. ------------
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000051');
-- rules.sql already started Guts for team 16 and handed in set 1 blank.
select save_response((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002'), '50000000-0000-0000-0000-000000000012', ' \dfrac12 ', '1/2');
select pg_temp.expect(submit_guts_set((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002')) = 2, 'the online team hands in set 2');
select pg_temp.expect((select cardinality(set_times) from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002') = 2, 'each set''s time is kept for the board');
select pg_temp.expect(submit_guts_set((select id from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002'), 2) = 2, 'a teammate pressing "hand in set 2" again changes nothing');
select pg_temp.expect((select sets_submitted from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002') = 2
  and (select cardinality(set_times) from attempts where team_id = '60000000-0000-0000-0000-000000000016' and round_id = '40000000-0000-0000-0000-000000000002') = 2, 'so set 3 is not handed in empty');

reset role;
insert into contest_roles (contest_id, user_id, role, round_ids) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'grader', '{40000000-0000-0000-0000-000000000002}')
on conflict (contest_id, user_id, role) do update set round_ids = contest_roles.round_ids || excluded.round_ids;
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect(save_paper_guts_set('40000000-0000-0000-0000-000000000002', '05', 1, '{"50000000-0000-0000-0000-000000000011": "4"}', '{"50000000-0000-0000-0000-000000000011": "4"}') = 1, 'a grader keys set 1 of a paper team');
select pg_temp.expect(save_paper_guts_set('40000000-0000-0000-0000-000000000002', '05', 2, '{"50000000-0000-0000-0000-000000000012": "0.5"}', '{"50000000-0000-0000-0000-000000000012": "0.5"}') = 2, 'and set 2');
select pg_temp.expect((select sets_submitted from attempts where team_id = '60000000-0000-0000-0000-000000000005' and round_id = '40000000-0000-0000-0000-000000000002') = 2, 'keying set 2 counts sets 1 and 2 as in');

-- The board, as a student on another team. -------------------------------
select pg_temp.become('00000000-0000-0000-0000-000000000052');
select pg_temp.expect((select score from guts_board('40000000-0000-0000-0000-000000000002') where team_id = '60000000-0000-0000-0000-000000000016') = 7, 'a student sees another team''s score: 7 for a blank set 1 and a correct set 2');
select pg_temp.expect((select score from guts_board('40000000-0000-0000-0000-000000000002') where team_id = '60000000-0000-0000-0000-000000000005') = 5, 'their own team: 5, because 0.5 is not the key 1/2 until someone rules');
reset role;
insert into rulings (problem_id, normalized, correct) values ('50000000-0000-0000-0000-000000000012', '0.5', true);
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000052');
select pg_temp.expect((select score from guts_board('40000000-0000-0000-0000-000000000002') where team_id = '60000000-0000-0000-0000-000000000005') = 12, 'after a ruling, it counts');
select pg_temp.expect((select count(*) from responses r join attempts a on a.id = r.attempt_id where a.team_id = '60000000-0000-0000-0000-000000000016') = 0, 'the board never shows another team''s answers');

reset role;
update rounds set opened_at = now() - interval '55 minutes' where id = '40000000-0000-0000-0000-000000000002';
update contests set board = '{"freeze_minutes": 10, "revealed": false}' where id = '20000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000052');
select pg_temp.expect((select bool_and(frozen) and sum(sets) = 0 from guts_board('40000000-0000-0000-0000-000000000002')), 'when frozen, sets handed in after the freeze do not show');
select pg_temp.become('00000000-0000-0000-0000-0000000000ff');
select pg_temp.refused($$select * from guts_board('40000000-0000-0000-0000-000000000002')$$, 'not in this contest', 'someone outside the contest cannot see the board');

-- Joining by code. ------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-000000000053');
select pg_temp.refused($$select join_team('NOPE00', 'Rosa Lin')$$, 'No team has that code', 'a wrong code is refused');
reset role;
update teams set join_code = 'SF16X2' where id = '60000000-0000-0000-0000-000000000016';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000053');
select pg_temp.expect(join_team('sf16x2', 'Rosa Lin', 9, 'p@x') is not null, 'a student joins with the team code');
select pg_temp.expect((select public_id from competitors where user_id = '00000000-0000-0000-0000-000000000053') = '16B', 'and takes the first free letter');
select pg_temp.refused($$select join_team('SF16X2', 'Rosa Lin')$$, 'already on a team', 'nobody joins twice');

-- Coaches add students; teams fill up. ------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect(add_competitor('60000000-0000-0000-0000-000000000016', 'Priya Das', 8, 'Anil Das', 'a@x') is not null, 'a coach adds a student');
select pg_temp.expect((select public_id from competitors where name = 'Priya Das') = '16D', 'who gets the next letter');
select pg_temp.refused($$select add_competitor('60000000-0000-0000-0000-000000000016', 'Fifth', 8, null, null)$$, 'The team is full', 'a full team takes nobody else');
select pg_temp.expect(waiver_token((select id from competitors where name = 'Priya Das')) is not null, 'every new student has a waiver link');
select pg_temp.become('00000000-0000-0000-0000-000000000052');
select pg_temp.refused($$select add_competitor('60000000-0000-0000-0000-000000000016', 'Intruder', 8, null, null)$$, 'No such team', 'a student cannot add to another team');

-- Results. ------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect(publish_results('20000000-0000-0000-0000-000000000001', '[
  {"competitor_id": "70000000-0000-0000-0000-00000000016a", "data": {"score": 2, "place": 1}},
  {"competitor_id": "70000000-0000-0000-0000-00000000005a", "data": {"score": 1, "place": 2}},
  {"team_id": "60000000-0000-0000-0000-000000000016", "data": {"total": 30}}
]') = 3, 'the director publishes results');
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.expect((select count(*) from results where competitor_id is not null) = 1, 'a student sees only their own result');
select pg_temp.expect((select count(*) from results where team_id is not null) = 1, 'and their team''s');
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect((select count(*) from results) = 2, 'the coach sees their students'' and team''s results');
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.refused($$select publish_results('20000000-0000-0000-0000-000000000001', null)$$, 'Only a director', 'a student cannot publish');

-- Email keys and the queue. -----------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect(add_email_key('10000000-0000-0000-0000-000000000001', 'Resend 1', 'SFMO <hi@sfmo.org>', 100, 're_1234567890') is not null, 'a director adds a sending key');
select pg_temp.expect((select count(*) from email_keys) = 1, 'and sees its label and limit');
select pg_temp.refused($$select * from email_key_secrets$$, 'permission denied', 'but never the key itself');
select pg_temp.expect(queue_emails('20000000-0000-0000-0000-000000000001', 'score_report', null, '[{"to": "A@x", "subject": "s", "html": "h"}, {"to": "b@x", "subject": "s", "html": "h"}]') = 2, 'messages are queued');
select pg_temp.expect(queue_emails('20000000-0000-0000-0000-000000000001', 'score_report', null, '[{"to": "a@x", "subject": "s", "html": "h"}]') = 0, 'the same message twice is queued once');
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select add_email_key('10000000-0000-0000-0000-000000000001', 'x', 'x', 1, 'secretsecret')$$, 'Only a director', 'a coach cannot add a key');
select pg_temp.expect((select count(*) from email_keys) = 0, 'or see them');

-- Names without contacts. ----------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from grader_people('20000000-0000-0000-0000-000000000001') where kind = 'competitor') >= 4, 'a grader gets every competitor''s name and ID');
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) from grader_people('20000000-0000-0000-0000-000000000001') where code = '16') = 1 and (select count(*) from grader_people('20000000-0000-0000-0000-000000000001') where code = '05') = 0, 'a proctor gets the teams in their Zoom room and no others');
select pg_temp.become('00000000-0000-0000-0000-0000000000ff');
select pg_temp.refused($$select * from grader_people('20000000-0000-0000-0000-000000000001')$$, 'not working on this contest', 'someone with no role in the contest gets nothing');

-- Profiles. ------------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-000000000053');
select pg_temp.expect((select count(*) from profiles where id = '00000000-0000-0000-0000-000000000054') = 0, 'students cannot see strangers'' profiles');
reset role;
\echo ALL APP CHECKS PASSED
