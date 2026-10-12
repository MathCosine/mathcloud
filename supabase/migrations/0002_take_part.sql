-- How each team takes part: in person or online.
--
-- A contest offers one or both (its divisions say which). A coach chooses
-- one when registering and can switch while registration is open; after
-- that only the organisers can move a team. Teams that signed up somewhere
-- else come in through import_teams. Every way in goes through add_team, so
-- codes, competitor IDs and room places follow the same rules.
--
-- Safe to run twice.

alter table public.contests    add column if not exists venue jsonb;               -- {name, address, hall, bring[]}
alter table public.teams       add column if not exists time_zone text;            -- online teams: the clock their students see
alter table public.teams       add column if not exists notes text;                -- in person: allergies, access needs
alter table public.competitors add column if not exists device_checked_at timestamptz;

-- Rooms at the venue. In-person teams sit in one for the individual-style rounds.
create table if not exists public.venue_rooms (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references public.contests (id) on delete cascade,
  name        text not null,
  team_ids    uuid[] not null default '{}'
);

-- The day, beyond the rounds: check-in, lunch, awards, and where each happens for each mode.
create table if not exists public.agenda_items (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references public.contests (id) on delete cascade,
  at          timestamptz not null,
  title       text not null,
  round_id    uuid references public.rounds (id) on delete cascade,
  modes       text[] not null check (cardinality(modes) > 0 and modes <@ array['in_person', 'online']),
  place       text,   -- 'room' (the team's room), 'hall' (the venue's hall), or a place name
  note        text
);

alter table public.venue_rooms  enable row level security;
alter table public.agenda_items enable row level security;

drop policy if exists venue_room_read on public.venue_rooms;
create policy venue_room_read on public.venue_rooms for select to authenticated
  using (public.contest_staff(contest_id) or exists (select 1 from unnest(team_ids) t where public.on_team(t)));
drop policy if exists venue_room_write on public.venue_rooms;
create policy venue_room_write on public.venue_rooms for all to authenticated
  using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));

-- The schedule is public, like the contest itself.
drop policy if exists agenda_public on public.agenda_items;
create policy agenda_public on public.agenda_items for select to anon, authenticated using (true);
drop policy if exists agenda_write on public.agenda_items;
create policy agenda_write on public.agenda_items for all to authenticated
  using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));

grant select on public.venue_rooms, public.agenda_items to anon, authenticated;
grant insert, update, delete on public.venue_rooms, public.agenda_items to authenticated;

-- ------------------------------------------------------------------ rooms

/** Put a team in the emptiest room for how it takes part, and out of every other. */
create or replace function public.place_team(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t teams;
  m text;
begin
  select * into t from teams where id = p_team;
  select mode into m from divisions where id = t.division_id;
  update zoom_rooms set team_ids = array_remove(team_ids, p_team) where contest_id = t.contest_id and p_team = any (team_ids);
  update venue_rooms set team_ids = array_remove(team_ids, p_team) where contest_id = t.contest_id and p_team = any (team_ids);
  if t.status = 'withdrawn' then return; end if;
  if m = 'online' then
    update zoom_rooms set team_ids = team_ids || p_team
      where id = (select id from zoom_rooms where contest_id = t.contest_id order by cardinality(team_ids), name limit 1);
  else
    update venue_rooms set team_ids = team_ids || p_team
      where id = (select id from venue_rooms where contest_id = t.contest_id order by cardinality(team_ids), name limit 1);
  end if;
end $$;

-- ---------------------------------------------------------- adding a team

/**
 * The one way a team is created. p_team: {name, school, city, contact_name,
 * contact_email, time_zone, notes}. p_students: [{name, grade, guardian_name,
 * guardian_email}]. Not callable directly; register_team and import_teams
 * decide who may call it.
 */
create or replace function public.add_team(p_contest uuid, p_mode text, p_team jsonb, p_students jsonb, p_status text, p_coach uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c contests;
  d uuid;
  n integer := jsonb_array_length(coalesce(p_students, '[]'::jsonb));
  lo integer;
  hi integer;
  next_code text;
  tid uuid;
  s jsonb;
  i integer := 0;
begin
  select * into c from contests where id = p_contest;
  if c.id is null then raise exception 'No such contest.'; end if;
  select id into d from divisions where contest_id = p_contest and mode = p_mode;
  if d is null then raise exception 'This contest has no % places.', replace(p_mode, '_', ' '); end if;
  if coalesce(trim(p_team ->> 'name'), '') = '' then raise exception 'A team needs a name.'; end if;
  lo := coalesce((c.registration ->> 'team_min')::integer, 1);
  hi := coalesce((c.registration ->> 'team_max')::integer, 4);
  if n < lo or n > hi then raise exception 'Teams have % to % students; this one has %.', lo, hi, n; end if;
  if exists (select 1 from teams where contest_id = p_contest and lower(name) = lower(trim(p_team ->> 'name'))) then
    raise exception 'A team called % is already registered.', trim(p_team ->> 'name');
  end if;

  -- One registration at a time per contest, so two never get the same code.
  perform pg_advisory_xact_lock(hashtext(p_contest::text));
  select lpad((coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::integer), 0) + 1)::text, 2, '0')
    into next_code from teams where contest_id = p_contest;

  insert into teams (contest_id, division_id, code, name, school, city, contact_name, contact_email, coach_id, status, time_zone, notes)
  values (p_contest, d, next_code, trim(p_team ->> 'name'), p_team ->> 'school', p_team ->> 'city',
          coalesce(p_team ->> 'contact_name', ''), coalesce(p_team ->> 'contact_email', ''), p_coach, p_status,
          case when p_mode = 'online' then p_team ->> 'time_zone' end,
          case when p_mode = 'in_person' then p_team ->> 'notes' end)
  returning id into tid;

  for s in select * from jsonb_array_elements(p_students) loop
    insert into competitors (team_id, slot, public_id, name, grade, guardian_name, guardian_email)
    values (tid, chr(65 + i), next_code || chr(65 + i), trim(s ->> 'name'), nullif(s ->> 'grade', '')::integer, s ->> 'guardian_name', s ->> 'guardian_email');
    i := i + 1;
  end loop;

  perform place_team(tid);
  return tid;
