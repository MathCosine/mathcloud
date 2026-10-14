/**
 * Every change the app makes goes through here.
 *
 * In the sandbox each function applies the same rules the Postgres functions
 * apply, so it behaves like the real thing. Connected to Supabase, the change
 * is applied here at once (so the screen answers immediately) and sent to
 * the database (remote/write.ts), which has the final say: if it refuses,
 * the person sees why and the contest is reloaded. Things only the server
 * can make (a started test, a registered team) are sent first and appear
 * when it answers.
 */
import type {
  AgendaItem, Attempt, Competitor, Contest, DB, Division, DivisionMode, EmailTemplate, IntegrityEvent, Problem, PublishedResult, Round, Team, TeamStatus, User,
} from './model';
import { activeContestId, getDB, REMOTE, setActiveContest, update } from './store';
import { roundEnds, roundState } from './time';
import { normalize } from './scoring/answers';
import { computeStandings, type Standings } from './scoring/engine';
import * as W from './remote/write';
import { client, loginEmail } from './remote/client';
import type { Row } from './remote/map';
import { mapAttempt, problemOf } from './remote/map';

const nowIso = () => new Date().toISOString();
/** Ids made here are UUIDs when connected, so the screen and the database agree on them. */
const uid = (p: string) => (REMOTE ? crypto.randomUUID() : `${p}-${Math.random().toString(36).slice(2, 9)}`);

export function contestOf(db: DB, id = activeContestId()): Contest {
  return db.contests.find((c) => c.id === id) ?? db.contests[0];
}

function roundIn(db: DB, roundId: string): Round {
  const r = db.contests.flatMap((c) => c.rounds).find((x) => x.id === roundId);
  if (!r) throw new Error(`No round ${roundId}`);
  return r;
}

function logActivity(db: DB, teamId: string | undefined, text: string, tone: '' | 'b' | 'g' | 'a') {
  db.activity.push({ id: uid('a'), teamId, at: nowIso(), text, tone });
  if (REMOTE) void W.log(contestOf(db).id, teamId, text, tone);
}

// ------------------------------------------------------------------ signing in

export type SignInResult = { userId: string } | { error: string };

/** Email, or a username for students without email. One message for both failures, so it never says which half was wrong. */
export async function signIn(login: string, password: string): Promise<SignInResult> {
  const wrong = { error: 'That email or username and password do not match an account.' };
  if (!REMOTE) {
    const l = login.trim().toLowerCase();
    const u = getDB().users.find((x) => x.email.toLowerCase() === l && x.password === password);
    return u ? { userId: u.id } : wrong;
  }
  const { data, error } = await client().auth.signInWithPassword({ email: loginEmail(login), password });
  if (error || !data.user) return error?.message?.includes('confirm') ? { error: 'Confirm your email first: open the link we sent you.' } : wrong;
  return { userId: data.user.id };
}

export async function signUp(input: { name: string; email: string; password: string }): Promise<{ error: string | null; needsConfirm?: boolean }> {
  if (!REMOTE) return { error: 'The sandbox has fixed demo accounts. Connect Supabase to make real ones.' };
  const { data, error } = await client().auth.signUp({ email: input.email.trim(), password: input.password, options: { data: { name: input.name.trim() }, emailRedirectTo: location.origin + import.meta.env.BASE_URL } });
  if (error) return { error: error.message };
  return { error: null, needsConfirm: !data.session };
}

export async function signOut() {
  if (REMOTE) await client().auth.signOut();
}

export async function sendPasswordReset(email: string) {
  if (!REMOTE) return { error: 'Not in the sandbox.' };
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + import.meta.env.BASE_URL + 'account' });
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------- rounds

export function openRound(roundId: string) {
  update((db) => {
    const r = roundIn(db, roundId);
    r.status = 'open';
    r.openedAt = nowIso();
    if (r.kind === 'guts') contestOf(db).board.revealed = false;
    // Reopening starts the round afresh.
    db.attempts = db.attempts.filter((a) => !(a.roundId === roundId && a.source === 'online'));
  });
  if (REMOTE) void W.openRound(roundId);
}

export function closeRound(roundId: string) {
  update((db) => {
    const r = roundIn(db, roundId);
    r.status = 'closed';
    for (const a of db.attempts) if (a.roundId === roundId && a.startedAt && !a.submittedAt) a.submittedAt = nowIso();
  });
  if (REMOTE) void W.closeRound(roundId);
}

/** Change a round's settings or its problems. Problems removed here are removed in the database too. */
export function saveRound(roundId: string, patch: Partial<Round>) {
  const before = roundIn(getDB(), roundId).problems.map((p) => p.id);
  update((db) => {
    Object.assign(roundIn(db, roundId), patch);
  });
  if (!REMOTE) return;
  const round = roundIn(getDB(), roundId);
  if (patch.problems) {
    const removed = before.filter((id) => !round.problems.some((p) => p.id === id));
    void W.saveProblems(round, removed);
  }
  if (Object.keys(patch).some((k) => k !== 'problems')) void W.saveRoundFields(round);
}

/** A new, empty problem at the end of a round (or of a Guts set). */
export function newProblem(round: Round, set?: number): Problem {
  const number = Math.max(0, ...round.problems.map((p) => p.number)) + 1;
  const last = round.problems[round.problems.length - 1];
  return { id: uid('p'), number, set: round.kind === 'guts' ? set ?? last?.set ?? 1 : undefined, text: '', answers: [''], answerType: 'integer', points: last?.points ?? 1 };
}

// -------------------------------------------------------------------- attempts

export type SaveResult = { ok: true } | { ok: false; reason: string };

/** Start (or rejoin) an online attempt. Team rounds share one attempt per team. Resolves to an error message, or null. */
export async function startAttempt(roundId: string, entrantId: string, honorName: string): Promise<string | null> {
  if (REMOTE) {
    const r = await W.startAttempt(roundId, honorName);
    if ('error' in r) return r.error;
    servedProblems(roundId, r.problems);
    update((db) => {
      const a = { ...mapAttempt(r.attempt) };
      const i = db.attempts.findIndex((x) => x.id === a.id);
      if (i >= 0) db.attempts[i] = { ...a, responses: db.attempts[i].responses, events: db.attempts[i].events };
      else db.attempts.push(a);
    });
    return null;
  }
  let error: string | null = 'This round is not open.';
  update((db) => {
    const round = roundIn(db, roundId);
    if (roundState(round) !== 'open') return;
    error = null;
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === entrantId);
    if (!a) {
      a = {
        id: `${roundId}:${entrantId}`, roundId, entrantId, source: 'online', startedAt: nowIso(),
        deadline: new Date(roundEnds(round)!).toISOString(), responses: {}, events: [], honorName,
        ...(round.kind === 'guts' ? { setsSubmitted: 0, setTimes: [] } : {}),
      };
      db.attempts.push(a);
    } else if (!a.startedAt) {
      a.startedAt = nowIso();
    }
  });
  return error;
}

