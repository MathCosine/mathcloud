-- What anyone may see without signing in, and waivers where the organisers enter every team.
-- Runs last, on the contest the other tests seeded.
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
set client_min_messages = notice;

-- Signed out.
set role anon;
select pg_temp.become('');
select pg_temp.expect((select count(*) from public_guts_board('sfmo-2027')) > 0, 'anyone can see the live Guts leaderboard');
select pg_temp.expect((select count(*) from public_guts_board('sfmo-2027') where name is null or code is null) = 0, 'it shows team names and numbers');
select pg_temp.refused($$select count(*) from results$$, 'permission denied', 'nobody signed out can read results at all');
select pg_temp.expect((select count(*) from competitors) = 0, 'or any student');
select pg_temp.expect((select count(*) from responses) = 0 and (select count(*) from answer_keys) = 0, 'or any answer or key');
select pg_temp.refused($$select guts_board('40000000-0000-0000-0000-000000000002')$$, 'not in this contest', 'the full board (with team ids and set times) is for people in the contest');

-- The public board matches the organisers' own, team by team.
reset role;
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect(not exists (
  select 1 from guts_board('40000000-0000-0000-0000-000000000002') g
  full join public_guts_board('sfmo-2027') p on p.code = g.code
  where g.score is distinct from p.score
), 'the public scores are the organisers'' scores');

reset role;
update contests set details = details || '{"public_board": false}' where id = '20000000-0000-0000-0000-000000000001';
set role anon;
select pg_temp.expect((select count(*) from public_guts_board('sfmo-2027')) = 0, 'the organisers can turn the public board off');
reset role;
update contests set details = details - 'public_board' where id = '20000000-0000-0000-0000-000000000001';

-- Organisers enter every team: no waiver links, no signing.
update contests set registration = registration || '{"coaches": false}' where id = '20000000-0000-0000-0000-000000000001';
set role anon;
select pg_temp.expect((select count(*) from waiver_info('tok-16c')) = 0, 'a waiver link shows nothing when the organisers collect waivers');
select pg_temp.refused($$select sign_waiver('tok-16c', 'Somebody Real')$$, 'expired', 'and cannot be signed');
reset role;
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused($$select waiver_token('70000000-0000-0000-0000-00000000016c')$$, 'collected by the organisers', 'no waiver link is handed out');
reset role;
update competitors set waiver_signed_at = null where id = '70000000-0000-0000-0000-00000000016a';
update rounds set opened_at = now(), status = 'open' where id = '40000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.expect((select (start_attempt('40000000-0000-0000-0000-000000000001', 'Carter')).id) is not null, 'a student with no waiver on file can still start the test');
reset role;
update contests set registration = registration - 'coaches' where id = '20000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.refused($$select start_attempt('40000000-0000-0000-0000-000000000001', 'Carter')$$, 'waiver', 'where MathCloud collects waivers, the test still waits for one');
reset role;
update competitors set waiver_signed_at = now() where id = '70000000-0000-0000-0000-00000000016a';
select pg_temp.expect((select count(*) from waiver_tokens where token ~ '[+/]') = 0, 'waiver links are URL-safe');

\echo ALL PUBLIC CHECKS PASSED
