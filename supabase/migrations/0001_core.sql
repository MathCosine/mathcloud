-- ===========================================================================
-- MathCloud core schema
-- ===========================================================================
-- Many organisations, each running private contests. Run once in the Supabase
-- SQL editor, or with `supabase db push`.
--
-- Security model:
--   * Browsers hold only the anon key. Every table has row level security.
--   * Who may read a row is decided by a handful of SECURITY DEFINER helper
--     functions below (is_org_member, contest_staff, ...), so policies stay
--     one line each and every table answers the same question the same way.
--   * Anything with a rule beyond "may I see this row" (starting a test,
--     saving an answer, keying a paper sheet, ruling on an answer) goes
--     through a SECURITY DEFINER function that checks the rule against the
--     database clock. Students cannot write attempts or responses directly.
--   * Answer keys live in their own table that only directors and graders
--     can read. Problems reach students only through round_problems(), and
--     only once their round has started.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tenancy

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  branding    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'director', 'staff', 'writer')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.contests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  name               text not null,
  short_name         text not null,
  slug               text not null,
  time_zone          text not null default 'America/Los_Angeles',
  starts_on          date,
  registration       jsonb not null default '{"open": false, "team_min": 1, "team_max": 4}'::jsonb,
  recipe             jsonb not null default '{}'::jsonb,
  results_published  boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.divisions (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references public.contests (id) on delete cascade,
  name        text not null,
  mode        text not null check (mode in ('in_person', 'online')),
  detail      text,
  id_template text not null default '{team:2}{slot}'
);

-- Graders and proctors are scoped to one contest, and to rounds or a room.
create table if not exists public.contest_roles (
  contest_id  uuid not null references public.contests (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('grader', 'proctor')),
  round_ids   uuid[] not null default '{}',
  room_id     uuid,
  expires_at  timestamptz,
  primary key (contest_id, user_id, role)
);

-- ----------------------------------------------------------------- rounds

create table if not exists public.rounds (
  id             uuid primary key default gen_random_uuid(),
  contest_id     uuid not null references public.contests (id) on delete cascade,
  name           text not null,
  kind           text not null check (kind in ('individual', 'team', 'guts')),
  minutes        integer not null check (minutes > 0),
  starts_at      timestamptz not null,
  status         text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed')),
  opened_at      timestamptz,
  grace_seconds  integer not null default 30 check (grace_seconds between 0 and 300),
  mystery        boolean not null default false,
  integrity      jsonb not null default '{"policy": "warn", "lock_after": 4}'::jsonb,
  rules          text not null default '',
  position       integer not null default 0
);

create table if not exists public.problems (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  number       integer not null,
  set_no       integer,
  body         text not null,
  answer_type  text not null default 'integer' check (answer_type in ('integer', 'expression')),
  points       numeric not null default 1,
  unique (round_id, number)
);

-- Kept apart from problems so that no policy on problems can leak a key.
create table if not exists public.answer_keys (
  problem_id  uuid primary key references public.problems (id) on delete cascade,
  accepted    text[] not null default '{}'
);

-- ------------------------------------------------------------- the roster

create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  contest_id     uuid not null references public.contests (id) on delete cascade,
  division_id    uuid not null references public.divisions (id),
  code           text not null,
  name           text not null,
  school         text,
  city           text,
  contact_name   text not null,
  contact_email  text not null,
  coach_id       uuid references auth.users (id),
  status         text not null default 'pending' check (status in ('pending', 'confirmed', 'withdrawn', 'waitlisted')),
  join_code      text not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  fields         jsonb not null default '{}'::jsonb,
  external_id    text,
  disqualified   text,
  registered_at  timestamptz not null default now(),
  unique (contest_id, code),
  unique (contest_id, external_id)
);

create table if not exists public.competitors (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams (id) on delete cascade,
  slot             text not null check (slot ~ '^[A-Z]$'),
  public_id        text not null,
  name             text not null,
  grade            integer,
  user_id          uuid references auth.users (id),
  guardian_name    text,
  guardian_email   text,
  waiver_signed_at timestamptz,
  waiver_signed_by text,
  checked_in_at    timestamptz,
  disqualified     text,
  external_id      text,
  unique (team_id, slot)
);

