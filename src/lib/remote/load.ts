/**
 * Loading from Supabase, kept small on purpose: the free plan counts egress,
 * so this fetches the contest list and then only the contest being looked
 * at, in about fifteen requests, with related rows embedded rather than
 * fetched one by one. Columns that can be large (email bodies) are left out.
 */
import { client } from './client';
import { emptyRows, type Row, type Rows } from './map';

const PAGE = 1000;

type Result = { data: Row[] | null; error: { message: string } | null };

/** Every row of a query, a page at a time (PostgREST returns at most 1000). */
async function paged(build: (from: number, to: number) => PromiseLike<Result>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function rows(q: PromiseLike<Result>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** An `in` filter, split so the URL never gets too long. */
async function inChunks(ids: string[], fetch: (chunk: string[]) => Promise<Row[]>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 80) out.push(...(await fetch(ids.slice(i, i + 80))));
  return out;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)].filter(Boolean) as T[];

export type Loaded = { rows: Rows; contestId: string | null };

/**
 * Everything this person needs for one contest. Which contests they can
 * see comes from what they are: a member of an organisation, a grader or
 * proctor, a coach, a student.
 */
export async function loadAll(uid: string, email: string | null, preferred: string | null): Promise<Loaded> {
  const sb = client();
  const r = emptyRows();
  r.me = { id: uid, email };

  const [memberships, roles, coached, competing] = await Promise.all([
    rows(sb.from('memberships').select('org_id,user_id,role').eq('user_id', uid)),
    rows(sb.from('contest_roles').select('*').eq('user_id', uid)),
    rows(sb.from('teams').select('id,contest_id').eq('coach_id', uid)),
    rows(sb.from('competitors').select('id,team_id,teams(contest_id)').eq('user_id', uid)),
  ]);
  const orgIds = uniq(memberships.map((m) => m.org_id));
  const contestIds = uniq([
    ...roles.map((x) => x.contest_id),
    ...coached.map((t) => t.contest_id),
    ...competing.map((c) => (Array.isArray(c.teams) ? c.teams[0]?.contest_id : c.teams?.contest_id)),
  ]);

  // Contests: those of my organisations, and those I take part in. The
  // contests table is public, so this filter matters.
  const contestRows = [
    ...(orgIds.length ? await rows(sb.from('contests').select('*').in('org_id', orgIds)) : []),
    ...(contestIds.length ? await rows(sb.from('contests').select('*').in('id', contestIds)) : []),
  ];
  r.contests = [...new Map(contestRows.map((c) => [c.id, c])).values()].sort((a, b) => String(b.starts_on ?? '').localeCompare(String(a.starts_on ?? '')) || String(a.slug).localeCompare(String(b.slug)));
  const orgsNeeded = uniq([...orgIds, ...r.contests.map((c) => c.org_id)]);
  r.organizations = orgsNeeded.length ? await rows(sb.from('organizations').select('id,name,slug').in('id', orgsNeeded)) : [];

  // Open where this person works: the one asked for, else a proctor's room, a student's or coach's team, else the newest.
  const firstOf = (ids: (string | undefined)[]) => r.contests.find((c) => ids.includes(c.id));
  const active =
    r.contests.find((c) => c.id === preferred) ??
    firstOf(roles.filter((x) => x.role === 'proctor').map((x) => x.contest_id)) ??
    firstOf(competing.map((c) => (Array.isArray(c.teams) ? c.teams[0]?.contest_id : c.teams?.contest_id))) ??
    firstOf(coached.map((t) => t.contest_id)) ??
    r.contests[0];
  if (!active) {
    r.memberships = memberships;
    r.profiles = await rows(sb.from('profiles').select('id,name,username,managed,email').eq('id', uid));
    return { rows: r, contestId: null };
  }
  await loadContest(r, active.id, uid, active.org_id);
  return { rows: r, contestId: active.id };
}

