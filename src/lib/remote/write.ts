/**
 * Every change the connected app sends to Supabase. Small requests only:
 * one row, one function call. Errors are reported and the contest reloaded,
 * so the screen goes back to what the database says.
 */
import type { AgendaItem, Contest, EmailTemplate, Problem, Round, ScoringRecipe, Team, TeamStatus } from '../model';
import { normalize } from '../scoring/answers';
import { client } from './client';
import { reloadSoon, reportError } from './live';
import type { Row } from './map';

type Res<T = unknown> = { data: T | null; error: { message: string } | null };

async function ok<T>(title: string, q: PromiseLike<Res<T>>): Promise<T | null> {
  try {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    reportError(title, e);
    reloadSoon(600);
    return null;
  }
}

/** Like ok(), but the caller handles the refusal (it is the answer, not a fault). */
async function attempt<T>(q: PromiseLike<Res<T>>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await q;
  return { data, error: error?.message ?? null };
}

const rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => client().rpc(fn, args) as unknown as PromiseLike<Res<T>>;
const table = (name: string) => client().from(name);

// ------------------------------------------------------------------ rounds

export const openRound = (id: string) => ok('Round not opened', rpc('open_round', { p_round: id }));
export const closeRound = (id: string) => ok('Round not closed', rpc('close_round', { p_round: id }));

export function saveRoundFields(round: Round) {
  return ok('Round not saved', table('rounds').update({
    name: round.name, short_name: round.short, minutes: round.minutes, starts_at: round.startsAt, grace_seconds: round.graceSeconds,
    mystery: !!round.mystery, integrity: { policy: round.integrity.policy, lock_after: round.integrity.lockAfter }, rules: round.rules,
  }).eq('id', round.id));
}

/** Problems and their keys for one round, as they are now. Keys go with their normalised forms for the live board. */
export async function saveProblems(round: Round, removed: string[] = []) {
  if (removed.length) await ok('Problem not removed', table('problems').delete().in('id', removed));
  if (!round.problems.length) return;
  await ok('Problems not saved', table('problems').upsert(round.problems.map((p) => ({
    id: p.id, round_id: round.id, number: p.number, set_no: p.set ?? null, body: p.text, answer_type: p.answerType, points: p.points,
  }))));
  await ok('Answer key not saved', table('answer_keys').upsert(round.problems.map((p) => ({
    problem_id: p.id, accepted: p.answers.filter((a) => a.trim()), normalized: p.answers.filter((a) => a.trim()).map((a) => normalize(a, p.answerType)),
  }))));
}

// ---------------------------------------------------------------- testing

/** Start or rejoin; returns the attempt row and the problems the student may now see. */
export async function startAttempt(roundId: string, honorName: string): Promise<{ attempt: Row; problems: Row[] } | { error: string }> {
  const started = await attempt<Row>(rpc('start_attempt', { p_round: roundId, p_honor_name: honorName }));
  if (started.error || !started.data) return { error: started.error ?? 'Could not start.' };
  const served = await attempt<Row[]>(rpc('round_problems', { p_attempt: started.data.id }));
  return { attempt: started.data, problems: served.data ?? [] };
}

export const roundProblems = (attemptId: string) => attempt<Row[]>(rpc('round_problems', { p_attempt: attemptId }));

export const saveResponse = (attemptId: string, problemId: string, value: string, normalized: string) =>
  attempt<string>(rpc('save_response', { p_attempt: attemptId, p_problem: problemId, p_value: value, p_normalized: normalized }));

export const submitGutsSet = (attemptId: string) => attempt<number>(rpc('submit_guts_set', { p_attempt: attemptId }));
export const submitAttempt = (attemptId: string) => ok('Not handed in', rpc('submit_attempt', { p_attempt: attemptId }));
export const logEvent = (attemptId: string, kind: string, ms?: number) => attempt<string>(rpc('log_integrity_event', { p_attempt: attemptId, p_kind: kind, p_ms: ms ?? null }));
export const setLock = (attemptId: string, locked: boolean) => ok(locked ? 'Not locked' : 'Not unlocked', rpc('set_attempt_lock', { p_attempt: attemptId, p_locked: locked }));

export const ask = (roundId: string, question: string) => ok('Question not sent', rpc('ask_clarification', { p_round: roundId, p_question: question }));
export const answer = (id: string, text: string, broadcast: boolean) => ok('Answer not sent', rpc('answer_clarification', { p_id: id, p_answer: text, p_broadcast: broadcast }));
export const announce = (roundId: string, text: string) => ok('Announcement not sent', rpc('announce', { p_round: roundId, p_text: text }));