create table if not exists public.zoom_rooms (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references public.contests (id) on delete cascade,
  name         text not null,
  url          text not null,
  proctor_id   uuid references auth.users (id),
  team_ids     uuid[] not null default '{}'
);

-- ---------------------------------------------------------------- testing

create table if not exists public.attempts (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.rounds (id) on delete cascade,
  competitor_id   uuid references public.competitors (id) on delete cascade,
  team_id         uuid references public.teams (id) on delete cascade,
  source          text not null check (source in ('online', 'paper')),
  started_at      timestamptz,
  deadline        timestamptz,
  submitted_at    timestamptz,
  sets_submitted  integer not null default 0,
  locked          boolean not null default false,
  honor_name      text,
  check ((competitor_id is null) <> (team_id is null))
);
create unique index if not exists attempts_one_per_entrant
  on public.attempts (round_id, coalesce(competitor_id, team_id));

create table if not exists public.responses (
  attempt_id  uuid not null references public.attempts (id) on delete cascade,
  problem_id  uuid not null references public.problems (id) on delete cascade,
  value       text not null check (length(value) <= 120),
  saved_at    timestamptz not null default now(),
  saved_by    uuid references auth.users (id),
  primary key (attempt_id, problem_id)
);

create table if not exists public.integrity_events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts (id) on delete cascade,
  kind        text not null check (kind in ('hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'offline', 'second_session', 'warned', 'locked', 'unlocked')),
  ms          integer,
  by_user     uuid references auth.users (id),
  at          timestamptz not null default now()
);

create table if not exists public.rulings (
  problem_id  uuid not null references public.problems (id) on delete cascade,
  normalized  text not null,
  correct     boolean not null,
  ruled_by    uuid references auth.users (id),
  ruled_at    timestamptz not null default now(),
  primary key (problem_id, normalized)
);

create table if not exists public.clarifications (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references public.rounds (id) on delete cascade,
  competitor_id  uuid references public.competitors (id) on delete cascade,
  question       text not null default '',
  answer         text,
  broadcast      boolean not null default false,
  asked_at       timestamptz not null default now(),
  answered_at    timestamptz
);

-- ------------------------------------------------------------------ email

create table if not exists public.email_providers (
  org_id       uuid primary key references public.organizations (id) on delete cascade,
  kind         text not null check (kind in ('resend', 'smtp', 'gmail_relay')),
  from_address text not null,
  daily_limit  integer not null default 100,
  -- The key or password itself is in Supabase Vault; this is its id.
  secret_id    uuid
);

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references public.contests (id) on delete cascade,
  name        text not null,
  trigger     text not null check (trigger in ('registered', 'waiver_missing', 'before_contest', 'results', 'manual')),
  audience    text not null check (audience in ('contacts', 'guardians', 'students')),
  subject     text not null,
  body        text not null
);

create table if not exists public.email_sends (
  id               bigint generated always as identity primary key,
  template_id      uuid not null references public.email_templates (id) on delete cascade,
  recipient        text not null,
  idempotency_key  text not null unique,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'bounced', 'failed')),
  provider_id      text,
  queued_at        timestamptz not null default now(),
  sent_at          timestamptz
);

create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  contest_id  uuid not null references public.contests (id) on delete cascade,
  team_id     uuid references public.teams (id) on delete cascade,
  actor       uuid references auth.users (id),
  text        text not null,
  at          timestamptz not null default now()
);

-- ===========================================================================
-- Who may do what
-- ===========================================================================

create or replace function public.is_org_member(p_org uuid, p_roles text[] default array['owner', 'director', 'staff', 'writer'])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles));
$$;

/** Directors (and owners) of the organisation running this contest. */
create or replace function public.contest_director(p_contest uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contests c join memberships m on m.org_id = c.org_id
    where c.id = p_contest and m.user_id = auth.uid() and m.role in ('owner', 'director')
  );
$$;

/** Anyone on the organisation's staff for this contest. */
create or replace function public.contest_staff(p_contest uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contests c join memberships m on m.org_id = c.org_id
    where c.id = p_contest and m.user_id = auth.uid() and m.role in ('owner', 'director', 'staff')
  );
$$;

create or replace function public.contest_role(p_contest uuid, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contest_roles r
    where r.contest_id = p_contest and r.user_id = auth.uid() and r.role = p_role
      and (r.expires_at is null or r.expires_at > now())
  );
