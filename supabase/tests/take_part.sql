-- In person or online: who may choose, who may switch, who may import.
-- Runs after rules.sql, on the same seeded contest.
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

-- As the owner: a venue room and a day plan.
insert into venue_rooms (contest_id, name) values ('20000000-0000-0000-0000-000000000001', 'Room 204');
insert into agenda_items (contest_id, at, title, modes, place) values
  ('20000000-0000-0000-0000-000000000001', now(), 'Check-in', '{in_person}', 'Lobby'),
  ('20000000-0000-0000-0000-000000000001', now(), 'Join your Zoom room', '{online}', null);
set client_min_messages = notice;

-- The coach registers while registration is closed, then open. ----------
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select register_team('20000000-0000-0000-0000-000000000001', 'online', '{"name": "Isosceles Owls"}', '[{"name": "Rosa"}]')$$, 'Registration is closed', 'nobody registers while registration is closed');

reset role;
update contests set registration = registration || '{"open": true}' where id = '20000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect(register_team('20000000-0000-0000-0000-000000000001', 'online',
  '{"name": "Isosceles Owls", "contact_name": "Megan", "contact_email": "megan@x", "time_zone": "America/Chicago"}',
  '[{"name": "Rosa", "grade": 9, "guardian_email": "r@x"}, {"name": "Theo", "grade": 8, "guardian_email": "t@x"}]') is not null, 'a coach registers a team online');
select pg_temp.expect((select code from teams where name = 'Isosceles Owls') = '17', 'it gets the next team code');
select pg_temp.expect((select string_agg(public_id, ',' order by public_id) from competitors c join teams t on t.id = c.team_id where t.name = 'Isosceles Owls') = '17A,17B', 'its students get competitor IDs');
select pg_temp.expect((select status from teams where name = 'Isosceles Owls') = 'pending', 'a registration waits for the organisers');
select pg_temp.expect((select time_zone from teams where name = 'Isosceles Owls') = 'America/Chicago', 'an online team keeps its time zone');
select pg_temp.expect(exists (select 1 from zoom_rooms z join teams t on t.id = any (z.team_ids) where t.name = 'Isosceles Owls'), 'an online team is put in a Zoom room');
select pg_temp.refused($$select register_team('20000000-0000-0000-0000-000000000001', 'online', '{"name": "Too Many"}', '[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"},{"name":"e"}]')$$, 'Teams have', 'a team over the size limit is refused');
select pg_temp.refused($$select register_team('20000000-0000-0000-0000-000000000001', 'online', '{"name": "isosceles owls"}', '[{"name":"a"}]')$$, 'already registered', 'the same team name twice is refused');

-- Switching. ---------------------------------------------------------
select set_team_mode((select id from teams where name = 'Isosceles Owls'), 'in_person');
select pg_temp.expect((select d.mode from teams t join divisions d on d.id = t.division_id where t.name = 'Isosceles Owls') = 'in_person', 'the coach switches the team to in person');
select pg_temp.expect(exists (select 1 from venue_rooms v join teams t on t.id = any (v.team_ids) where t.name = 'Isosceles Owls'), 'it moves into a room at the venue');
select pg_temp.expect(not exists (select 1 from zoom_rooms z join teams t on t.id = any (z.team_ids) where t.name = 'Isosceles Owls'), 'and out of its Zoom room');
select pg_temp.expect((select count(*) from venue_rooms) = 1, 'the coach sees the venue room their team is in');

reset role;
update contests set registration = registration || '{"open": false}' where id = '20000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select set_team_mode((select id from teams where name = 'Isosceles Owls'), 'online')$$, 'Registration has closed', 'after registration closes the coach cannot switch');
select pg_temp.become('00000000-0000-0000-0000-0000000000ff');
select pg_temp.refused($$select set_team_mode('60000000-0000-0000-0000-000000000016', 'in_person')$$, 'Only the coach', 'nobody else can move a team');
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select set_team_mode((select id from teams where name = 'Isosceles Owls'), 'online');
select pg_temp.expect((select d.mode from teams t join divisions d on d.id = t.division_id where t.name = 'Isosceles Owls') = 'online', 'the organisers can still move a team after the deadline');

-- Importing. ---------------------------------------------------------
select pg_temp.expect(import_teams('20000000-0000-0000-0000-000000000001', '[
  {"mode": "in_person", "team": {"name": "Angle Fish", "contact_email": "d@x"}, "students": [{"name": "Iris"}, {"name": "Leo"}]},
  {"mode": "online", "team": {"name": "Pi Rates", "contact_email": "s@x"}, "students": [{"name": "Jin"}]}
]') = 2, 'the organisers import two teams');
select pg_temp.expect((select string_agg(code || ':' || status, ',' order by code) from teams where name in ('Angle Fish', 'Pi Rates')) = '18:confirmed,19:confirmed', 'imported teams get codes and are confirmed');
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select import_teams('20000000-0000-0000-0000-000000000001', '[]')$$, 'Only the organisers', 'a coach cannot import');
select pg_temp.refused($$select add_team('20000000-0000-0000-0000-000000000001', 'online', '{"name": "Sneaky"}', '[{"name": "x"}]', 'confirmed', null)$$, 'permission denied', 'nobody calls add_team directly');

-- Device checks. ------------------------------------------------------
select pg_temp.become('00000000-0000-0000-0000-000000000051');
select pg_temp.expect(mark_device_check('70000000-0000-0000-0000-00000000016a') is not null, 'a student marks their own device check');
select pg_temp.refused($$select mark_device_check('70000000-0000-0000-0000-00000000005a')$$, 'your own device', 'not anyone else''s');

-- The public sees the schedule, not the rooms. --------------------------
reset role;
set role anon;
select pg_temp.become('');
select pg_temp.expect((select count(*) from agenda_items) = 2, 'the public sees the day plan');
reset role;
\echo ALL TAKE-PART CHECKS PASSED