/** The live board for students: scores computed by the database. */
export const gutsBoard = (roundId: string) => attempt<Row[]>(rpc('guts_board', { p_round: roundId }));

// ----------------------------------------------------------------- grading

export const setRuling = (problemId: string, normalized: string, correct: boolean | null) =>
  ok('Ruling not saved', rpc('set_ruling', { p_problem: problemId, p_normalized: normalized, p_correct: correct }));

function normalizedOf(round: Round, values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [pid, v] of Object.entries(values)) {
    const p = round.problems.find((x) => x.id === pid);
    if (p && v.trim()) out[pid] = normalize(v, p.answerType);
  }
  return out;
}

export const paperSheet = (round: Round, code: string, values: Record<string, string>) =>
  ok('Sheet not saved', rpc('save_paper_sheet', { p_round: round.id, p_public_id: code, p_values: values, p_normalized: normalizedOf(round, values) }));

export const paperGutsSet = (round: Round, code: string, setNo: number, values: Record<string, string>) =>
  ok('Set not saved', rpc('save_paper_guts_set', { p_round: round.id, p_code: code, p_set: setNo, p_values: values, p_normalized: normalizedOf(round, values) }));

// ---------------------------------------------------------------- contest

export const saveBoard = (contestId: string, board: Contest['board']) =>
  ok('Board setting not saved', table('contests').update({ board: { freeze_minutes: board.freezeMinutes, revealed: board.revealed } }).eq('id', contestId));

export const saveRecipe = (contestId: string, recipe: ScoringRecipe) => ok('Scoring not saved', table('contests').update({ recipe }).eq('id', contestId));

export const saveRegistration = (contestId: string, reg: Contest['registration']) =>
  ok('Registration not saved', table('contests').update({ registration: { open: reg.open, closes_label: reg.closesLabel, team_min: reg.teamMin, team_max: reg.teamMax } }).eq('id', contestId));

export const saveVenue = (contestId: string, venue: Contest['venue']) =>
  ok('Venue not saved', table('contests').update({ venue: venue ? { name: venue.name, address: venue.address, hall: venue.hall, bring: venue.bring } : null }).eq('id', contestId));

export const saveContestBasics = (c: Contest) =>
  ok('Contest not saved', table('contests').update({ name: c.name, short_name: c.short, time_zone: c.timeZone, date_label: c.dateLabel }).eq('id', c.id));

export const publish = (contestId: string, rows: { competitor_id?: string; team_id?: string; data: unknown }[] | null) =>
  ok('Results not published', rpc('publish_results', { p_contest: contestId, p_rows: rows }));

export const addDivision = (contestId: string, d: { id: string; name: string; mode: string; detail: string }) =>
  ok('Not added', table('divisions').insert({ id: d.id, contest_id: contestId, name: d.name, mode: d.mode, detail: d.detail }));
export const removeDivision = (id: string) => ok('Not removed', table('divisions').delete().eq('id', id));
export const saveDivision = (id: string, patch: { name?: string; detail?: string }) => ok('Not saved', table('divisions').update(patch).eq('id', id));

export const addVenueRoom = (contestId: string, id: string, name: string) => ok('Room not added', table('venue_rooms').insert({ id, contest_id: contestId, name }));
export const renameVenueRoom = (id: string, name: string) => ok('Room not renamed', table('venue_rooms').update({ name }).eq('id', id));
export const addZoomRoom = (contestId: string, id: string, name: string, url: string) => ok('Room not added', table('zoom_rooms').insert({ id, contest_id: contestId, name, url }));
export const saveRoomTeams = (kind: 'zoom' | 'venue', id: string, teamIds: string[]) => ok('Room not saved', table(kind === 'zoom' ? 'zoom_rooms' : 'venue_rooms').update({ team_ids: teamIds }).eq('id', id));
export const removeRoom = (kind: 'zoom' | 'venue', id: string) => ok('Room not removed', table(kind === 'zoom' ? 'zoom_rooms' : 'venue_rooms').delete().eq('id', id));
export const setRoomProctor = (id: string, proctorId: string | null) => ok('Proctor not saved', table('zoom_rooms').update({ proctor_id: proctorId }).eq('id', id));

// ------------------------------------------------------------------ roster

export const setTeamsStatus = (ids: string[], status: TeamStatus) => ok('Not saved', table('teams').update({ status }).in('id', ids));