$$;

create or replace function public.grades_round(p_round uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rounds rd join contest_roles r on r.contest_id = rd.contest_id
    where rd.id = p_round and r.user_id = auth.uid() and r.role = 'grader' and rd.id = any (r.round_ids)
      and (r.expires_at is null or r.expires_at > now())
  ) or exists (select 1 from rounds rd where rd.id = p_round and public.contest_director(rd.contest_id));
$$;

/** The coach of this team, or a competitor on it. */
create or replace function public.on_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams t where t.id = p_team and t.coach_id = auth.uid())
      or exists (select 1 from competitors c where c.team_id = p_team and c.user_id = auth.uid());
$$;

create or replace function public.team_contest(p_team uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select contest_id from teams where id = p_team;
$$;

create or replace function public.round_contest(p_round uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select contest_id from rounds where id = p_round;
$$;

/** Proctors see attempts of teams in their room. */
create or replace function public.proctors_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from zoom_rooms z join contest_roles r on r.contest_id = z.contest_id and r.room_id = z.id
    where p_team = any (z.team_ids) and r.user_id = auth.uid() and r.role = 'proctor'
  ) or exists (select 1 from zoom_rooms z where p_team = any (z.team_ids) and z.proctor_id = auth.uid());
$$;

create or replace function public.attempt_team(p_attempt uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(a.team_id, c.team_id) from attempts a left join competitors c on c.id = a.competitor_id where a.id = p_attempt;
$$;

-- ===========================================================================
-- Row level security
-- ===========================================================================

alter table public.organizations    enable row level security;
alter table public.memberships      enable row level security;
alter table public.contests         enable row level security;
alter table public.divisions        enable row level security;
alter table public.contest_roles    enable row level security;
alter table public.rounds           enable row level security;
alter table public.problems         enable row level security;
alter table public.answer_keys      enable row level security;
alter table public.teams            enable row level security;
alter table public.competitors      enable row level security;
alter table public.zoom_rooms       enable row level security;
alter table public.attempts         enable row level security;
alter table public.responses        enable row level security;
alter table public.integrity_events enable row level security;
alter table public.rulings          enable row level security;
alter table public.clarifications   enable row level security;
alter table public.email_providers  enable row level security;
alter table public.email_templates  enable row level security;
alter table public.email_sends      enable row level security;
alter table public.activity         enable row level security;

-- Organisations and memberships
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations for select to authenticated using (public.is_org_member(id));
drop policy if exists org_write on public.organizations;
create policy org_write on public.organizations for update to authenticated using (public.is_org_member(id, array['owner'])) with check (public.is_org_member(id, array['owner']));
drop policy if exists member_read on public.memberships;
create policy member_read on public.memberships for select to authenticated using (public.is_org_member(org_id));
drop policy if exists member_write on public.memberships;
create policy member_write on public.memberships for all to authenticated using (public.is_org_member(org_id, array['owner', 'director'])) with check (public.is_org_member(org_id, array['owner', 'director']));

-- Contests: the public may see a contest's name and schedule (registration
-- pages); everything else below is private.
drop policy if exists contest_public on public.contests;
create policy contest_public on public.contests for select to anon, authenticated using (true);
drop policy if exists contest_write on public.contests;
create policy contest_write on public.contests for all to authenticated using (public.contest_director(id)) with check (public.is_org_member(org_id, array['owner', 'director']));
drop policy if exists division_public on public.divisions;
create policy division_public on public.divisions for select to anon, authenticated using (true);
drop policy if exists division_write on public.divisions;
create policy division_write on public.divisions for all to authenticated using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));
drop policy if exists roles_read on public.contest_roles;
create policy roles_read on public.contest_roles for select to authenticated using (user_id = auth.uid() or public.contest_staff(contest_id));
drop policy if exists roles_write on public.contest_roles;
create policy roles_write on public.contest_roles for all to authenticated using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));