end $$;

/** A coach registers from the contest's form. They become the team's coach. */
create or replace function public.register_team(p_contest uuid, p_mode text, p_team jsonb, p_students jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to register a team.'; end if;
  if not coalesce((select (registration ->> 'open')::boolean from contests where id = p_contest), false) then
    raise exception 'Registration is closed.';
  end if;
  return add_team(p_contest, p_mode, p_team, p_students, 'pending', auth.uid());
end $$;

/**
 * The organisers bring in teams who signed up elsewhere. p_teams is an array
 * of {mode, team: {...}, students: [...]}. All or nothing: one bad row stops
 * the import, and the app shows every row before it calls this.
 */
create or replace function public.import_teams(p_contest uuid, p_teams jsonb, p_status text default 'confirmed')
returns integer language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  n integer := 0;
begin
  if not contest_director(p_contest) then raise exception 'Only the organisers can import teams.'; end if;
  if p_status not in ('pending', 'confirmed') then raise exception 'Imported teams are pending or confirmed.'; end if;
  for t in select * from jsonb_array_elements(p_teams) loop
    perform add_team(p_contest, t ->> 'mode', t -> 'team', t -> 'students', p_status, null);
    n := n + 1;
  end loop;
  return n;
end $$;

/** Move a team between in person and online. The coach can while registration is open; the organisers always can. */
create or replace function public.set_team_mode(p_team uuid, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t teams;
  d uuid;
  director boolean;
begin
  select * into t from teams where id = p_team;
  if t.id is null then raise exception 'No such team.'; end if;
  director := contest_director(t.contest_id);
  if not director and t.coach_id is distinct from auth.uid() then raise exception 'Only the coach or the organisers can move a team.'; end if;
  if not director and not coalesce((select (registration ->> 'open')::boolean from contests where id = t.contest_id), false) then
    raise exception 'Registration has closed. Ask the organisers to move the team.';
  end if;
  select id into d from divisions where contest_id = t.contest_id and mode = p_mode;
  if d is null then raise exception 'This contest has no % places.', replace(p_mode, '_', ' '); end if;
  update teams set division_id = d where id = p_team;
  perform place_team(p_team);
end $$;

/** An online student marks their own device check done. */
create or replace function public.mark_device_check(p_competitor uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  stamp timestamptz := now();
begin
  update competitors set device_checked_at = stamp where id = p_competitor and user_id = auth.uid();
  if not found then raise exception 'You can only check your own device.'; end if;
  return stamp;
end $$;

-- Functions are executable by everyone unless revoked; these two are internal.
revoke execute on function public.place_team(uuid) from public, anon, authenticated;
revoke execute on function public.add_team(uuid, text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.register_team(uuid, text, jsonb, jsonb), public.import_teams(uuid, jsonb, text),
  public.set_team_mode(uuid, text), public.mark_device_check(uuid) to authenticated;