/** Problems the server just served to a student (no answers), merged into the round. */
function servedProblems(roundId: string, rows: Row[]) {
  if (!rows.length) return;
  update((db) => {
    const round = roundIn(db, roundId);
    const keys = new Map<string, Row>();
    for (const row of rows) {
      const p = problemOf({ ...row, round_id: roundId }, keys);
      const i = round.problems.findIndex((x) => x.id === p.id);
      if (i >= 0) round.problems[i] = { ...p, answers: round.problems[i].answers };
      else round.problems.push(p);
    }
    round.problems.sort((a, b) => a.number - b.number);
  });
}

function deadlinePassed(db: DB, a: Attempt) {
  const round = roundIn(db, a.roundId);
  return !!a.deadline && Date.now() > new Date(a.deadline).getTime() + round.graceSeconds * 1000;
}

export function saveResponse(attemptId: string, problemId: string, value: string, userId: string): SaveResult {
  let result: SaveResult = { ok: true };
  let problem: Problem | undefined;
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a) return void (result = { ok: false, reason: 'No such test.' });
    const round = roundIn(db, a.roundId);
    if (a.submittedAt) return void (result = { ok: false, reason: 'This test has been handed in.' });
    if (deadlinePassed(db, a)) return void (result = { ok: false, reason: 'Time is up. This answer was not saved.' });
    if (a.locked) return void (result = { ok: false, reason: 'Your test is locked. Ask your proctor to unlock it.' });
    const p = round.problems.find((x) => x.id === problemId);
    if (!p) return void (result = { ok: false, reason: 'No such problem.' });
    if (round.kind === 'guts' && p.set !== (a.setsSubmitted ?? 0) + 1) return void (result = { ok: false, reason: 'That set is closed.' });
    a.responses[problemId] = { value: value.slice(0, 120), savedAt: nowIso(), by: userId };
    problem = p;
  });
  if (REMOTE && result.ok && problem) {
    const p = problem;
    void W.saveResponse(attemptId, problemId, value.slice(0, 120), normalize(value, p.answerType)).then((r) => {
      if (r.error) remoteRefused('Not saved', r.error);
    });
  }
  return result;
}

let refusedListener: ((title: string, reason: string) => void) | null = null;
/** The test portal hears about refusals (time up, locked) to show them where the student is looking. */
export function onRefused(fn: ((title: string, reason: string) => void) | null) {
  refusedListener = fn;
}
function remoteRefused(title: string, reason: string) {
  refusedListener?.(title, reason);
}

export function submitGutsSet(attemptId: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a || a.submittedAt || deadlinePassed(db, a)) return;
    const round = roundIn(db, a.roundId);
    const sets = Math.max(...round.problems.map((p) => p.set ?? 1), REMOTE ? 6 : 1);
    a.setsSubmitted = Math.min(sets, (a.setsSubmitted ?? 0) + 1);
    a.setTimes = [...(a.setTimes ?? []), nowIso()].slice(0, sets);
    if (!REMOTE && a.setsSubmitted >= sets) a.submittedAt = nowIso();
  });
  if (!REMOTE) return;
  const roundId = getDB().attempts.find((a) => a.id === attemptId)?.roundId;
  void W.submitGutsSet(attemptId).then(async (r) => {
    if (r.error) return remoteRefused('Set not handed in', r.error);
    const served = await W.roundProblems(attemptId);
    if (roundId && served.data) servedProblems(roundId, served.data);
  });
}

export function submitAttempt(attemptId: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (a && !a.submittedAt) a.submittedAt = nowIso();
  });
  if (REMOTE) void W.submitAttempt(attemptId);
}

const COUNTED: IntegrityEvent['kind'][] = ['hidden', 'blur', 'fullscreen_exit'];

/** Log an integrity event; returns what the page should do about it. */
export function logEvent(attemptId: string, event: Omit<IntegrityEvent, 'at'> & { at?: string }): 'none' | 'warn' | 'lock' {
  let outcome: 'none' | 'warn' | 'lock' = 'none';
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a || a.submittedAt) return;
    a.events.push({ at: event.at ?? nowIso(), kind: event.kind, ms: event.ms, by: event.by });
    if (!COUNTED.includes(event.kind)) return;
    const round = roundIn(db, a.roundId);
    const count = a.events.filter((e) => COUNTED.includes(e.kind)).length;
    if (round.integrity.policy === 'lock' && count >= round.integrity.lockAfter && !a.locked) {
      a.locked = true;
      a.events.push({ at: nowIso(), kind: 'locked' });
      outcome = 'lock';
    } else if (round.integrity.policy !== 'log') {
      a.events.push({ at: nowIso(), kind: 'warned' });
      outcome = 'warn';
    }
  });
  if (REMOTE && ['hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'offline', 'second_session'].includes(event.kind)) void W.logEvent(attemptId, event.kind, event.ms);
  return outcome;
}

export function unlockAttempt(attemptId: string, by: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a) return;
    a.locked = false;
    a.events.push({ at: nowIso(), kind: 'unlocked', by });
  });
  if (REMOTE) void W.setLock(attemptId, false);
}

export function lockAttempt(attemptId: string, by: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a) return;
    a.locked = true;
    a.events.push({ at: nowIso(), kind: 'locked', by });
  });
  if (REMOTE) void W.setLock(attemptId, true);
}

// ------------------------------------------------------------- clarifications

/** Connected, questions and announcements appear when the database has them (a moment later, by realtime). */
export function askClarification(roundId: string, competitorId: string, question: string) {
  if (REMOTE) return void W.ask(roundId, question.trim());
  update((db) => {
    db.clarifications.push({ id: uid('cl'), roundId, fromCompetitorId: competitorId, question: question.trim(), broadcast: false, at: nowIso() });
  });
}

export function answerClarification(id: string, answer: string, broadcast: boolean) {
  update((db) => {
    const c = db.clarifications.find((x) => x.id === id);
    if (!c) return;
    c.answer = answer.trim();
    c.broadcast = broadcast;
    c.answeredAt = nowIso();
  });
  if (REMOTE) void W.answer(id, answer.trim(), broadcast);
}