-- Rounds: schedule is public; problems go through round_problems().
drop policy if exists round_public on public.rounds;
create policy round_public on public.rounds for select to anon, authenticated using (true);
drop policy if exists round_write on public.rounds;
create policy round_write on public.rounds for all to authenticated using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));
drop policy if exists problem_staff on public.problems;
create policy problem_staff on public.problems for select to authenticated using (public.contest_staff(public.round_contest(round_id)) or public.grades_round(round_id) or public.is_org_member((select org_id from contests where id = public.round_contest(round_id)), array['writer']));
drop policy if exists problem_write on public.problems;
create policy problem_write on public.problems for all to authenticated using (public.contest_director(public.round_contest(round_id))) with check (public.contest_director(public.round_contest(round_id)));
drop policy if exists key_read on public.answer_keys;
create policy key_read on public.answer_keys for select to authenticated using (public.grades_round((select round_id from problems where id = problem_id)));
drop policy if exists key_write on public.answer_keys;
create policy key_write on public.answer_keys for all to authenticated using (public.contest_director(public.round_contest((select round_id from problems where id = problem_id)))) with check (public.contest_director(public.round_contest((select round_id from problems where id = problem_id))));

-- Roster. Graders get names and IDs through grader_roster(), never contacts.
drop policy if exists team_read on public.teams;
create policy team_read on public.teams for select to authenticated using (public.contest_staff(contest_id) or public.on_team(id) or public.proctors_team(id));
drop policy if exists team_write on public.teams;
create policy team_write on public.teams for update to authenticated using (public.contest_staff(contest_id) or coach_id = auth.uid()) with check (public.contest_staff(contest_id) or coach_id = auth.uid());
drop policy if exists team_delete on public.teams;
create policy team_delete on public.teams for delete to authenticated using (public.contest_director(contest_id));
drop policy if exists comp_read on public.competitors;
create policy comp_read on public.competitors for select to authenticated using (public.contest_staff(public.team_contest(team_id)) or public.on_team(team_id));
drop policy if exists comp_write on public.competitors;
create policy comp_write on public.competitors for all to authenticated
  using (public.contest_staff(public.team_contest(team_id)) or exists (select 1 from teams t where t.id = team_id and t.coach_id = auth.uid()))
  with check (public.contest_staff(public.team_contest(team_id)) or exists (select 1 from teams t where t.id = team_id and t.coach_id = auth.uid()));
drop policy if exists room_read on public.zoom_rooms;
create policy room_read on public.zoom_rooms for select to authenticated using (public.contest_staff(contest_id) or proctor_id = auth.uid() or exists (select 1 from unnest(team_ids) t where public.on_team(t)));
drop policy if exists room_write on public.zoom_rooms;
create policy room_write on public.zoom_rooms for all to authenticated using (public.contest_director(contest_id)) with check (public.contest_director(contest_id));

-- Testing. Reads only; every write is a function below.
drop policy if exists attempt_read on public.attempts;
create policy attempt_read on public.attempts for select to authenticated using (
  public.contest_staff(public.round_contest(round_id)) or public.grades_round(round_id)
  or public.on_team(public.attempt_team(id)) or public.proctors_team(public.attempt_team(id))
);
drop policy if exists response_read on public.responses;
create policy response_read on public.responses for select to authenticated using (
  exists (select 1 from attempts a where a.id = attempt_id and (
    public.contest_staff(public.round_contest(a.round_id)) or public.grades_round(a.round_id) or public.on_team(public.attempt_team(a.id))
  ))
);
drop policy if exists event_read on public.integrity_events;
create policy event_read on public.integrity_events for select to authenticated using (
  exists (select 1 from attempts a where a.id = attempt_id and (public.contest_staff(public.round_contest(a.round_id)) or public.proctors_team(public.attempt_team(a.id))))
);
drop policy if exists ruling_read on public.rulings;
create policy ruling_read on public.rulings for select to authenticated using (public.grades_round((select round_id from problems where id = problem_id)));
drop policy if exists clar_read on public.clarifications;
create policy clar_read on public.clarifications for select to authenticated using (
  broadcast and answer is not null and exists (select 1 from rounds r join teams t on t.contest_id = r.contest_id where r.id = round_id and public.on_team(t.id))
  or exists (select 1 from competitors c where c.id = competitor_id and c.user_id = auth.uid())
  or public.contest_staff(public.round_contest(round_id))
  or public.contest_role(public.round_contest(round_id), 'proctor')
);

