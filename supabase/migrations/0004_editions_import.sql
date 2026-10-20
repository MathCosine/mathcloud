-- ===========================================================================
-- MathCloud 0004: one way of taking part per contest, and bringing in data
-- from wherever teams signed up before.
--
--   * A contest is in person or online. A competition that runs both at the
--     same time is two contests, linked as editions of each other (linked_id
--     on both). Results never mix; problems are copied once, then separate.
--   * Imports keep what the organiser already has: their own team numbers,
--     IDs from the old system, waivers already collected, and duplicates they
--     chose to keep.
--   * A coach who signs up with the email an organiser imported is linked to
--     those teams; nobody has to ask.
--
-- Safe to run more than once.
-- ===========================================================================

alter table public.contests add column if not exists linked_id uuid references public.contests (id) on delete set null;

/** Link two contests of the same organisation as editions of each other (or unlink with null). */
create or replace function public.link_editions(p_contest uuid, p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  old uuid;
begin
  if not contest_director(p_contest) then raise exception 'Only the organisers can link contests.'; end if;
  if p_other is not null then
    if not contest_director(p_other) then raise exception 'Only the organisers can link contests.'; end if;
    if p_other = p_contest then raise exception 'A contest cannot be its own edition.'; end if;
  end if;
  select linked_id into old from contests where id = p_contest;
  if old is not null then update contests set linked_id = null where id = old and linked_id = p_contest; end if;
  update contests set linked_id = p_other where id = p_contest;
  if p_other is not null then update contests set linked_id = p_contest where id = p_other; end if;
end $$;

-- ---------------------------------------------------------- adding a team

/**
 * The one way a team is created. p_team: {name, school, city, contact_name,
 * contact_email, time_zone, notes, code?, external_id?, allow_duplicate?}.
 * p_students: [{name, grade, guardian_name, guardian_email, external_id?,
 * waiver_signed_by?}]. A student with waiver_signed_by arrives with the
 * waiver recorded (collected on paper, or in the old sign-up system).
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
  want text := nullif(trim(coalesce(p_team ->> 'code', '')), '');
  tid uuid;
  coach uuid := p_coach;
  s jsonb;
  i integer := 0;
  signed_by text;
begin
  select * into c from contests where id = p_contest;
  if c.id is null then raise exception 'No such contest.'; end if;
  select id into d from divisions where contest_id = p_contest and mode = p_mode;
  if d is null then raise exception 'This contest has no % places.', replace(p_mode, '_', ' '); end if;
  if coalesce(trim(p_team ->> 'name'), '') = '' then raise exception 'A team needs a name.'; end if;
  lo := coalesce((c.registration ->> 'team_min')::integer, 1);
  hi := coalesce((c.registration ->> 'team_max')::integer, 4);
  if n < lo or n > hi then raise exception 'Teams have % to % students; % has %.', lo, hi, trim(p_team ->> 'name'), n; end if;
  if coalesce((p_team ->> 'allow_duplicate')::boolean, false) is false
     and exists (select 1 from teams where contest_id = p_contest and lower(name) = lower(trim(p_team ->> 'name'))) then
    raise exception 'A team called % is already registered.', trim(p_team ->> 'name');
  end if;

  -- One registration at a time per contest, so two never get the same code.
  -- Both editions share one lock, since they share the numbers.
  perform pg_advisory_xact_lock(hashtext(least(p_contest, coalesce(c.linked_id, p_contest))::text));
  if want is not null then
    if want !~ '^[A-Za-z0-9]{1,6}$' then raise exception 'Team number % has to be letters and digits, up to 6.', want; end if;
    if exists (select 1 from teams where contest_id in (p_contest, c.linked_id) and lower(code) = lower(want)) then
      raise exception 'Team number % is already taken.', want;
    end if;
    next_code := upper(want);
  else
    -- Numbers run on across both editions, so an ID like 14A means one student on the day.
    select lpad((coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::integer), 0) + 1)::text, 2, '0')
      into next_code from teams where contest_id in (p_contest, c.linked_id);
  end if;

  -- A coach who already has an account with the contact email becomes the team's coach.
  if coach is null and coalesce(p_team ->> 'contact_email', '') <> '' then
    select id into coach from profiles where not managed and lower(email) = lower(trim(p_team ->> 'contact_email')) limit 1;
  end if;

  insert into teams (contest_id, division_id, code, name, school, city, contact_name, contact_email, coach_id, status, time_zone, notes, external_id)
  values (p_contest, d, next_code, trim(p_team ->> 'name'), p_team ->> 'school', p_team ->> 'city',
          coalesce(p_team ->> 'contact_name', ''), coalesce(p_team ->> 'contact_email', ''), coach, p_status,
          case when p_mode = 'online' then p_team ->> 'time_zone' end,
          nullif(p_team ->> 'notes', ''), nullif(p_team ->> 'external_id', ''))
  returning id into tid;

  for s in select * from jsonb_array_elements(p_students) loop
    signed_by := nullif(trim(coalesce(s ->> 'waiver_signed_by', '')), '');
    insert into competitors (team_id, slot, public_id, name, grade, guardian_name, guardian_email, external_id, waiver_signed_at, waiver_signed_by)
    values (tid, chr(65 + i), next_code || chr(65 + i), trim(s ->> 'name'), nullif(s ->> 'grade', '')::integer, s ->> 'guardian_name', s ->> 'guardian_email',
            nullif(s ->> 'external_id', ''), case when signed_by is not null then now() end, signed_by);
    i := i + 1;
  end loop;

  perform place_team(tid);
  return tid;
end $$;

/** Coaches register from the contest's form, unless the organisers run the contest on their own. */
create or replace function public.register_team(p_contest uuid, p_mode text, p_team jsonb, p_students jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  reg jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to register a team.'; end if;
  select registration into reg from contests where id = p_contest;
  if coalesce((reg ->> 'coaches')::boolean, true) is false then raise exception 'The organisers enter every team for this contest.'; end if;
  if not coalesce((reg ->> 'open')::boolean, false) then raise exception 'Registration is closed.'; end if;
  return add_team(p_contest, p_mode, p_team - 'code' - 'allow_duplicate' - 'external_id', p_students, 'pending', auth.uid());
end $$;

/**
 * The organisers bring in teams who signed up elsewhere, and get back the new
 * teams' ids (so the import can be undone). All or nothing.
 */
create or replace function public.import_team_rows(p_contest uuid, p_teams jsonb, p_status text default 'confirmed')
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  ids uuid[] := '{}';
begin
  if not contest_director(p_contest) then raise exception 'Only the organisers can import teams.'; end if;
  if p_status not in ('pending', 'confirmed') then raise exception 'Imported teams are pending or confirmed.'; end if;
  for t in select * from jsonb_array_elements(p_teams) loop
    ids := ids || add_team(p_contest, t ->> 'mode', t -> 'team', t -> 'students', p_status, null);
  end loop;
  return ids;
end $$;

-- ----------------------------------------------------- coaches link up

/** When someone signs up, the teams imported with their email become theirs to see. */
create or replace function public.link_imported_teams()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and not new.managed then
    update teams set coach_id = new.id where coach_id is null and lower(contact_email) = lower(new.email);
  end if;
  return new;
end $$;

drop trigger if exists on_profile_link_teams on public.profiles;
create trigger on_profile_link_teams after insert on public.profiles for each row execute function public.link_imported_teams();
