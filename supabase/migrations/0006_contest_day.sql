-- ===========================================================================
-- MathCloud 0006: found by a contest-day rehearsal.
--
--   * Where the organisers enter every team (and so collected waivers
--     themselves), a student's test no longer waits for a waiver on file.
--   * Answers on an individual round are the student's own while it runs:
--     teammates and coaches see them once the round has closed.
--   * Handing in a Guts set is safe to press twice: two teammates on two
--     computers, or a retry, hand in one set, not the next one empty.
--   * Publishing results is one statement, and only for this contest's own
--     students and teams.
--   * Indexes for reading results; two that duplicated others are dropped.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------- waivers

/**
 * Start (or rejoin) the caller's attempt at an online round. A signed waiver
 * is needed only where MathCloud collects waivers: when the organisers enter
 * every team, they collected waivers themselves.
 */
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
  if c.waiver_signed_at is null and public.collects_waivers(r.contest_id) then raise exception 'Your waiver has not been signed yet.'; end if;
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

-- ------------------------------------------------------------ answers

/**
 * Answers on an individual round are the student's own while the round runs:
 * a teammate or coach sees them only once it has closed. Team and Guts
 * answers stay shared by the team, and the organisers and graders see all.
 */
drop policy if exists response_read on public.responses;
create policy response_read on public.responses for select to authenticated using (
  exists (select 1 from attempts a where a.id = attempt_id and (
    public.contest_staff(public.round_contest(a.round_id)) or public.grades_round(a.round_id)
    or (a.competitor_id is null and public.on_team(a.team_id))
    or exists (select 1 from competitors c where c.id = a.competitor_id and c.user_id = auth.uid())
    or (a.competitor_id is not null and public.on_team(public.attempt_team(a.id))
        and (select public.round_state(r) from rounds r where r.id = a.round_id) = 'closed')
  ))
);

-- --------------------------------------------------------------- guts

/**
 * Hand in a Guts set, once. The page says which set it is handing in
 * (p_set): when two teammates press the button on two computers at the same
 * moment, or a slow network retries, the second press finds that set already
 * in and changes nothing, instead of handing in the next set empty.
 */
drop function if exists public.submit_guts_set(uuid);
create or replace function public.submit_guts_set(p_attempt uuid, p_set integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  total integer;
begin
  select * into a from attempts where id = p_attempt for update;
  if a.id is null or not public.on_team(public.attempt_team(a.id)) then raise exception 'No such test.'; end if;
  if p_set is not null and a.sets_submitted >= p_set then return a.sets_submitted; end if;
  perform private_assert_can_write(a);
  select coalesce(max(set_no), 1) into total from problems where round_id = a.round_id;
  if a.sets_submitted >= total then return a.sets_submitted; end if;
  update attempts set sets_submitted = sets_submitted + 1,
                      set_times = set_times || now(),
                      submitted_at = case when sets_submitted + 1 >= total then now() end
  where id = a.id returning sets_submitted into total;
  return total;
end $$;
revoke all on function public.submit_guts_set(uuid, integer) from public, anon;
grant execute on function public.submit_guts_set(uuid, integer) to authenticated;

-- ------------------------------------------------------------ results

/**
 * Publishing in one statement instead of a row at a time, and only for this
 * contest's own students and teams: a result can never land on someone in
 * another contest.
 */
create or replace function public.publish_results(p_contest uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
begin
  if not public.contest_director(p_contest) then raise exception 'Only a director can publish results.'; end if;
  delete from results where contest_id = p_contest;
  if p_rows is null then
    update contests set results_published = false where id = p_contest;
    return 0;
  end if;
  insert into results (contest_id, competitor_id, team_id, data)
  select p_contest, x.competitor_id, x.team_id, x.data
  from (
    select nullif(e ->> 'competitor_id', '')::uuid as competitor_id, nullif(e ->> 'team_id', '')::uuid as team_id, e -> 'data' as data
    from jsonb_array_elements(p_rows) e
  ) x
  where (x.competitor_id is null or exists (select 1 from competitors c join teams t on t.id = c.team_id where c.id = x.competitor_id and t.contest_id = p_contest))
    and (x.team_id is null or exists (select 1 from teams t where t.id = x.team_id and t.contest_id = p_contest));
  get diagnostics n = row_count;
  update contests set results_published = true where id = p_contest;
  return n;
end $$;

-- ---------------------------------------------------------------- indexes

drop index if exists public.responses_attempt;  -- the primary key (attempt_id, problem_id) serves it
drop index if exists public.results_contest;    -- results_one_per_entrant (contest_id, …) serves it
create index if not exists results_competitor on public.results (competitor_id) where competitor_id is not null;
create index if not exists results_team on public.results (team_id) where team_id is not null;