export function broadcast(roundId: string, text: string) {
  if (REMOTE) return void W.announce(roundId, text.trim());
  update((db) => {
    db.clarifications.push({ id: uid('cl'), roundId, question: '', answer: text.trim(), broadcast: true, at: nowIso(), answeredAt: nowIso() });
  });
}

// --------------------------------------------------------------------- grading

export function setRuling(roundId: string, problemId: string, normalized: string, correct: boolean | null, by: string) {
  update((db) => {
    db.rulings = db.rulings.filter((r) => !(r.problemId === problemId && r.normalized === normalized));
    if (correct !== null) db.rulings.push({ roundId, problemId, normalized, correct, by, at: nowIso() });
  });
  if (REMOTE) void W.setRuling(problemId, normalized, correct);
}

const codeOf = (db: DB, entrantId: string) => db.competitors.find((c) => c.id === entrantId)?.publicId ?? db.teams.find((t) => t.id === entrantId)?.code ?? entrantId;

/** Save a keyed paper sheet. Blanks are kept: a blank is the competitor's answer. */
export function savePaperSheet(roundId: string, entrantId: string, values: Record<string, string>, by: string) {
  update((db) => {
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === entrantId);
    if (!a) {
      a = { id: uid('att'), roundId, entrantId, source: 'paper', responses: {}, events: [] };
      db.attempts.push(a);
    }
    const at = nowIso();
    a.responses = {};
    for (const [pid, v] of Object.entries(values)) if (v.trim()) a.responses[pid] = { value: v.trim(), savedAt: at, by };
    a.submittedAt = at;
  });
  if (REMOTE) void W.paperSheet(roundIn(getDB(), roundId), codeOf(getDB(), entrantId), values);
}

/**
 * Key one Guts set from a paper sheet. Sets come in one at a time during the
 * round, and each keyed set goes on the live board at once.
 */
export function savePaperGutsSet(roundId: string, teamId: string, setNo: number, values: Record<string, string>, by: string) {
  update((db) => {
    const round = roundIn(db, roundId);
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === teamId);
    if (!a) {
      a = { id: uid('att'), roundId, entrantId: teamId, source: 'paper', responses: {}, events: [], setsSubmitted: 0, setTimes: [] };
      db.attempts.push(a);
    }
    const at = nowIso();
    for (const p of round.problems.filter((x) => x.set === setNo)) {
      const v = (values[p.id] ?? '').trim();
      if (v) a.responses[p.id] = { value: v, savedAt: at, by };
      else delete a.responses[p.id];
    }
    const times = a.setTimes ?? [];
    // Re-keying a set keeps its original time; a new set is stamped now.
    if (setNo > times.length) {
      for (let s = times.length; s < setNo; s++) times[s] = at;
    }
    a.setTimes = times;
    a.setsSubmitted = Math.max(a.setsSubmitted ?? 0, setNo);
    const sets = Math.max(...round.problems.map((p) => p.set ?? 1));
    if (a.setsSubmitted >= sets) a.submittedAt = a.submittedAt ?? at;
  });
  if (REMOTE) void W.paperGutsSet(roundIn(getDB(), roundId), codeOf(getDB(), teamId), setNo, values);
}

export function setBoard(patch: Partial<Contest['board']>) {
  update((db) => {
    Object.assign(contestOf(db).board, patch);
  });
  if (REMOTE) void W.saveBoard(contestOf(getDB()).id, contestOf(getDB()).board);
}

// --------------------------------------------------------------------- results

export function updateRecipe(fn: (c: Contest) => void) {
  update((db) => fn(contestOf(db)));
  if (REMOTE) void W.saveRecipe(contestOf(getDB()).id, contestOf(getDB()).recipe);
}

/** What each competitor and team will see once results are out. */
export function resultRows(contest: Contest, standings: Standings, db: DB): PublishedResult[] {
  const out: PublishedResult[] = [];
  for (const d of contest.divisions) {
    const inds = standings.individuals[d.id] ?? [];
    const tms = standings.teams[d.id] ?? [];
    for (const t of tms) {
      out.push({ teamId: t.team.id, data: { name: t.team.name, division: d.name, place: t.place, of: tms.length, score: t.total, award: t.award ?? null, rounds: t.parts.map((p) => ({ name: p.label, score: p.weighted, max: p.max * p.weight })) } });
    }
    for (const r of inds) {
      const t = tms.find((x) => x.team.id === r.team.id);
      out.push({
        competitorId: r.competitor.id,
        data: {
          name: r.competitor.name, publicId: r.competitor.publicId, division: d.name, place: r.place, of: inds.length, score: r.score, max: r.max, award: r.award ?? null,
          problems: r.results.map((x) => ({ number: x.number, status: x.status })),
          team: t ? { name: t.team.name, place: t.place, of: tms.length, total: t.total } : undefined,
        },
      });
    }
  }
  // Competitors with no Individual score still get their team's result.
  for (const c of db.competitors) {
    if (out.some((x) => x.competitorId === c.id)) continue;
    const team = db.teams.find((t) => t.id === c.teamId);
    const d = contest.divisions.find((x) => x.id === team?.divisionId);
    const tr = d ? standings.teams[d.id]?.find((x) => x.team.id === c.teamId) : undefined;
    if (!team || !d || team.status === 'withdrawn') continue;
    out.push({ competitorId: c.id, data: { name: c.name, publicId: c.publicId, division: d.name, place: null, of: standings.individuals[d.id]?.length ?? 0, score: 0, award: null, team: tr ? { name: team.name, place: tr.place, of: standings.teams[d.id].length, total: tr.total } : undefined } });
  }
  return out;
}

export function setPublished(published: boolean) {
  update((db) => {
    contestOf(db).resultsPublished = published;
  });
  if (!REMOTE) return;
  const db = getDB();
  const contest = contestOf(db);
  if (!published) return void W.publish(contest.id, null);
  const standings = computeStandings({ contest, teams: db.teams.filter((t) => t.contestId === contest.id), competitors: db.competitors, attempts: db.attempts, rulings: db.rulings });
  void W.publish(contest.id, resultRows(contest, standings, db).map((r) => ({ competitor_id: r.competitorId, team_id: r.teamId, data: r.data })));
}

// ---------------------------------------------------------------------- roster

