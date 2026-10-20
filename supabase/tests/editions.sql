-- Editions (one contest per way of taking part) and imports that keep the organiser's data.
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

-- As the owner: an online edition of SFMO 2027 in the same organisation.
insert into contests (id, org_id, name, short_name, slug, registration) values
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-000000000001', 'San Francisco Math Open 2027', 'SFMO 2027', 'sfmo-2027-online', '{"open": true, "coaches": false, "team_min": 1, "team_max": 4}');
insert into divisions (id, contest_id, name, mode) values ('30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-0000000000e2', 'Online', 'online');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'existing.coach@x');
set client_min_messages = notice;

set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select link_editions('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e2')$$, 'Only the organisers', 'a coach cannot link contests');

select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select link_editions('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e2');
select pg_temp.expect((select linked_id from contests where id = '20000000-0000-0000-0000-000000000001') = '20000000-0000-0000-0000-0000000000e2'
  and (select linked_id from contests where id = '20000000-0000-0000-0000-0000000000e2') = '20000000-0000-0000-0000-000000000001', 'linking makes each contest the other''s edition');

select pg_temp.expect(cardinality(import_team_rows('20000000-0000-0000-0000-0000000000e2', '[
  {"mode": "online", "team": {"name": "Deep Field", "contact_name": "T R", "contact_email": "existing.coach@x", "code": "k7", "external_id": "form-41"},
   "students": [{"name": "Ana", "grade": 9, "waiver_signed_by": "Collected on the old form"}, {"name": "Ben", "grade": 9, "external_id": "old-17"}]},
  {"mode": "online", "team": {"name": "Brine Pool", "contact_name": "A B", "contact_email": "later.coach@x"}, "students": [{"name": "Cy"}]}
]', 'confirmed')) = 2, 'an import hands back the new teams'' ids');
select pg_temp.expect((select code from teams where name = 'Deep Field') = 'K7', 'an imported team keeps its own number');
select pg_temp.expect((select public_id from competitors where name = 'Ana') = 'K7A', 'its students'' IDs follow that number');
select pg_temp.expect((select waiver_signed_by from competitors where name = 'Ana') = 'Collected on the old form'
  and (select waiver_signed_at from competitors where name = 'Ana') is not null
  and (select waiver_signed_at from competitors where name = 'Ben') is null, 'a waiver collected elsewhere arrives signed, the others do not');
select pg_temp.expect((select external_id from competitors where name = 'Ben') = 'old-17' and (select external_id from teams where name = 'Deep Field') = 'form-41', 'IDs from the old system are kept');
select pg_temp.expect((select coach_id from teams where name = 'Deep Field') = '00000000-0000-0000-0000-0000000000e1', 'a coach who already has an account is linked by email');
select pg_temp.refused($$select import_team_rows('20000000-0000-0000-0000-0000000000e2', '[{"mode": "online", "team": {"name": "Other", "contact_email": "o@x", "code": "K7"}, "students": [{"name": "Z"}]}]')$$, 'already taken', 'a team number cannot be used twice');
select pg_temp.refused($$select import_team_rows('20000000-0000-0000-0000-0000000000e2', '[{"mode": "online", "team": {"name": "deep field", "contact_email": "o@x"}, "students": [{"name": "Z"}]}]')$$, 'already registered', 'a duplicate name is refused unless asked for');
select pg_temp.expect(cardinality(import_team_rows('20000000-0000-0000-0000-0000000000e2', '[{"mode": "online", "team": {"name": "Deep Field", "contact_email": "o@x", "allow_duplicate": true}, "students": [{"name": "Z"}]}]')) = 1, 'a duplicate the organiser chose to keep comes in');
select pg_temp.refused($$select import_team_rows('20000000-0000-0000-0000-0000000000e2', '[{"mode": "in_person", "team": {"name": "Wrong", "contact_email": "o@x"}, "students": [{"name": "Z"}]}]')$$, 'no in person places', 'an online edition takes no in-person teams');

select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select register_team('20000000-0000-0000-0000-0000000000e2', 'online', '{"name": "Mine", "contact_email": "c@x"}', '[{"name": "Q"}]')$$, 'organisers enter every team', 'coaches cannot register where the organisers run everything');

reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'later.coach@x');
select pg_temp.expect((select coach_id from teams where name = 'Brine Pool') = '00000000-0000-0000-0000-0000000000e3', 'a coach who signs up later is linked to the teams imported with their email');

\echo ALL EDITION CHECKS PASSED