export function saveTeam(t: Team) {
  return ok('Team not saved', table('teams').update({
    name: t.name, school: t.school, city: t.city, contact_name: t.contactName, contact_email: t.contactEmail, division_id: t.divisionId,
    status: t.status, time_zone: t.timeZone ?? null, notes: t.notes ?? null, disqualified: t.disqualified ?? null, code: t.code,
  }).eq('id', t.id));
}

export const deleteTeam = (id: string) => ok('Team not deleted', table('teams').delete().eq('id', id));

export function saveCompetitor(c: { id: string; name: string; grade: number; guardianName: string; guardianEmail: string; publicId: string; teamId: string; slot: string; waiverSignedAt: string | null; waiverSignedBy?: string | null; checkedInAt?: string | null; disqualified?: string }) {
  return ok('Student not saved', table('competitors').update({
    name: c.name, grade: c.grade || null, guardian_name: c.guardianName || null, guardian_email: c.guardianEmail || null, public_id: c.publicId,
    team_id: c.teamId, slot: c.slot, waiver_signed_at: c.waiverSignedAt, waiver_signed_by: c.waiverSignedBy ?? null,
    checked_in_at: c.checkedInAt ?? null, disqualified: c.disqualified ?? null,
  }).eq('id', c.id));
}

export const removeCompetitor = (id: string) => ok('Student not removed', table('competitors').delete().eq('id', id));
export const checkIn = (id: string, at: string | null) => ok('Check-in not saved', table('competitors').update({ checked_in_at: at }).eq('id', id));
export const reminded = (id: string, at: string) => ok('Not saved', table('competitors').update({ reminder_sent_at: at }).eq('id', id));
export const addCompetitor = (teamId: string, input: { name: string; grade: number; guardianName: string; guardianEmail: string }) =>
  attempt<string>(rpc('add_competitor', { p_team: teamId, p_name: input.name, p_grade: input.grade, p_guardian_name: input.guardianName, p_guardian_email: input.guardianEmail }));
export const markDeviceCheck = (id: string) => ok('Not saved', rpc('mark_device_check', { p_competitor: id }));
export const setTeamMode = (teamId: string, mode: string) => attempt(rpc('set_team_mode', { p_team: teamId, p_mode: mode }));
export const waiverToken = (competitorId: string) => attempt<string>(rpc('waiver_token', { p_competitor: competitorId }));
export const waiverInfo = (token: string) => attempt<Row[]>(rpc('waiver_info', { p_token: token }));
export const signWaiver = (token: string, name: string) => attempt<string>(rpc('sign_waiver', { p_token: token, p_signed_name: name }));
export const joinTeam = (code: string, name: string, grade: number | null, guardianEmail: string) =>
  attempt<string>(rpc('join_team', { p_code: code, p_name: name, p_grade: grade, p_guardian_email: guardianEmail }));

type TeamIn = { mode: string; name: string; school: string; city: string; timeZone?: string; notes?: string; contactName: string; contactEmail: string; students: { name: string; grade: number | null; guardianName: string; guardianEmail: string }[] };
const teamJson = (t: TeamIn) => ({ name: t.name, school: t.school, city: t.city, time_zone: t.timeZone, notes: t.notes, contact_name: t.contactName, contact_email: t.contactEmail });
const studentsJson = (t: TeamIn) => t.students.map((s) => ({ name: s.name, grade: s.grade, guardian_name: s.guardianName, guardian_email: s.guardianEmail }));

export const registerTeam = (contestId: string, t: TeamIn) => attempt<string>(rpc('register_team', { p_contest: contestId, p_mode: t.mode, p_team: teamJson(t), p_students: studentsJson(t) }));
export const importTeams = (contestId: string, teams: TeamIn[], status: string) =>
  attempt<number>(rpc('import_teams', { p_contest: contestId, p_teams: teams.map((t) => ({ mode: t.mode, team: teamJson(t), students: studentsJson(t) })), p_status: status }));

export const log = (contestId: string, teamId: string | undefined, text: string, tone: string) =>
  ok('Not logged', table('activity').insert({ contest_id: contestId, team_id: teamId ?? null, text, tone }));

// ------------------------------------------------------------------- email

export const saveTemplate = (contestId: string, t: EmailTemplate) =>
  ok('Template not saved', table('email_templates').upsert({ id: t.id, contest_id: contestId, name: t.name, trigger: t.trigger, audience: t.audience, subject: t.subject, body: t.body }));

export const addEmailKey = (orgId: string, label: string, from: string, limit: number, secret: string) =>
  attempt<string>(rpc('add_email_key', { p_org: orgId, p_label: label, p_from: from, p_limit: limit, p_secret: secret }));