export function setTeamStatus(teamIds: string[], status: TeamStatus, by: string) {
  update((db) => {
    for (const t of db.teams) {
      if (!teamIds.includes(t.id) || t.status === status) continue;
      t.status = status;
      logActivity(db, t.id, status === 'confirmed' ? `Confirmed by ${by}` : `Marked ${status} by ${by}`, status === 'confirmed' ? 'g' : '');
    }
  });
  if (REMOTE) void W.setTeamsStatus(teamIds, status);
}

/** Edit a team's registration: anything the coach typed, its code, its division. */
export function saveTeam(next: Team, by: string) {
  let changed = '';
  update((db) => {
    const i = db.teams.findIndex((t) => t.id === next.id);
    if (i < 0) return;
    const before = db.teams[i];
    changed = (['name', 'school', 'city', 'contactName', 'contactEmail', 'code', 'divisionId', 'status', 'timeZone', 'notes'] as const)
      .filter((k) => (before[k] ?? '') !== (next[k] ?? ''))
      .join(', ');
    if (before.code !== next.code) {
      // Competitor IDs follow the team code.
      for (const c of db.competitors.filter((x) => x.teamId === next.id)) c.publicId = `${next.code}${c.slot}`;
    }
    db.teams[i] = { ...next };
    if (changed) logActivity(db, next.id, `Registration edited by ${by} (${changed})`, 'b');
  });
  if (!REMOTE || !changed) return;
  void W.saveTeam(next);
  const code = getDB().teams.find((t) => t.id === next.id)?.code;
  for (const c of getDB().competitors.filter((x) => x.teamId === next.id)) if (c.publicId !== `${code}${c.slot}`) void W.saveCompetitor(c);
  if (changed.includes('code')) for (const c of getDB().competitors.filter((x) => x.teamId === next.id)) void W.saveCompetitor(c);
}

export function deleteTeam(teamId: string, by: string) {
  const t = getDB().teams.find((x) => x.id === teamId);
  update((db) => {
    db.teams = db.teams.filter((x) => x.id !== teamId);
    db.competitors = db.competitors.filter((c) => c.teamId !== teamId);
    db.attempts = db.attempts.filter((a) => a.entrantId !== teamId);
    const c = contestOf(db);
    for (const r of c.rooms) r.teamIds = r.teamIds.filter((x) => x !== teamId);
    for (const r of c.venue?.rooms ?? []) r.teamIds = r.teamIds.filter((x) => x !== teamId);
  });
  if (REMOTE) {
    void W.deleteTeam(teamId);
    if (t) void W.log(contestOf(getDB()).id, undefined, `Team ${t.code}, ${t.name}, deleted by ${by}`, '');
  }
}

/** Edit a student: name, grade, guardian, ID, team, waiver. */
export function saveCompetitor(next: Competitor, by: string) {
  let changed = '';
  update((db) => {
    const i = db.competitors.findIndex((c) => c.id === next.id);
    if (i < 0) return;
    const before = db.competitors[i];
    changed = (['name', 'grade', 'guardianName', 'guardianEmail', 'publicId', 'teamId', 'waiverSignedAt', 'checkedInAt', 'disqualified'] as const)
      .filter((k) => (before[k] ?? '') !== (next[k] ?? ''))
      .join(', ');
    db.competitors[i] = { ...next };
    if (changed) logActivity(db, next.teamId, `${next.name} (${next.publicId}) edited by ${by}`, 'b');
  });
  if (REMOTE && changed) void W.saveCompetitor(next);
}

/** Move a student to another team: they take its first free letter and a new ID. */
export function moveCompetitor(competitorId: string, toTeamId: string, by: string): string | null {
  const db0 = getDB();
  const c = db0.competitors.find((x) => x.id === competitorId);
  const to = db0.teams.find((t) => t.id === toTeamId);
  if (!c || !to) return 'No such student or team.';
  const max = contestOf(db0).registration.teamMax;
  const taken = new Set(db0.competitors.filter((x) => x.teamId === toTeamId).map((x) => x.slot));
  const slot = 'ABCDEFGH'.slice(0, Math.max(max, 1)).split('').find((s) => !taken.has(s));
  if (!slot) return `${to.name} is full.`;
  saveCompetitor({ ...c, teamId: to.id, slot, publicId: `${to.code}${slot}` }, by);
  return null;
}

export function remindWaiver(competitorId: string, by: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c) return;
    c.reminderSentAt = nowIso();
    logActivity(db, c.teamId, `Waiver reminder sent to ${c.guardianName || c.guardianEmail} by ${by}`, 'a');
  });
  if (REMOTE) void W.reminded(competitorId, nowIso());
}

/** Record a waiver that came another way: on paper at check-in, by email. Null takes it back. */
export function markWaiver(competitorId: string, how: string | null, by: string) {
  const c = getDB().competitors.find((x) => x.id === competitorId);
  if (!c) return;
  saveCompetitor({ ...c, waiverSignedAt: how ? nowIso() : null, waiverSignedBy: how ? `${how} (recorded by ${by})` : null }, by);
}

export function signWaiver(competitorId: string, signedName: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c || c.waiverSignedAt) return;
    c.waiverSignedAt = nowIso();
    c.waiverSignedBy = signedName;
    db.activity.push({ id: uid('a'), teamId: c.teamId, at: nowIso(), text: `Waiver for ${c.publicId} signed by ${signedName}`, tone: 'g' });
  });
}

/** Add a student to a team. Resolves to an error, or null. */
export async function addCompetitor(teamId: string, input: { name: string; grade: number; guardianName: string; guardianEmail: string }, by: string): Promise<string | null> {
  if (REMOTE) {
    const r = await W.addCompetitor(teamId, input);
    return r.error;
  }
  let error: string | null = null;
  update((db) => {
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) return void (error = 'No such team.');
    const max = contestOf(db).registration.teamMax;
    const taken = new Set(db.competitors.filter((c) => c.teamId === teamId).map((c) => c.slot));
    const slot = 'ABCDEFGH'.slice(0, Math.max(1, max)).split('').find((s) => !taken.has(s));
    if (!slot) return void (error = 'The team is full.');
    const id = `c${team.code}${slot}-${Math.random().toString(36).slice(2, 5)}`;
    db.competitors.push({ id, teamId, slot, publicId: `${team.code}${slot}`, name: input.name.trim(), grade: input.grade, guardianName: input.guardianName.trim(), guardianEmail: input.guardianEmail.trim(), waiverSignedAt: null });
    db.users.push({ id: `u-${id}`, email: `${contestOf(db).slug.split('-')[0]}-${team.code}${slot}`.toLowerCase(), name: input.name.trim(), role: 'student', password: 'demo', competitorId: id, managed: true });
    logActivity(db, teamId, `${input.name.trim()} added as ${team.code}${slot} by ${by}; waiver request sent to ${input.guardianName.trim() || input.guardianEmail.trim()}`, 'b');
  });
  return error;
}

