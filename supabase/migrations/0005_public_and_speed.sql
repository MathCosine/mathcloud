-- ===========================================================================
-- MathCloud 0005: a public event page and Guts leaderboard, results kept
-- private, waivers only where MathCloud collects them, and indexes.
--
--   * contests.details: what the public event page shows (about, contact,
--     website, questions and answers) and two switches: the page itself, and
--     the live Guts leaderboard. Both public unless the organisers turn them off.
--   * public_guts_board(slug): the one result anyone may see, signed in or
--     not: team names and Guts scores, frozen like the projector board.
--     Every other result stays visible only to its own student or team, and
--     to the organisers (see result_read in 0003).
--   * Contests whose organisers enter every team (registration.coaches =
--     false) collected waivers themselves: no waiver links, no signing.
--   * Waiver tokens become URL-safe (base64 can contain "/").
--   * Indexes on every column the app filters by, so pages stay fast as a
--     contest grows.
--
-- Safe to run more than once.
-- ===========================================================================

alter table public.contests add column if not exists details jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------ waivers

/** Does MathCloud collect waivers for this contest? Not when the organisers enter every team. */
create or replace function public.collects_waivers(p_contest uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (registration ->> 'coaches')::boolean from contests where id = p_contest), true);
$$;

alter table public.waiver_tokens alter column token set default translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
update public.waiver_tokens set token = translate(token, '+/', '-_') where token ~ '[+/]';

create or replace function public.waiver_token(p_competitor uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c competitors;
begin
  select * into c from competitors where id = p_competitor;
  if c.id is null or not (public.contest_staff(public.team_contest(c.team_id)) or exists (select 1 from teams t where t.id = c.team_id and t.coach_id = auth.uid())) then
    raise exception 'No such competitor.';
  end if;
  if not public.collects_waivers(public.team_contest(c.team_id)) then
    raise exception 'Waivers for this contest are collected by the organisers, not online.';
  end if;
  return (select token from waiver_tokens where competitor_id = c.id);
end $$;

create or replace function public.waiver_info(p_token text)
returns table (competitor_name text, public_id text, contest_name text, guardian_name text, signed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.name, c.public_id, k.name, c.guardian_name, c.waiver_signed_at
  from waiver_tokens w join competitors c on c.id = w.competitor_id join teams t on t.id = c.team_id join contests k on k.id = t.contest_id
  where w.token = p_token and public.collects_waivers(k.id);
$$;

create or replace function public.sign_waiver(p_token text, p_signed_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  c competitors;
begin
  select comp.* into c from waiver_tokens w join competitors comp on comp.id = w.competitor_id where w.token = p_token;
  if c.id is null or not public.collects_waivers(public.team_contest(c.team_id)) then raise exception 'This link has expired.'; end if;
  if coalesce(length(trim(p_signed_name)), 0) < 4 then raise exception 'Type your full name to sign.'; end if;
  if length(p_signed_name) > 200 then raise exception 'That name is too long.'; end if;
  update competitors set waiver_signed_at = coalesce(waiver_signed_at, now()), waiver_signed_by = trim(p_signed_name) where id = c.id;
  return c.public_id;
end;
$$;

-- ------------------------------------------------------- public board

/**
 * The live Guts leaderboard for anyone: the contest's open Guts round (or the
 * last one opened), team names and scores only, frozen exactly like the
 * projector board. Off when the organisers turn the public board off, and
 * empty before Guts has started.
 */
create or replace function public.public_guts_board(p_slug text)
returns table (round_name text, opened_at timestamptz, ends_at timestamptz, frozen boolean, code text, name text, score numeric, sets integer, set_count integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  c contests;
  r rounds;
  cutoff timestamptz;
  total integer;
begin
  select * into c from contests where slug = p_slug order by created_at desc limit 1;
  if c.id is null or coalesce((c.details ->> 'public_board')::boolean, true) is false then return; end if;
  select x.* into r from rounds x where x.contest_id = c.id and x.kind = 'guts' and x.opened_at is not null order by x.opened_at desc limit 1;
  if r.id is null then return; end if;
  select coalesce(max(set_no), 0) into total from problems where round_id = r.id;
  if coalesce((c.board ->> 'freeze_minutes')::integer, 0) > 0 and not coalesce((c.board ->> 'revealed')::boolean, false) then
    cutoff := r.opened_at + make_interval(mins => r.minutes - (c.board ->> 'freeze_minutes')::integer);
    if now() < cutoff then cutoff := null; end if;
  end if;
  return query
    with counted as (
      select a.id, a.team_id as tid, (select count(*)::integer from unnest(a.set_times) x where cutoff is null or x <= cutoff) as n
      from attempts a where a.round_id = r.id and a.team_id is not null
    )
    select r.name, r.opened_at, r.opened_at + make_interval(mins => r.minutes), cutoff is not null, tm.code, tm.name,
           coalesce((
             select sum(p.points) from responses rs join problems p on p.id = rs.problem_id
             left join answer_keys k on k.problem_id = p.id
             left join rulings ru on ru.problem_id = p.id and ru.normalized = rs.normalized
             where rs.attempt_id = cn.id and p.set_no <= cn.n
               and rs.normalized is not null and rs.normalized <> ''
               and (rs.normalized = any (k.normalized) or ru.correct is true)
           ), 0),
           coalesce(cn.n, 0),
           total
    from teams tm left join counted cn on cn.tid = tm.id
    where tm.contest_id = c.id and tm.status <> 'withdrawn' and tm.disqualified is null;
end $$;

revoke all on function public.public_guts_board(text) from public;
grant execute on function public.public_guts_board(text) to anon, authenticated;
revoke all on function public.collects_waivers(uuid) from public;
grant execute on function public.collects_waivers(uuid) to authenticated;

-- ------------------------------------------------------------ indexes

create index if not exists contests_org on public.contests (org_id);
create index if not exists contests_slug on public.contests (slug);
create index if not exists divisions_contest on public.divisions (contest_id);
create index if not exists rounds_contest on public.rounds (contest_id);
create index if not exists teams_contest on public.teams (contest_id);
create index if not exists teams_coach on public.teams (coach_id) where coach_id is not null;
create index if not exists teams_contact on public.teams (lower(contact_email));
create index if not exists competitors_user on public.competitors (user_id) where user_id is not null;
create index if not exists zoom_rooms_contest on public.zoom_rooms (contest_id);
create index if not exists venue_rooms_contest on public.venue_rooms (contest_id);
create index if not exists agenda_contest on public.agenda_items (contest_id);
create index if not exists attempts_round on public.attempts (round_id);
create index if not exists attempts_competitor on public.attempts (competitor_id) where competitor_id is not null;
create index if not exists attempts_team on public.attempts (team_id) where team_id is not null;
create index if not exists integrity_attempt on public.integrity_events (attempt_id);
create index if not exists clarifications_round on public.clarifications (round_id);
create index if not exists templates_contest on public.email_templates (contest_id);
create index if not exists sends_contest_status on public.email_sends (contest_id, status);
create index if not exists sends_key_day on public.email_sends (key_id, sent_at) where key_id is not null;
create index if not exists activity_contest on public.activity (contest_id);
create index if not exists roles_user on public.contest_roles (user_id);
create index if not exists memberships_user on public.memberships (user_id);
create index if not exists email_keys_org on public.email_keys (org_id);
create index if not exists profiles_email on public.profiles (lower(email)) where email is not null;
