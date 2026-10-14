-- What the app needs beyond the core rules: names and usernames, organisers
-- signing themselves up, Guts timing, a live board everyone may see, roster
-- helpers for coaches and students, published results, and email sent
-- through a pool of provider keys.
--
-- Safe to run twice.

-- ===========================================================================
-- People
-- ===========================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  -- Managed accounts (students too young for email) sign in with this.
  username    text unique check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,40}$'),
  managed     boolean not null default false,
  created_at  timestamptz not null default now()
);
-- A copy of the sign-in email, so organisers can see who their graders and coaches are.
alter table public.profiles add column if not exists email text;

/** Every new sign-in gets a profile, named from what the sign-up form sent. */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, username, managed, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    coalesce((new.raw_user_meta_data ->> 'managed')::boolean, false),
    case when coalesce((new.raw_user_meta_data ->> 'managed')::boolean, false) then null else new.email end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

/** May the caller see this person's name? Yes if they share an organisation, a contest they run, or a team. */
create or replace function public.person_visible(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid()
    or exists (select 1 from memberships a join memberships b on a.org_id = b.org_id where a.user_id = auth.uid() and b.user_id = p_user)
    or exists (select 1 from teams t where t.coach_id = p_user and (public.contest_staff(t.contest_id) or public.on_team(t.id)))
    or exists (select 1 from competitors c join teams t on t.id = c.team_id where c.user_id = p_user and (public.contest_staff(t.contest_id) or public.on_team(t.id)))
    or exists (select 1 from contest_roles r where r.user_id = p_user and (public.contest_staff(r.contest_id) or r.user_id = auth.uid()))
    or exists (select 1 from zoom_rooms z where z.proctor_id = p_user and exists (select 1 from unnest(z.team_ids) t where public.on_team(t)));
$$;

alter table public.profiles enable row level security;
drop policy if exists profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated using (public.person_visible(id));
drop policy if exists profile_write on public.profiles;
create policy profile_write on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

/** Anyone signed in can start an organisation, and runs it. */
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into organizations (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into o;
  insert into memberships (org_id, user_id, role) values (o, auth.uid(), 'owner');
  return o;
end $$;

-- ===========================================================================
-- Contest extras
-- ===========================================================================

alter table public.rounds      add column if not exists short_name text;
alter table public.contests    add column if not exists board jsonb not null default '{"freeze_minutes": 10, "revealed": false}'::jsonb;
alter table public.contests    add column if not exists date_label text;
alter table public.contests    add column if not exists certificate jsonb not null default '{}'::jsonb;
alter table public.activity    add column if not exists tone text not null default '';
alter table public.competitors add column if not exists reminder_sent_at timestamptz;
alter table public.attempts    add column if not exists set_times timestamptz[] not null default '{}';
-- What the student's browser made of the answer (spaces, \dfrac, a leading +
-- removed). Lets the database score the live board without its own copy of
-- the grading rules. Knowing the normalised key is knowing the answer, so a
-- forged value gains nothing.
alter table public.responses   add column if not exists normalized text;
alter table public.answer_keys add column if not exists normalized text[] not null default '{}';

-- ===========================================================================
-- Opening and closing rounds by the database clock
-- ===========================================================================

/** Open a round now, for every division at once. Reopening starts the online tests afresh. */
create or replace function public.open_round(p_round uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  r rounds;
begin
  select * into r from rounds where id = p_round for update;
  if r.id is null or not public.contest_director(r.contest_id) then raise exception 'Only a director can open a round.'; end if;
  delete from attempts where round_id = r.id and source = 'online';
  update rounds set status = 'open', opened_at = now() where id = r.id;
  if r.kind = 'guts' then
    update contests set board = board || '{"revealed": false}'::jsonb where id = r.contest_id;
  end if;
  return now();
end $$;

/** Close a round: every online test still open is handed in as it is. */
create or replace function public.close_round(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds;
begin
  select * into r from rounds where id = p_round for update;
  if r.id is null or not public.contest_director(r.contest_id) then raise exception 'Only a director can close a round.'; end if;
  update rounds set status = 'closed' where id = r.id;
  update attempts set submitted_at = now() where round_id = r.id and started_at is not null and submitted_at is null;
end $$;

-- ===========================================================================
-- Testing, again: save with the normalised value, Guts set times, paper Guts
-- ===========================================================================

drop function if exists public.save_response(uuid, uuid, text);
create or replace function public.save_response(p_attempt uuid, p_problem uuid, p_value text, p_normalized text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  p problems;
  r rounds;
  saved timestamptz;
begin
  select * into a from attempts where id = p_attempt for update;
  perform private_assert_can_write(a);
  select * into p from problems where id = p_problem and round_id = a.round_id;
  if p.id is null then raise exception 'No such problem.'; end if;
  select * into r from rounds where id = a.round_id;
  if r.kind = 'guts' and p.set_no <> a.sets_submitted + 1 then raise exception 'That set is closed.'; end if;
  insert into responses (attempt_id, problem_id, value, normalized, saved_at, saved_by)
  values (a.id, p.id, left(coalesce(p_value, ''), 120), left(p_normalized, 120), now(), auth.uid())
  on conflict (attempt_id, problem_id) do update
    set value = excluded.value, normalized = excluded.normalized, saved_at = excluded.saved_at, saved_by = excluded.saved_by
  returning saved_at into saved;
  return saved;
end $$;

create or replace function public.submit_guts_set(p_attempt uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  sets integer;
begin
  select * into a from attempts where id = p_attempt for update;
  perform private_assert_can_write(a);
  select max(set_no) into sets from problems where round_id = a.round_id;
  update attempts set sets_submitted = least(sets, sets_submitted + 1),
                      set_times = set_times || now(),
                      submitted_at = case when sets_submitted + 1 >= sets then now() end
  where id = a.id returning sets_submitted into sets;
  return sets;
end $$;

drop function if exists public.save_paper_sheet(uuid, text, jsonb);
/** Key a paper sheet. p_values and p_normalized map problem id to what was written and its normalised form. */
create or replace function public.save_paper_sheet(p_round uuid, p_public_id text, p_values jsonb, p_normalized jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r rounds;
  c competitors;
  t teams;
  a attempts;
  k text;
begin
  if not public.grades_round(p_round) then raise exception 'You are not grading this round.'; end if;
  select * into r from rounds where id = p_round;
  if r.kind = 'individual' then
    select comp.* into c from competitors comp join teams tm on tm.id = comp.team_id where tm.contest_id = r.contest_id and comp.public_id = upper(trim(p_public_id));
    if c.id is null then raise exception 'No competitor %.', p_public_id; end if;
    select * into a from attempts where round_id = r.id and competitor_id = c.id;
  else
    select * into t from teams where contest_id = r.contest_id and code = trim(p_public_id);
    if t.id is null then raise exception 'No team %.', p_public_id; end if;
    select * into a from attempts where round_id = r.id and team_id = t.id;
  end if;
  if a.id is null then
    insert into attempts (round_id, competitor_id, team_id, source, submitted_at)
    values (r.id, c.id, t.id, 'paper', now()) returning * into a;
  elsif a.source = 'online' then
    raise exception 'That entrant took this round online.';
  end if;
  delete from responses where attempt_id = a.id;
  for k in select jsonb_object_keys(p_values) loop
    if length(trim(p_values ->> k)) > 0 then
      insert into responses (attempt_id, problem_id, value, normalized, saved_by)
      select a.id, p.id, trim(p_values ->> k), p_normalized ->> k, auth.uid() from problems p where p.id = k::uuid and p.round_id = r.id;
    end if;
  end loop;
  update attempts set submitted_at = now() where id = a.id;
  return a.id;
end $$;

/** Key one Guts set from paper. Sets come in order; keying set 3 marks sets 1 to 3 as in. */
create or replace function public.save_paper_guts_set(p_round uuid, p_code text, p_set integer, p_values jsonb, p_normalized jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r rounds;
  t teams;
  a attempts;
  k text;
  sets integer;
begin
  if not public.grades_round(p_round) then raise exception 'You are not grading this round.'; end if;
  select * into r from rounds where id = p_round;
  if r.kind <> 'guts' then raise exception 'That is not a Guts round.'; end if;
  select * into t from teams where contest_id = r.contest_id and code = trim(p_code);
  if t.id is null then raise exception 'No team %.', p_code; end if;
  select max(set_no) into sets from problems where round_id = r.id;
  if p_set < 1 or p_set > sets then raise exception 'There is no set %.', p_set; end if;
  select * into a from attempts where round_id = r.id and team_id = t.id for update;
  if a.id is null then
    insert into attempts (round_id, team_id, source) values (r.id, t.id, 'paper') returning * into a;
  elsif a.source = 'online' then
    raise exception 'That team took this round online.';
  end if;
  delete from responses where attempt_id = a.id and problem_id in (select id from problems where round_id = r.id and set_no = p_set);
  for k in select jsonb_object_keys(p_values) loop
    if length(trim(p_values ->> k)) > 0 then
      insert into responses (attempt_id, problem_id, value, normalized, saved_by)
      select a.id, p.id, trim(p_values ->> k), p_normalized ->> k, auth.uid() from problems p where p.id = k::uuid and p.round_id = r.id and p.set_no = p_set;
    end if;
  end loop;
  if p_set > a.sets_submitted then
    update attempts set
      set_times = set_times || array_fill(now(), array[p_set - a.sets_submitted]),
      sets_submitted = p_set,
      submitted_at = case when p_set >= sets then now() end
    where id = a.id;
  end if;
  return greatest(a.sets_submitted, p_set);
end $$;

-- ===========================================================================
-- The live Guts board, for anyone in the contest
-- ===========================================================================

/**
 * Every team's score and sets in a Guts round. Students cannot read other
 * teams' answers or the key, so the database scores it: a response counts
 * if its normalised form is in the key's, or a director ruled it correct.
 * While the board is frozen, sets handed in after the freeze do not count.
 */
drop function if exists public.guts_board(uuid);
create or replace function public.guts_board(p_round uuid)
returns table (team_id uuid, code text, name text, division_id uuid, score numeric, sets integer, set_times timestamptz[], frozen boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  r rounds;
  c contests;
  cutoff timestamptz;
  is_staff boolean;
begin
  select * into r from rounds where id = p_round;
  if r.id is null or r.kind <> 'guts' then raise exception 'No such Guts round.'; end if;
  select * into c from contests where id = r.contest_id;
  is_staff := public.contest_staff(c.id) or public.grades_round(r.id) or public.contest_role(c.id, 'proctor')
    or exists (select 1 from zoom_rooms z where z.contest_id = c.id and z.proctor_id = auth.uid());
  if not is_staff and not exists (select 1 from teams t where t.contest_id = c.id and public.on_team(t.id)) then
    raise exception 'You are not in this contest.';
  end if;
  if r.opened_at is not null and coalesce((c.board ->> 'freeze_minutes')::integer, 0) > 0 and not coalesce((c.board ->> 'revealed')::boolean, false) then
    cutoff := r.opened_at + make_interval(mins => r.minutes - (c.board ->> 'freeze_minutes')::integer);
    if now() < cutoff then cutoff := null; end if;
  end if;
  return query
    with counted as (
      select a.id, a.team_id as tid, a.set_times as st,
             (select count(*)::integer from unnest(a.set_times) x where cutoff is null or x <= cutoff) as n
      from attempts a where a.round_id = r.id and a.team_id is not null
    )
    select tm.id, tm.code, tm.name, tm.division_id, coalesce((
             select sum(p.points) from responses rs join problems p on p.id = rs.problem_id
             left join answer_keys k on k.problem_id = p.id
             left join rulings ru on ru.problem_id = p.id and ru.normalized = rs.normalized
             where rs.attempt_id = cn.id and p.set_no <= cn.n
               and rs.normalized is not null and rs.normalized <> ''
               and (rs.normalized = any (k.normalized) or ru.correct is true)
           ), 0),
           coalesce(cn.n, 0),
           coalesce(cn.st[1:cn.n], '{}'),
           cutoff is not null
    from teams tm left join counted cn on cn.tid = tm.id
    where tm.contest_id = c.id and tm.status <> 'withdrawn';
end $$;

-- ===========================================================================
-- Announcements and the roster
-- ===========================================================================

create or replace function public.announce(p_round uuid, p_text text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not (public.contest_staff(public.round_contest(p_round)) or public.contest_role(public.round_contest(p_round), 'proctor')) then
    raise exception 'Only a proctor or director can announce.';
  end if;
  insert into clarifications (round_id, question, answer, broadcast, answered_at)
  values (p_round, '', left(trim(p_text), 2000), true, now()) returning id into new_id;
  return new_id;
end $$;

/** Waiver links exist from the moment a competitor does. */
create or replace function public.make_waiver_token()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into waiver_tokens (competitor_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists competitor_waiver_token on public.competitors;
create trigger competitor_waiver_token after insert on public.competitors for each row execute function public.make_waiver_token();

/** The waiver link token, for the coach or the organisers to send on. */
create or replace function public.waiver_token(p_competitor uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c competitors;
begin
  select * into c from competitors where id = p_competitor;
  if c.id is null or not (public.contest_staff(public.team_contest(c.team_id)) or exists (select 1 from teams t where t.id = c.team_id and t.coach_id = auth.uid())) then
    raise exception 'No such competitor.';
  end if;
  return (select token from waiver_tokens where competitor_id = c.id);
end $$;

/** Who a waiver link is for, so the signing page can say so before anyone signs. */
create or replace function public.waiver_info(p_token text)
returns table (competitor_name text, public_id text, contest_name text, guardian_name text, signed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.name, c.public_id, k.name, c.guardian_name, c.waiver_signed_at
  from waiver_tokens w join competitors c on c.id = w.competitor_id join teams t on t.id = c.team_id join contests k on k.id = t.contest_id
  where w.token = p_token;
$$;

/** Add a student to a team: its coach or the organisers. Takes the first free letter. */
create or replace function public.add_competitor(p_team uuid, p_name text, p_grade integer, p_guardian_name text, p_guardian_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t teams;
  hi integer;
  letter text;
  new_id uuid;
begin
  select * into t from teams where id = p_team for update;
  if t.id is null or not (public.contest_staff(t.contest_id) or t.coach_id = auth.uid()) then raise exception 'No such team.'; end if;
  hi := coalesce((select (registration ->> 'team_max')::integer from contests where id = t.contest_id), 4);
  select l into letter from unnest(string_to_array('A,B,C,D,E,F,G,H', ',')) with ordinality as s(l, i)
  where i <= hi and l not in (select slot from competitors where team_id = t.id) order by i limit 1;
  if letter is null then raise exception 'The team is full.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A student needs a name.'; end if;
  insert into competitors (team_id, slot, public_id, name, grade, guardian_name, guardian_email)
  values (t.id, letter, t.code || letter, trim(p_name), p_grade, nullif(trim(p_guardian_name), ''), nullif(trim(p_guardian_email), ''))
  returning id into new_id;
  return new_id;
end $$;

/**
 * A student joins their team with the code their coach shared. If the coach
 * already added them by name, they take that place; otherwise a new one.
 */
create or replace function public.join_team(p_code text, p_name text, p_grade integer default null, p_guardian_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t teams;
  c competitors;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from teams where join_code = upper(trim(p_code)) and status <> 'withdrawn';
  if t.id is null then raise exception 'No team has that code.'; end if;
  if exists (select 1 from competitors comp join teams tm on tm.id = comp.team_id where comp.user_id = auth.uid() and tm.contest_id = t.contest_id) then
    raise exception 'You are already on a team in this contest.';
  end if;
  select * into c from competitors where team_id = t.id and user_id is null and lower(name) = lower(trim(p_name)) limit 1;
  if c.id is not null then
    update competitors set user_id = auth.uid() where id = c.id;
    return c.id;
  end if;
  new_id := public.add_competitor_unchecked(t.id, p_name, p_grade, null, p_guardian_email);
  update competitors set user_id = auth.uid() where id = new_id;
  return new_id;
end $$;

create or replace function public.add_competitor_unchecked(p_team uuid, p_name text, p_grade integer, p_guardian_name text, p_guardian_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t teams;
  hi integer;
  letter text;
  new_id uuid;
begin
  select * into t from teams where id = p_team for update;
  hi := coalesce((select (registration ->> 'team_max')::integer from contests where id = t.contest_id), 4);
  select l into letter from unnest(string_to_array('A,B,C,D,E,F,G,H', ',')) with ordinality as s(l, i)
  where i <= hi and l not in (select slot from competitors where team_id = t.id) order by i limit 1;
  if letter is null then raise exception 'The team is full.'; end if;
  insert into competitors (team_id, slot, public_id, name, grade, guardian_name, guardian_email)
  values (t.id, letter, t.code || letter, trim(p_name), p_grade, nullif(trim(p_guardian_name), ''), nullif(trim(p_guardian_email), ''))
  returning id into new_id;
  return new_id;
end $$;

/**
 * Names and codes without contact details: graders key paper by competitor
 * ID or team code, proctors watch the students in their own Zoom room.
 * Graders get everyone (so they can say "that ID took it online"),
 * proctors only their room.
 */
create or replace function public.grader_people(p_contest uuid)
returns table (kind text, id uuid, team_id uuid, code text, name text, division_id uuid, status text)
language plpgsql stable security definer set search_path = public as $$
declare
  everyone boolean := public.contest_role(p_contest, 'grader') or public.contest_staff(p_contest);
begin
  if not everyone and not public.contest_role(p_contest, 'proctor') and not exists (select 1 from zoom_rooms z where z.contest_id = p_contest and z.proctor_id = auth.uid()) then
    raise exception 'You are not working on this contest.';
  end if;
  return query
    select 'team'::text, t.id, t.id, t.code, t.name, t.division_id, t.status from teams t
    where t.contest_id = p_contest and (everyone or public.proctors_team(t.id))
    union all
    select 'competitor'::text, c.id, c.team_id, c.public_id, c.name, t.division_id, t.status from competitors c join teams t on t.id = c.team_id
    where t.contest_id = p_contest and (everyone or public.proctors_team(t.id));
end $$;

-- Proctors read problem text (never keys), to see how far each student is.
drop policy if exists problem_staff on public.problems;
create policy problem_staff on public.problems for select to authenticated using (
  public.contest_staff(public.round_contest(round_id)) or public.grades_round(round_id)
  or public.is_org_member((select org_id from contests where id = public.round_contest(round_id)), array['writer'])
  or public.contest_role(public.round_contest(round_id), 'proctor')
  or exists (select 1 from zoom_rooms z where z.contest_id = public.round_contest(round_id) and z.proctor_id = auth.uid())
);

-- ===========================================================================
-- Published results: what students and coaches see once results are out
-- ===========================================================================

create table if not exists public.results (
  id             uuid primary key default gen_random_uuid(),
  contest_id     uuid not null references public.contests (id) on delete cascade,
  competitor_id  uuid references public.competitors (id) on delete cascade,
  team_id        uuid references public.teams (id) on delete cascade,
  data           jsonb not null,
  published_at   timestamptz not null default now(),
  check ((competitor_id is null) <> (team_id is null))
);
create unique index if not exists results_one_per_entrant on public.results (contest_id, coalesce(competitor_id, team_id));
alter table public.results enable row level security;
drop policy if exists result_read on public.results;
create policy result_read on public.results for select to authenticated using (
  public.contest_staff(contest_id)
  or exists (select 1 from competitors c where c.id = competitor_id and (c.user_id = auth.uid() or public.on_team(c.team_id)))
  or (team_id is not null and public.on_team(team_id))
);

/**
 * The director's browser scores the contest with the same engine everyone
 * sees in Results, and publishes one row per competitor and per team:
 * [{competitor_id | team_id, data}]. Publishing again replaces them;
 * p_rows null takes results down.
 */
create or replace function public.publish_results(p_contest uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  x jsonb;
begin
  if not public.contest_director(p_contest) then raise exception 'Only a director can publish results.'; end if;
  delete from results where contest_id = p_contest;
  if p_rows is null then
    update contests set results_published = false where id = p_contest;
    return 0;
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    insert into results (contest_id, competitor_id, team_id, data)
    values (p_contest, nullif(x ->> 'competitor_id', '')::uuid, nullif(x ->> 'team_id', '')::uuid, x -> 'data');
    n := n + 1;
  end loop;
  update contests set results_published = true where id = p_contest;
  return n;
end $$;

-- ===========================================================================
-- Email through a pool of provider keys
-- ===========================================================================

-- Free plans cap each key (Resend: 100 a day). An organisation adds as many
-- keys as it needs; the sender uses each up to its limit, then the next.
create table if not exists public.email_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  label         text not null,
  kind          text not null default 'resend' check (kind in ('resend')),
  from_address  text not null,
  daily_limit   integer not null default 100 check (daily_limit > 0),
  active        boolean not null default true,
  last_error    text,
  created_at    timestamptz not null default now()
);
-- The secret itself: no policy at all, so only the service role (the send
-- function) can read it. Browsers never see a key after it is saved.
create table if not exists public.email_key_secrets (
  key_id  uuid primary key references public.email_keys (id) on delete cascade,
  secret  text not null
);
alter table public.email_keys        enable row level security;
alter table public.email_key_secrets enable row level security;
drop policy if exists key_meta_read on public.email_keys;
create policy key_meta_read on public.email_keys for select to authenticated using (public.is_org_member(org_id, array['owner', 'director', 'staff']));
drop policy if exists key_meta_write on public.email_keys;
create policy key_meta_write on public.email_keys for update to authenticated using (public.is_org_member(org_id, array['owner', 'director'])) with check (public.is_org_member(org_id, array['owner', 'director']));
drop policy if exists key_meta_delete on public.email_keys;
create policy key_meta_delete on public.email_keys for delete to authenticated using (public.is_org_member(org_id, array['owner', 'director']));

create or replace function public.add_email_key(p_org uuid, p_label text, p_from text, p_limit integer, p_secret text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k uuid;
begin
  if not public.is_org_member(p_org, array['owner', 'director']) then raise exception 'Only a director can add a sending key.'; end if;
  if coalesce(length(trim(p_secret)), 0) < 8 then raise exception 'That does not look like an API key.'; end if;
  insert into email_keys (org_id, label, from_address, daily_limit) values (p_org, trim(p_label), trim(p_from), greatest(1, coalesce(p_limit, 100))) returning id into k;
  insert into email_key_secrets (key_id, secret) values (k, trim(p_secret));
  return k;
end $$;

alter table public.email_sends alter column template_id drop not null;
alter table public.email_sends add column if not exists contest_id uuid references public.contests (id) on delete cascade;
alter table public.email_sends add column if not exists kind text not null default 'template';
alter table public.email_sends add column if not exists subject text;
alter table public.email_sends add column if not exists html text;
alter table public.email_sends add column if not exists key_id uuid references public.email_keys (id) on delete set null;
alter table public.email_sends add column if not exists error text;

drop policy if exists send_read on public.email_sends;
create policy send_read on public.email_sends for select to authenticated using (
  public.contest_staff(coalesce(contest_id, (select contest_id from email_templates where id = template_id)))
);

/**
 * Queue messages. Each is {to, subject, html}; the idempotency key (contest,
 * kind or template, recipient) means sending the same thing twice queues it
 * once. Returns how many were new.
 */
create or replace function public.queue_emails(p_contest uuid, p_kind text, p_template uuid, p_messages jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  m jsonb;
begin
  if not public.contest_staff(p_contest) then raise exception 'Only the organisers can send email.'; end if;
  for m in select * from jsonb_array_elements(p_messages) loop
    insert into email_sends (contest_id, template_id, kind, recipient, subject, html, idempotency_key, status)
    values (p_contest, p_template, p_kind, lower(trim(m ->> 'to')), m ->> 'subject', m ->> 'html',
            p_contest || ':' || coalesce(p_template::text, p_kind) || ':' || lower(trim(m ->> 'to')) || coalesce(':' || (m ->> 'tag'), ''), 'queued')
    on conflict (idempotency_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ===========================================================================
-- Grants and realtime
-- ===========================================================================

grant select on public.profiles, public.results, public.email_keys to authenticated;
grant update on public.profiles, public.email_keys to authenticated;
grant delete on public.email_keys to authenticated;
grant insert, update, delete on public.activity to authenticated;
drop policy if exists activity_write on public.activity;
create policy activity_write on public.activity for insert to authenticated with check (public.contest_staff(contest_id) or (team_id is not null and exists (select 1 from teams t where t.id = team_id and t.coach_id = auth.uid())));

revoke execute on function public.add_competitor_unchecked(uuid, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.make_waiver_token() from public, anon, authenticated;
grant execute on function public.open_round(uuid), public.close_round(uuid), public.save_response(uuid, uuid, text, text), public.save_paper_sheet(uuid, text, jsonb, jsonb),
  public.save_paper_guts_set(uuid, text, integer, jsonb, jsonb), public.guts_board(uuid), public.announce(uuid, text),
  public.waiver_token(uuid), public.add_competitor(uuid, text, integer, text, text), public.join_team(text, text, integer, text),
  public.publish_results(uuid, jsonb), public.add_email_key(uuid, text, text, integer, text), public.queue_emails(uuid, text, uuid, jsonb),
  public.create_organization(text, text), public.grader_people(uuid) to authenticated;
grant execute on function public.waiver_info(text) to anon, authenticated;

-- Live updates: the tables whose changes screens follow.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['attempts', 'responses', 'integrity_events', 'clarifications', 'rounds', 'teams', 'competitors', 'rulings', 'contests', 'results'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