export function removeCompetitor(competitorId: string, by: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c) return;
    db.competitors = db.competitors.filter((x) => x.id !== competitorId);
    db.users = db.users.filter((u) => u.competitorId !== competitorId);
    logActivity(db, c.teamId, `${c.name} (${c.publicId}) removed by ${by}`, '');
  });
  if (REMOTE) void W.removeCompetitor(competitorId);
}

export function checkIn(competitorId: string) {
  let at: string | null = null;
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (c) c.checkedInAt = at = c.checkedInAt ? null : nowIso();
  });
  if (REMOTE) void W.checkIn(competitorId, at);
}

// ----------------------------------------------------------------------- email

export function saveTemplate(t: EmailTemplate) {
  update((db) => {
    const i = db.templates.findIndex((x) => x.id === t.id);
    if (i >= 0) db.templates[i] = t;
    else db.templates.push(t);
  });
  if (REMOTE) void W.saveTemplate(contestOf(getDB()).id, t);
}

export type Message = { to: string; subject: string; html: string; tag?: string };

/**
 * Send messages through the organisation's keys. Each key sends up to its own
 * daily limit; what does not fit today waits in the queue and goes out on the
 * next send. In the sandbox nothing leaves the browser: it is only counted.
 */
export async function sendMessages(kind: string, templateId: string | null, messages: Message[]): Promise<{ sent: number; waiting: number; error: string | null }> {
  const db = getDB();
  const contest = contestOf(db);
  if (REMOTE) {
    const r = await W.sendEmails(contest.id, kind, templateId, messages);
    const { reload } = await import('./remote/live');
    void reload();
    return { sent: r.sent, waiting: r.waiting, error: r.error ?? null };
  }
  const org = db.orgs.find((o) => o.id === contest.orgId) ?? db.orgs[0];
  const keys = (org.emailKeys ?? []).filter((k) => k.active);
  const capacity = keys.length ? keys.reduce((n, k) => n + k.dailyLimit, 0) : org.emailProvider.dailyLimit;
  let sent = 0;
  let waiting = 0;
  update((d) => {
    const today = new Date().toDateString();
    const sentToday = d.sends.filter((s) => s.status === 'sent' && new Date(s.at).toDateString() === today).length;
    let room = Math.max(0, capacity - sentToday);
    for (const m of messages) {
      const key = `${templateId ?? kind}:${m.to.toLowerCase()}${m.tag ? `:${m.tag}` : ''}`;
      if (d.sends.some((s) => `${s.templateId ?? s.kind}:${s.to.toLowerCase()}${(s as { tag?: string }).tag ? `:${(s as { tag?: string }).tag}` : ''}` === key && s.status !== 'failed')) continue;
      const status = room > 0 ? 'sent' : 'queued';
      if (room > 0) room--;
      d.sends.push({ id: uid('s'), templateId, kind, to: m.to, subject: m.subject, at: nowIso(), status, keyId: keys[0]?.id ?? null });
      if (status === 'sent') sent++;
      else waiting++;
    }
  });
  return { sent, waiting, error: null };
}

/** Kept for the template screen: send a template to these addresses. Returns [today, later]. */
export function queueSends(templateId: string, recipients: string[]): [number, number] {
  let counts: [number, number] = [0, 0];
  void sendMessages('template', templateId, recipients.map((to) => ({ to, subject: '', html: '' }))).then((r) => (counts = [r.sent, r.waiting]));
  const db = getDB();
  const fresh = recipients.filter((to) => db.sends.some((s) => s.templateId === templateId && s.to === to));
  counts = [db.sends.filter((s) => s.templateId === templateId && s.status === 'sent' && fresh.includes(s.to)).length, db.sends.filter((s) => s.templateId === templateId && s.status === 'queued' && fresh.includes(s.to)).length];
  return counts;
}

export async function addEmailKey(label: string, from: string, limit: number, secret: string): Promise<string | null> {
  const db = getDB();
  const org = db.orgs.find((o) => o.id === contestOf(db).orgId) ?? db.orgs[0];
  if (!org) return 'No organisation.';
  if (REMOTE) {
    const r = await W.addEmailKey(org.id, label, from, limit, secret);
    if (r.error) return r.error;
    const { reload } = await import('./remote/live');
    await reload();
    return null;
  }
  update((d) => {
    const o = d.orgs.find((x) => x.id === org.id)!;
    o.emailKeys = [...(o.emailKeys ?? []), { id: uid('key'), label, from, dailyLimit: limit, active: true }];
  });
  return null;
}

export function saveEmailKey(id: string, patch: { label?: string; from?: string; dailyLimit?: number; active?: boolean }) {
  update((db) => {
    for (const o of db.orgs) {
      const k = o.emailKeys?.find((x) => x.id === id);
      if (k) Object.assign(k, patch);
    }
  });
  if (REMOTE) void W.saveEmailKey(id, { label: patch.label, from_address: patch.from, daily_limit: patch.dailyLimit, active: patch.active });
}

export function removeEmailKey(id: string) {
  update((db) => {
    for (const o of db.orgs) o.emailKeys = o.emailKeys?.filter((k) => k.id !== id);
  });
  if (REMOTE) void W.deleteEmailKey(id);
}

// ------------------------------------------------------- how people take part

export const MODE_LABEL: Record<DivisionMode, string> = { in_person: 'In person', online: 'Online' };

export const offers = (c: Contest, mode: DivisionMode) => c.divisions.some((d) => d.mode === mode);
export const divisionFor = (c: Contest, mode: DivisionMode) => c.divisions.find((d) => d.mode === mode);
export const modeOf = (c: Contest, team: Pick<Team, 'divisionId'>): DivisionMode => c.divisions.find((d) => d.id === team.divisionId)?.mode ?? 'in_person';

const DEFAULT_DIVISION: Record<DivisionMode, Omit<Division, 'id'>> = {
  in_person: { name: 'In person', mode: 'in_person', detail: 'At the venue, on paper, with proctors in the room' },
  online: { name: 'Online', mode: 'online', detail: 'From anywhere, in the browser, proctored on Zoom' },
};
const divisionId = (mode: DivisionMode) => (REMOTE ? crypto.randomUUID() : mode);