export const saveEmailKey = (id: string, patch: { label?: string; from_address?: string; daily_limit?: number; active?: boolean }) => ok('Key not saved', table('email_keys').update(patch).eq('id', id));
export const deleteEmailKey = (id: string) => ok('Key not removed', table('email_keys').delete().eq('id', id));

/** Queue messages, then ask the send function to work through the queue with the key pool. */
export async function sendEmails(contestId: string, kind: string, templateId: string | null, messages: { to: string; subject: string; html: string; tag?: string }[]) {
  const queued = await attempt<number>(rpc('queue_emails', { p_contest: contestId, p_kind: kind, p_template: templateId, p_messages: messages }));
  if (queued.error) return { queued: 0, sent: 0, waiting: 0, error: queued.error };
  const { data, error } = await client().functions.invoke('send-email', { body: { contest_id: contestId } });
  if (error) return { queued: queued.data ?? 0, sent: 0, waiting: queued.data ?? 0, error: error.message };
  return { queued: queued.data ?? 0, sent: Number(data?.sent ?? 0), waiting: Number(data?.waiting ?? 0), error: data?.error ?? null, keys: data?.keys };
}

/** Coaches and organisers make sign-ins for students who have no email of their own. */
export async function createStudentLogins(teamId: string) {
  const { data, error } = await client().functions.invoke('accounts', { body: { action: 'student_logins', team_id: teamId } });
  if (error) return { error: error.message, accounts: [] as { name: string; username: string; password: string }[] };
  return { error: data?.error ?? null, accounts: (data?.accounts ?? []) as { name: string; username: string; password: string }[] };
}

// --------------------------------------------------------------- contests

/** Write a new contest and everything in it. Ids are made here, so the screen and the database agree. */
export async function createContest(c: Contest) {
  const sb = client();
  const err = (r: Res) => {
    if (r.error) throw new Error(r.error.message);
  };
  try {
    err(await sb.from('contests').insert({
      id: c.id, org_id: c.orgId, name: c.name, short_name: c.short, slug: c.slug, time_zone: c.timeZone, date_label: c.dateLabel,
      registration: { open: c.registration.open, closes_label: c.registration.closesLabel, team_min: c.registration.teamMin, team_max: c.registration.teamMax },
      recipe: c.recipe, board: { freeze_minutes: c.board.freezeMinutes, revealed: c.board.revealed },
      venue: c.venue ? { name: c.venue.name, address: c.venue.address, hall: c.venue.hall, bring: c.venue.bring } : null,
    }));
    err(await sb.from('divisions').insert(c.divisions.map((d) => ({ id: d.id, contest_id: c.id, name: d.name, mode: d.mode, detail: d.detail }))));
    err(await sb.from('rounds').insert(c.rounds.map((r, i) => ({
      id: r.id, contest_id: c.id, name: r.name, short_name: r.short, kind: r.kind, minutes: r.minutes, starts_at: r.startsAt, status: 'scheduled',
      grace_seconds: r.graceSeconds, mystery: !!r.mystery, integrity: { policy: r.integrity.policy, lock_after: r.integrity.lockAfter }, rules: r.rules, position: i,
    }))));
    const problems: (Problem & { roundId: string })[] = c.rounds.flatMap((r) => r.problems.map((p) => ({ ...p, roundId: r.id })));
    if (problems.length) {
      err(await sb.from('problems').insert(problems.map((p) => ({ id: p.id, round_id: p.roundId, number: p.number, set_no: p.set ?? null, body: p.text, answer_type: p.answerType, points: p.points }))));
      err(await sb.from('answer_keys').insert(problems.map((p) => ({ problem_id: p.id, accepted: p.answers.filter((a) => a.trim()), normalized: [] }))));
    }
    if (c.venue?.rooms.length) err(await sb.from('venue_rooms').insert(c.venue.rooms.map((v) => ({ id: v.id, contest_id: c.id, name: v.name }))));
    if (c.agenda.length) err(await sb.from('agenda_items').insert(c.agenda.map((a: AgendaItem) => ({ id: a.id, contest_id: c.id, at: a.at, title: a.title, round_id: a.roundId ?? null, modes: a.modes, place: a.where ?? null, note: a.note ?? null }))));
    return null;
  } catch (e) {
    reportError('Contest not created', e);
    return e instanceof Error ? e.message : String(e);
  }
}

export const createOrganization = (name: string, slug: string) => attempt<string>(rpc('create_organization', { p_name: name, p_slug: slug }));