-- Email and activity: staff only.
drop policy if exists provider_read on public.email_providers;
create policy provider_read on public.email_providers for select to authenticated using (public.is_org_member(org_id, array['owner', 'director']));
drop policy if exists provider_write on public.email_providers;
create policy provider_write on public.email_providers for all to authenticated using (public.is_org_member(org_id, array['owner', 'director'])) with check (public.is_org_member(org_id, array['owner', 'director']));
drop policy if exists template_all on public.email_templates;
create policy template_all on public.email_templates for all to authenticated using (public.contest_staff(contest_id)) with check (public.contest_staff(contest_id));
drop policy if exists send_read on public.email_sends;
create policy send_read on public.email_sends for select to authenticated using (public.contest_staff((select contest_id from email_templates where id = template_id)));
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (public.contest_staff(contest_id) or (team_id is not null and exists (select 1 from teams t where t.id = team_id and t.coach_id = auth.uid())));

-- ===========================================================================
-- Functions: the rules
-- ===========================================================================

/** The round's state by the database clock: an open round past its time is closed. */
create or replace function public.round_state(r public.rounds)
returns text language sql stable as $$
  select case
    when r.status <> 'open' then r.status
    when r.opened_at is not null and now() > r.opened_at + make_interval(mins => r.minutes) + make_interval(secs => r.grace_seconds) then 'closed'
    else 'open'
  end;
$$;

/** Start (or rejoin) the caller's attempt at an online round. */
create or replace function public.start_attempt(p_round uuid, p_honor_name text)
returns public.attempts language plpgsql security definer set search_path = public as $$
declare
  r   rounds;
  c   competitors;
  t   teams;
  d   divisions;
  a   attempts;
begin
  select * into r from rounds where id = p_round;
  if r.id is null then raise exception 'No such round.'; end if;
  if round_state(r) <> 'open' then raise exception 'This round is not open.'; end if;

  select comp.* into c from competitors comp join teams tm on tm.id = comp.team_id
  where comp.user_id = auth.uid() and tm.contest_id = r.contest_id and tm.status <> 'withdrawn';
  if c.id is null then raise exception 'You are not registered for this contest.'; end if;
  select * into t from teams where id = c.team_id;
  select * into d from divisions where id = t.division_id;
  if d.mode <> 'online' then raise exception 'In-person competitors sit this round on paper.'; end if;
  if c.waiver_signed_at is null then raise exception 'Your waiver has not been signed yet.'; end if;
  if c.disqualified is not null or t.disqualified is not null then raise exception 'You cannot take this round.'; end if;
  if coalesce(length(trim(p_honor_name)), 0) < 2 then raise exception 'Type your name to accept the honour code.'; end if;

  if r.kind = 'individual' then
    select * into a from attempts where round_id = r.id and competitor_id = c.id;
  else
    select * into a from attempts where round_id = r.id and team_id = t.id;
  end if;

  if a.id is null then
    insert into attempts (round_id, competitor_id, team_id, source, started_at, deadline, honor_name)
    values (
      r.id,
      case when r.kind = 'individual' then c.id end,
      case when r.kind <> 'individual' then t.id end,
      'online', now(), r.opened_at + make_interval(mins => r.minutes), trim(p_honor_name)
    )
    returning * into a;
  end if;
  return a;
end;
$$;