/**
 * Offer or stop offering a way to take part. Turning one off is refused while
 * teams are registered in it: they have to be moved or withdrawn first, so
 * nobody silently loses their place.
 */
export function setMode(mode: DivisionMode, on: boolean): string | null {
  const c = contestOf(getDB());
  if (on === offers(c, mode)) return null;
  if (!on) {
    const d = divisionFor(c, mode)!;
    const n = getDB().teams.filter((t) => t.contestId === c.id && t.divisionId === d.id && t.status !== 'withdrawn').length;
    if (n) return `${n} ${n === 1 ? 'team is' : 'teams are'} registered ${mode === 'online' ? 'online' : 'in person'}. Move or withdraw ${n === 1 ? 'it' : 'them'} first.`;
    if (c.divisions.length === 1) return 'A contest needs at least one way to take part.';
  }
  let added: Division | null = null;
  let removed: string | null = null;
  let room: { id: string; name: string } | null = null;
  update((db) => {
    const k = contestOf(db, c.id);
    if (on) {
      added = { id: divisionId(mode), ...DEFAULT_DIVISION[mode] };
      k.divisions.push(added);
      k.divisions.sort((a, b) => (a.mode === 'in_person' ? -1 : 1) - (b.mode === 'in_person' ? -1 : 1));
      if (mode === 'in_person' && !k.venue) {
        room = { id: uid('v'), name: 'Room 1' };
        k.venue = { name: '', address: '', hall: 'Main hall', rooms: [{ ...room, teamIds: [] }], bring: ['Pencils and an eraser'] };
      }
    } else {
      removed = divisionFor(k, mode)!.id;
      k.divisions = k.divisions.filter((d) => d.mode !== mode);
    }
  });
  if (REMOTE) {
    if (added) void W.addDivision(c.id, added);
    if (removed) void W.removeDivision(removed);
    if (room) {
      const r: { id: string; name: string } = room;
      void W.saveVenue(c.id, contestOf(getDB()).venue).then(() => W.addVenueRoom(c.id, r.id, r.name));
    }
  }
  return null;
}

export function saveDivision(id: string, patch: Partial<Division>) {
  update((db) => {
    const d = contestOf(db).divisions.find((x) => x.id === id);
    if (d) Object.assign(d, patch);
  });
  if (REMOTE) void W.saveDivision(id, { name: patch.name, detail: patch.detail });
}

let venueTimer: ReturnType<typeof setTimeout> | null = null;
export function saveVenue(patch: Partial<NonNullable<Contest['venue']>>) {
  const renamed = patch.rooms?.filter((r) => contestOf(getDB()).venue?.rooms.find((x) => x.id === r.id)?.name !== r.name) ?? [];
  update((db) => {
    const c = contestOf(db);
    if (c.venue) Object.assign(c.venue, patch);
  });
  if (!REMOTE) return;
  for (const r of renamed) void W.renameVenueRoom(r.id, r.name);
  // Typing in the venue fields sends one request when the typing stops, not one per key.
  if (venueTimer) clearTimeout(venueTimer);
  venueTimer = setTimeout(() => void W.saveVenue(contestOf(getDB()).id, contestOf(getDB()).venue), 700);
}

export function addVenueRoom() {
  const id = uid('v');
  let name = '';
  update((db) => {
    const v = contestOf(db).venue;
    if (!v) return;
    name = `Room ${v.rooms.length + 1}`;
    v.rooms.push({ id, name, teamIds: [] });
  });
  if (REMOTE && name) void W.addVenueRoom(contestOf(getDB()).id, id, name);
}

export function addZoomRoom() {
  const id = uid('room');
  let name = '';
  let url = '';
  update((db) => {
    const c = contestOf(db);
    name = `Room ${c.rooms.length + 1}`;
    url = `https://zoom.us/j/8555${Math.floor(1e6 + Math.random() * 9e6)}`;
    c.rooms.push({ id, name, url, teamIds: [] });
  });
  if (REMOTE) void W.addZoomRoom(contestOf(getDB()).id, id, name, url);
}

export function removeRoom(kind: 'venue' | 'zoom', id: string) {
  update((db) => {
    const c = contestOf(db);
    if (kind === 'zoom') {
      const gone = c.rooms.find((r) => r.id === id);
      c.rooms = c.rooms.filter((r) => r.id !== id);
      for (const t of gone?.teamIds ?? []) placeTeam(c, db.teams.find((x) => x.id === t)!);
    } else if (c.venue) {
      const gone = c.venue.rooms.find((r) => r.id === id);
      c.venue.rooms = c.venue.rooms.filter((r) => r.id !== id);
      for (const t of gone?.teamIds ?? []) placeTeam(c, db.teams.find((x) => x.id === t)!);
    }
  });
  if (REMOTE) {
    void W.removeRoom(kind, id);
    saveRoomLists();
  }
}

/** Connected: write every room's team list as it is here (after placing teams locally). */
function saveRoomLists() {
  const c = contestOf(getDB());
  for (const r of c.rooms) void W.saveRoomTeams('zoom', r.id, r.teamIds);
  for (const r of c.venue?.rooms ?? []) void W.saveRoomTeams('venue', r.id, r.teamIds);
}

export function setRoomProctor(roomId: string, proctorId: string | undefined) {
  update((db) => {
    const r = contestOf(db).rooms.find((x) => x.id === roomId);
    if (r) r.proctorId = proctorId;
  });
  if (REMOTE) void W.setRoomProctor(roomId, proctorId ?? null);
}

/** Put a team in a room by hand. */
export function assignRoom(kind: 'venue' | 'zoom', roomId: string, teamId: string) {
  update((db) => {
    const c = contestOf(db);
    for (const r of c.rooms) r.teamIds = r.teamIds.filter((x) => x !== teamId);
    for (const r of c.venue?.rooms ?? []) r.teamIds = r.teamIds.filter((x) => x !== teamId);
    const room = kind === 'zoom' ? c.rooms.find((r) => r.id === roomId) : c.venue?.rooms.find((r) => r.id === roomId);
    room?.teamIds.push(teamId);
  });
  if (REMOTE) saveRoomLists();
}

export function setRegistration(patch: Partial<Contest['registration']>) {
  update((db) => {
    Object.assign(contestOf(db).registration, patch);
  });
  if (REMOTE) void W.saveRegistration(contestOf(getDB()).id, contestOf(getDB()).registration);
}