/** The full detail of one contest, into `r`. */
export async function loadContest(r: Rows, contestId: string, uid: string, orgId: string) {
  const sb = client();
  const staffHere = await rows(sb.from('memberships').select('org_id,user_id,role').eq('org_id', orgId));
  const iAmStaff = staffHere.some((m) => m.user_id === uid && m.role !== 'writer');

  const [divisions, rounds, teams, zoom, venue, agenda, results, roles] = await Promise.all([
    rows(sb.from('divisions').select('*').eq('contest_id', contestId)),
    rows(sb.from('rounds').select('*').eq('contest_id', contestId)),
    paged((a, b) => sb.from('teams').select('*,competitors(*)').eq('contest_id', contestId).order('code').range(a, b)),
    rows(sb.from('zoom_rooms').select('*').eq('contest_id', contestId)),
    rows(sb.from('venue_rooms').select('*').eq('contest_id', contestId)),
    rows(sb.from('agenda_items').select('*').eq('contest_id', contestId)),
    rows(sb.from('results').select('*').eq('contest_id', contestId)),
    rows(sb.from('contest_roles').select('*').eq('contest_id', contestId)),
  ]);
  // Every contest's way of taking part (a row or two each), so the contest menu and
  // linked editions know which is in person and which online without loading them.
  const others = r.contests.filter((c) => c.id !== contestId).map((c) => c.id);
  const otherDivisions = others.length ? await rows(sb.from('divisions').select('*').in('contest_id', others)) : [];
  r.divisions = [...divisions, ...otherDivisions];
  r.rounds = rounds;
  r.teams = teams.map(({ competitors, ...t }) => t);
  r.competitors = teams.flatMap((t) => t.competitors ?? []);
  r.zoom_rooms = zoom;
  r.venue_rooms = venue;
  r.agenda_items = agenda;
  r.results = results;
  r.contest_roles = roles;
  r.memberships = staffHere;

  const roundIds = rounds.map((x) => x.id);
  if (roundIds.length) {
    const [problems, attempts, clarifications] = await Promise.all([
      rows(sb.from('problems').select('*,answer_keys(problem_id,accepted,normalized),rulings(*)').in('round_id', roundIds)),
      paged((a, b) =>
        sb.from('attempts').select('*,responses(attempt_id,problem_id,value,saved_at,saved_by),integrity_events(id,attempt_id,kind,ms,by_user,at)').in('round_id', roundIds).order('id').range(a, b),
      ),
      rows(sb.from('clarifications').select('*').in('round_id', roundIds)),
    ]);
    r.problems = problems.map(({ answer_keys, rulings, ...p }) => p);
    r.answer_keys = problems.flatMap((p) => (Array.isArray(p.answer_keys) ? p.answer_keys : p.answer_keys ? [p.answer_keys] : []));
    r.rulings = problems.flatMap((p) => p.rulings ?? []);
    r.attempts = attempts.map(({ responses, integrity_events, ...a }) => a);
    r.responses = attempts.flatMap((a) => a.responses ?? []);
    r.integrity_events = attempts.flatMap((a) => a.integrity_events ?? []);
    r.clarifications = clarifications;

    // Students cannot read problems directly: they come from round_problems()
    // for each test of their own they have started.
    if (!problems.length) {
      const mine = r.competitors.filter((c) => c.user_id === uid);
      const myIds = new Set([...mine.map((c) => c.id), ...mine.map((c) => c.team_id)]);
      for (const a of r.attempts.filter((x) => x.started_at && x.source === 'online' && myIds.has(x.competitor_id ?? x.team_id))) {
        const { data } = await sb.rpc('round_problems', { p_attempt: a.id });
        if (data) r.served[a.round_id] = (data as Row[]).map((p) => ({ ...p, round_id: a.round_id }));
      }
    }
  }

  if (iAmStaff) {
    const [templates, sends, keys, activity] = await Promise.all([
      rows(sb.from('email_templates').select('*').eq('contest_id', contestId)),
      rows(sb.from('email_sends').select('id,contest_id,template_id,kind,recipient,subject,status,key_id,error,queued_at,sent_at').eq('contest_id', contestId).order('queued_at', { ascending: false }).limit(2000)),
      rows(sb.from('email_keys').select('*').eq('org_id', orgId)),
      rows(sb.from('activity').select('*').eq('contest_id', contestId).order('at', { ascending: false }).limit(500)),
    ]);
    r.email_templates = templates;
    r.email_sends = sends;
    r.email_keys = keys;
    r.activity = activity;
  }

  // Graders and proctors: names and codes, no contact details.
  if (!iAmStaff && roles.some((x) => x.user_id === uid) || (!iAmStaff && zoom.some((z) => z.proctor_id === uid))) {
    const { data } = await sb.rpc('grader_people', { p_contest: contestId });
    const known = new Set([...r.teams.map((t) => t.id), ...r.competitors.map((c) => c.id)]);
    for (const x of (data ?? []) as Row[]) {
      if (known.has(x.id)) continue;
      if (x.kind === 'team') r.teams.push({ id: x.id, contest_id: contestId, code: x.code, name: x.name, division_id: x.division_id, status: x.status, contact_name: '', contact_email: '', registered_at: '', join_code: '' });
      else r.competitors.push({ id: x.id, team_id: x.team_id, public_id: x.code, slot: String(x.code).slice(-1), name: x.name });
    }
  }

  const people = uniq([
    uid,
    ...r.teams.map((t) => t.coach_id),
    ...r.competitors.map((c) => c.user_id),
    ...roles.map((x) => x.user_id),
    ...staffHere.map((m) => m.user_id),
    ...zoom.map((z) => z.proctor_id),
  ]);
  r.profiles = await inChunks(people, (chunk) => rows(sb.from('profiles').select('id,name,username,managed,email').in('id', chunk)));
}