/** Problems without answers, for someone whose attempt has started. Guts: only the current set. */
create or replace function public.round_problems(p_attempt uuid)
returns table (id uuid, number integer, set_no integer, body text, answer_type text, points numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  a attempts;
begin
  select * into a from attempts where attempts.id = p_attempt;
  if a.id is null or a.started_at is null or not public.on_team(public.attempt_team(a.id)) then
    raise exception 'No such test.';
  end if;
  return query
    select p.id, p.number, p.set_no, p.body, p.answer_type, p.points
    from problems p join rounds r on r.id = p.round_id
    where p.round_id = a.round_id
      and (r.kind <> 'guts' or p.set_no <= a.sets_submitted + 1)
    order by p.number;
end;
$$;

create or replace function private_assert_can_write(a public.attempts)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  r rounds;
begin
  if a.id is null or a.source <> 'online' or not public.on_team(public.attempt_team(a.id)) then raise exception 'No such test.'; end if;
  if exists (select 1 from teams t where t.id = public.attempt_team(a.id) and t.coach_id = auth.uid())
     and not exists (select 1 from competitors c where c.team_id = public.attempt_team(a.id) and c.user_id = auth.uid()) then
    raise exception 'Coaches cannot answer for their students.';
  end if;
  select * into r from rounds where id = a.round_id;
  if a.submitted_at is not null then raise exception 'This test has been handed in.'; end if;
  if now() > a.deadline + make_interval(secs => r.grace_seconds) then raise exception 'Time is up. This answer was not saved.'; end if;
  if a.locked then raise exception 'Your test is locked. Ask your proctor to unlock it.'; end if;
end;
$$;

/** Save one answer, by the database clock. */
create or replace function public.save_response(p_attempt uuid, p_problem uuid, p_value text)
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
  insert into responses (attempt_id, problem_id, value, saved_at, saved_by)
  values (a.id, p.id, left(coalesce(p_value, ''), 120), now(), auth.uid())
  on conflict (attempt_id, problem_id) do update set value = excluded.value, saved_at = excluded.saved_at, saved_by = excluded.saved_by
  returning saved_at into saved;
  return saved;
end;
$$;

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
                      submitted_at = case when sets_submitted + 1 >= sets then now() end
  where id = a.id returning sets_submitted into sets;
  return sets;
end;
$$;

create or replace function public.submit_attempt(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a attempts;
begin
  select * into a from attempts where id = p_attempt for update;
  if a.id is null or not public.on_team(public.attempt_team(a.id)) then raise exception 'No such test.'; end if;
  update attempts set submitted_at = coalesce(submitted_at, now()) where id = a.id;
end;
$$;

/** Log what the browser saw; returns 'none', 'warn' or 'lock'. */
create or replace function public.log_integrity_event(p_attempt uuid, p_kind text, p_ms integer default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  r rounds;
  n integer;
begin
  if p_kind not in ('hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'offline', 'second_session') then raise exception 'Unknown event.'; end if;
  select * into a from attempts where id = p_attempt for update;
  if a.id is null or not public.on_team(public.attempt_team(a.id)) then raise exception 'No such test.'; end if;
  if a.submitted_at is not null then return 'none'; end if;
  insert into integrity_events (attempt_id, kind, ms, by_user) values (a.id, p_kind, p_ms, auth.uid());
  if p_kind not in ('hidden', 'blur', 'fullscreen_exit') then return 'none'; end if;
  select * into r from rounds where id = a.round_id;
  select count(*) into n from integrity_events where attempt_id = a.id and kind in ('hidden', 'blur', 'fullscreen_exit');
  if r.integrity ->> 'policy' = 'lock' and n >= coalesce((r.integrity ->> 'lock_after')::int, 4) and not a.locked then
    update attempts set locked = true where id = a.id;
    insert into integrity_events (attempt_id, kind) values (a.id, 'locked');
    return 'lock';
  elsif r.integrity ->> 'policy' in ('warn', 'lock') then
    insert into integrity_events (attempt_id, kind) values (a.id, 'warned');
    return 'warn';
  end if;
  return 'none';
end;
$$;

create or replace function public.set_attempt_lock(p_attempt uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  a attempts;
begin
  select * into a from attempts where id = p_attempt for update;
  if a.id is null or not (public.contest_staff(public.round_contest(a.round_id)) or public.proctors_team(public.attempt_team(a.id))) then
    raise exception 'Only a proctor or director can do that.';
  end if;
  update attempts set locked = p_locked where id = a.id;
  insert into integrity_events (attempt_id, kind, by_user) values (a.id, case when p_locked then 'locked' else 'unlocked' end, auth.uid());
end;
$$;

/** Key a paper sheet. A grader must be assigned the round. Blanks are kept as absent rows. */
create or replace function public.save_paper_sheet(p_round uuid, p_public_id text, p_values jsonb)
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
      insert into responses (attempt_id, problem_id, value, saved_by)
      select a.id, p.id, trim(p_values ->> k), auth.uid() from problems p where p.id = k::uuid and p.round_id = r.id;
    end if;
  end loop;
  update attempts set submitted_at = now() where id = a.id;
  return a.id;
end;
$$;

/** Names and IDs for paper entry. No contact details. */
create or replace function public.grader_roster(p_round uuid)
returns table (id uuid, public_id text, name text, team_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.grades_round(p_round) then raise exception 'You are not grading this round.'; end if;
  return query
    select c.id, c.public_id, c.name, t.code
    from competitors c join teams t on t.id = c.team_id join divisions d on d.id = t.division_id
    where t.contest_id = public.round_contest(p_round) and d.mode = 'in_person' and t.status <> 'withdrawn'
    order by c.public_id;
end;
$$;

create or replace function public.set_ruling(p_problem uuid, p_normalized text, p_correct boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.contest_director(public.round_contest((select round_id from problems where id = p_problem))) then
    raise exception 'Only a director can rule on answers.';
  end if;
  if p_correct is null then
    delete from rulings where problem_id = p_problem and normalized = p_normalized;
  else
    insert into rulings (problem_id, normalized, correct, ruled_by) values (p_problem, p_normalized, p_correct, auth.uid())
    on conflict (problem_id, normalized) do update set correct = excluded.correct, ruled_by = excluded.ruled_by, ruled_at = now();
  end if;
end;
$$;

create or replace function public.ask_clarification(p_round uuid, p_question text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c competitors;
  new_id uuid;
begin
  select comp.* into c from competitors comp join teams t on t.id = comp.team_id
  where comp.user_id = auth.uid() and t.contest_id = public.round_contest(p_round);
  if c.id is null then raise exception 'You are not in this contest.'; end if;
  insert into clarifications (round_id, competitor_id, question) values (p_round, c.id, left(trim(p_question), 1000)) returning clarifications.id into new_id;
  return new_id;
end;
$$;

create or replace function public.answer_clarification(p_id uuid, p_answer text, p_broadcast boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  q clarifications;
begin
  select * into q from clarifications where id = p_id;
  if q.id is null or not (public.contest_staff(public.round_contest(q.round_id)) or public.contest_role(public.round_contest(q.round_id), 'proctor')) then
    raise exception 'Only a proctor or director can answer.';
  end if;
  update clarifications set answer = left(trim(p_answer), 2000), broadcast = p_broadcast, answered_at = now() where id = p_id;
end;
$$;

/** The guardian's emailed link carries the competitor id and a token; see waiver_tokens. */
create table if not exists public.waiver_tokens (
  competitor_id uuid primary key references public.competitors (id) on delete cascade,
  token         text not null unique default encode(gen_random_bytes(18), 'base64'),
  created_at    timestamptz not null default now()
);
alter table public.waiver_tokens enable row level security;

create or replace function public.sign_waiver(p_token text, p_signed_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  c competitors;
begin
  select comp.* into c from waiver_tokens w join competitors comp on comp.id = w.competitor_id where w.token = p_token;
  if c.id is null then raise exception 'This link has expired.'; end if;
  if coalesce(length(trim(p_signed_name)), 0) < 4 then raise exception 'Type your full name to sign.'; end if;
  update competitors set waiver_signed_at = coalesce(waiver_signed_at, now()), waiver_signed_by = trim(p_signed_name) where id = c.id;
  return c.public_id;
end;
$$;

-- Execute rights: signed-in users call the test functions; the waiver link works signed out.
revoke all on function public.start_attempt(uuid, text), public.round_problems(uuid), public.save_response(uuid, uuid, text),
  public.submit_guts_set(uuid), public.submit_attempt(uuid), public.log_integrity_event(uuid, text, integer),
  public.set_attempt_lock(uuid, boolean), public.save_paper_sheet(uuid, text, jsonb), public.grader_roster(uuid),
  public.set_ruling(uuid, text, boolean), public.ask_clarification(uuid, text), public.answer_clarification(uuid, text, boolean),
  public.sign_waiver(text, text), private_assert_can_write(public.attempts) from public;
grant execute on function public.start_attempt(uuid, text), public.round_problems(uuid), public.save_response(uuid, uuid, text),
  public.submit_guts_set(uuid), public.submit_attempt(uuid), public.log_integrity_event(uuid, text, integer),
  public.set_attempt_lock(uuid, boolean), public.save_paper_sheet(uuid, text, jsonb), public.grader_roster(uuid),
  public.set_ruling(uuid, text, boolean), public.ask_clarification(uuid, text), public.answer_clarification(uuid, text, boolean)
  to authenticated;
grant execute on function public.sign_waiver(text, text) to anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.organizations, public.memberships, public.contests, public.divisions, public.contest_roles,
  public.rounds, public.problems, public.answer_keys, public.teams, public.competitors, public.zoom_rooms,
  public.email_providers, public.email_templates to authenticated;