/** Put a team in the emptiest room for how it takes part, and out of every other. */
function placeTeam(c: Contest, team: Team) {
  for (const r of c.rooms) r.teamIds = r.teamIds.filter((x) => x !== team.id);
  for (const r of c.venue?.rooms ?? []) r.teamIds = r.teamIds.filter((x) => x !== team.id);
  if (team.status === 'withdrawn') return;
  const pool = modeOf(c, team) === 'online' ? c.rooms : c.venue?.rooms ?? [];
  const room = [...pool].sort((a, b) => a.teamIds.length - b.teamIds.length)[0];
  room?.teamIds.push(team.id);
}

/** A coach moves a team between in person and online while registration is open. Resolves to an error, or null. */
export async function setTeamMode(teamId: string, mode: DivisionMode, by: string): Promise<string | null> {
  const c = contestOf(getDB(), getDB().teams.find((t) => t.id === teamId)?.contestId);
  const d = divisionFor(c, mode);
  if (!d) return `${c.short} is not offering ${MODE_LABEL[mode].toLowerCase()} places.`;
  const me = getDB().users.find((u) => u.name === by);
  const organiser = me?.role === 'director' || me?.role === 'staff';
  if (!c.registration.open && !organiser) return `Registration closed on ${c.registration.closesLabel}. Ask the organisers to move the team.`;
  if (REMOTE) {
    const r = await W.setTeamMode(teamId, mode);
    if (r.error) return r.error;
  }
  update((db) => {
    const k = contestOf(db, c.id);
    const t = db.teams.find((x) => x.id === teamId);
    if (!t) return;
    t.divisionId = d.id;
    placeTeam(k, t);
    logActivity(db, teamId, `Moved to ${MODE_LABEL[mode].toLowerCase()} by ${by}`, 'b');
  });
  return null;
}

// -------------------------------------------------------------- registering

export type NewStudent = { name: string; grade: number | null; guardianName: string; guardianEmail: string };
export type NewTeam = {
  mode: DivisionMode;
  name: string;
  school: string;
  city: string;
  timeZone?: string;
  notes?: string;
  contactName: string;
  contactEmail: string;
  students: NewStudent[];
};

function addTeam(db: DB, c: Contest, input: NewTeam, status: TeamStatus, how: string, coachId?: string): Team {
  const codes = db.teams.filter((t) => t.contestId === c.id).map((t) => Number(t.code) || 0);
  const code = String(Math.max(0, ...codes) + 1).padStart(2, '0');
  const prefix = c.slug.split('-')[0];
  const team: Team = {
    id: `${c.id}:t${code}`, contestId: c.id, code, name: input.name.trim(), divisionId: divisionFor(c, input.mode)!.id,
    school: input.school.trim(), city: input.city.trim(), contactName: input.contactName.trim(), contactEmail: input.contactEmail.trim(),
    coachId, status, registeredAt: nowIso(), joinCode: `${prefix.slice(0, 2).toUpperCase()}${code}${Math.random().toString(36).slice(2, 4).toUpperCase()}`,
    timeZone: input.mode === 'online' ? input.timeZone : undefined, notes: input.notes?.trim() || undefined, pledge: null,
  };
  if (c.id === 'sfmo-2027') team.id = `t${code}`;
  db.teams.push(team);
  input.students.forEach((s, i) => {
    const slot = 'ABCDEFGH'[i];
    const id = `c-${team.id}-${slot}`;
    db.competitors.push({
      id, teamId: team.id, slot, publicId: `${code}${slot}`, name: s.name.trim(), grade: s.grade ?? 0,
      guardianName: s.guardianName.trim() || 'Parent or guardian', guardianEmail: s.guardianEmail.trim(), waiverSignedAt: null,
    });
    db.users.push({ id: `u-${id}`, email: `${prefix}-${code}${slot}`.toLowerCase(), name: s.name.trim(), role: 'student', password: 'demo', competitorId: id, managed: true });
  });
  placeTeam(c, team);
  if (coachId) {
    const coach = db.users.find((u) => u.id === coachId);
    if (coach) coach.teamIds = [...(coach.teamIds ?? []), team.id];
  }
  db.activity.push({ id: uid('a'), teamId: team.id, at: nowIso(), text: `${how}, ${MODE_LABEL[input.mode].toLowerCase()}`, tone: 'b' });
  return team;
}

/** A coach's registration from the contest's own form. */
export async function registerTeam(contestId: string, input: NewTeam, coachId?: string): Promise<{ team: Team | null; error: string | null }> {
  if (REMOTE) {
    const r = await W.registerTeam(contestId, input);
    if (r.error) return { team: null, error: r.error };
    const { reload } = await import('./remote/live');
    await reload(contestId);
    return { team: getDB().teams.find((t) => t.id === r.data) ?? null, error: null };
  }
  let made: Team | null = null;
  update((db) => {
    const c = contestOf(db, contestId);
    if (!divisionFor(c, input.mode)) return;
    made = addTeam(db, c, input, 'pending', `Registered by ${input.contactName.trim()}`, coachId);
  });
  return { team: made, error: made ? null : 'That way of taking part is not offered.' };
}

/** Teams that signed up somewhere else: a spreadsheet, a Google Form, another site. Resolves to how many came in, or an error. */
export async function importTeams(teams: NewTeam[], status: TeamStatus, by: string): Promise<{ count: number; error: string | null }> {
  const c = contestOf(getDB());
  const usable = teams.filter((t) => divisionFor(c, t.mode));
  if (REMOTE) {
    // In batches, so one large file is several modest requests rather than one huge one.
    let count = 0;
    for (let i = 0; i < usable.length; i += 50) {
      const r = await W.importTeams(c.id, usable.slice(i, i + 50), status);
      if (r.error) return { count, error: r.error };
      count += r.data ?? 0;
    }
    const { reload } = await import('./remote/live');
    await reload(c.id);
    return { count, error: null };
  }
  let n = 0;
  update((db) => {
    const k = contestOf(db);
    for (const t of usable) {
      addTeam(db, k, t, status, `Imported from a spreadsheet by ${by}`);
      n++;
    }
  });
  return { count: n, error: null };
}

/** Students for teams that already exist (one row per student). Resolves to how many came in, or an error. */
export async function importStudents(rows: { teamId: string; name: string; grade: number | null; guardianName: string; guardianEmail: string }[], by: string): Promise<{ count: number; error: string | null }> {
  let count = 0;
  for (const r of rows) {
    const error = await addCompetitor(r.teamId, { name: r.name, grade: r.grade ?? 0, guardianName: r.guardianName, guardianEmail: r.guardianEmail }, by);
    if (error) return { count, error: `${r.name}: ${error}` };
    count++;
  }
  if (REMOTE) {
    const { reload } = await import('./remote/live');
    await reload();
  }
  return { count, error: null };
}

export function markDeviceCheck(competitorId: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (c) c.deviceCheckedAt = nowIso();
  });
  if (REMOTE) void W.markDeviceCheck(competitorId);
}

// ---------------------------------------------------------------- new contest

export type RoundPlan = 'individual' | 'team' | 'guts';
export type NewContest = {
  name: string;
  short: string;
  date: string;
  timeZone: string;
  modes: DivisionMode[];
  venueName: string;
  venueAddress: string;
  onlineDetail: string;
  rounds: RoundPlan[];
};

const ROUND_PLANS: Record<RoundPlan, { name: string; kind: Round['kind']; minutes: number; count: number; points: (i: number) => number; set?: (i: number) => number; rules: string }> = {
  individual: { name: 'Individual', kind: 'individual', minutes: 60, count: 20, points: () => 1, rules: 'Short-answer problems, climbing in difficulty. Work alone.' },
  team: { name: 'Team', kind: 'team', minutes: 45, count: 10, points: () => 5, rules: 'One answer sheet for the whole team.' },
  guts: { name: 'Guts', kind: 'guts', minutes: 60, count: 24, points: (i) => 4 + Math.floor(i / 4), set: (i) => Math.floor(i / 4) + 1, rules: 'Six sets of four. Hand in a set to get the next; later sets are worth more.' },
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2027-03-14" → "Sunday 14 March 2027" */
export function longDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** Local wall-clock time on the contest day, as an ISO instant in the contest's zone. */
export function wallClock(ymd: string, hhmm: string, timeZone: string) {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime())).toISOString();
}

/** Resolves to the new contest's id, or throws with why not. */
export async function createContest(input: NewContest): Promise<string> {
  const db0 = getDB();
  const orgId = db0.orgs[0]?.id;
  if (!orgId) throw new Error('Set up your organisation first.');
  const slugBase = input.short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contest';
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 5)}`;
  const id = REMOTE ? crypto.randomUUID() : slug;
  const times = ['09:30', '11:00', '13:00'];
  const rounds: Round[] = input.rounds.map((plan, k) => {
    const p = ROUND_PLANS[plan];
    const problems: Problem[] = Array.from({ length: p.count }, (_, i) => ({
      id: REMOTE ? crypto.randomUUID() : `${slug}-${plan}-${i + 1}`, number: i + 1, set: p.set?.(i), text: `Problem ${i + 1}`, answers: [''], answerType: 'integer', points: p.points(i),
    }));
    return {
      id: REMOTE ? crypto.randomUUID() : `${slug}-${plan}`, name: p.name, short: p.name, kind: p.kind, minutes: p.minutes, startsAt: wallClock(input.date, times[k] ?? '14:00', input.timeZone),
      status: 'scheduled', graceSeconds: 30, integrity: { policy: plan === 'guts' ? 'log' : 'warn', lockAfter: 4 }, problems, rules: p.rules,
    };
  });
  const agenda: AgendaItem[] = [
    ...(input.modes.includes('in_person') ? [{ id: uid('ag'), at: wallClock(input.date, '09:00', input.timeZone), title: 'Check-in', modes: ['in_person' as const], where: 'Front desk' }] : []),
    ...(input.modes.includes('online') ? [{ id: uid('ag'), at: wallClock(input.date, '09:00', input.timeZone), title: 'Join your Zoom room', modes: ['online' as const] }] : []),
    ...rounds.map((r) => ({ id: uid('ag'), at: r.startsAt, title: r.name, roundId: r.id, modes: input.modes, where: r.kind === 'guts' ? 'hall' : 'room' })),
    { id: uid('ag'), at: wallClock(input.date, '15:00', input.timeZone), title: 'Awards', modes: input.modes, where: 'hall' },
  ];
  const weights = Object.fromEntries(rounds.map((r) => [r.id, 1]));
  const contest: Contest = {
    id, orgId, name: input.name.trim(), short: input.short.trim(), slug, dateLabel: longDate(input.date), timeZone: input.timeZone,
    divisions: input.modes.map((m) => ({ id: divisionId(m), ...DEFAULT_DIVISION[m], detail: m === 'online' && input.onlineDetail.trim() ? input.onlineDetail.trim() : DEFAULT_DIVISION[m].detail })),
    rounds,
    recipe: {
      teamIndividual: { method: 'best', best: 3, fillMissingTo: 0 }, weights, harderFirst: true,
      awards: [
        { id: uid('aw'), scope: 'individual', label: '1st', rule: 'top_n', value: 1 },
        { id: uid('aw'), scope: 'individual', label: '2nd', rule: 'top_n', value: 2 },
        { id: uid('aw'), scope: 'individual', label: '3rd', rule: 'top_n', value: 3 },
        { id: uid('aw'), scope: 'team', label: '1st', rule: 'top_n', value: 1 },
      ],
    },
    rooms: [],
    venue: input.modes.includes('in_person')
      ? { name: input.venueName.trim(), address: input.venueAddress.trim(), hall: 'Main hall', rooms: [{ id: uid('v'), name: 'Room 1', teamIds: [] }], bring: ['Pencils and an eraser'] }
      : null,
    agenda,
    resultsPublished: false,
    board: { freezeMinutes: 10, revealed: false },
    registration: { open: true, closesLabel: 'a week before', teamMin: 1, teamMax: 4 },
  };
  if (REMOTE) {
    const error = await W.createContest(contest);
    if (error) throw new Error(error);
  }
  update((db) => {
    db.contests.push(contest);
  });
  setActiveContest(id, { load: REMOTE });
  return id;
}

/** A first-time organiser's own organisation. Resolves to an error, or null. */
export async function createOrganization(name: string): Promise<string | null> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'org';
  if (!REMOTE) return 'The sandbox already has an organisation.';
  const r = await W.createOrganization(name.trim(), `${slug}-${Math.random().toString(36).slice(2, 5)}`);
  if (r.error) return r.error;
  const { reload } = await import('./remote/live');
  await reload(null);
  return null;
}

export type { User };
