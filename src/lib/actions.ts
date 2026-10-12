/**
 * Every change the app makes goes through here. Each function enforces the
 * same rules the Postgres functions in supabase/migrations enforce, so the
 * demo behaves like the real thing: a save after the deadline is refused, a
 * locked test stays locked until a proctor unlocks it.
 */
import type { Attempt, Contest, DB, EmailTemplate, IntegrityEvent, Round, TeamStatus, User } from './model';
import { getDB, update } from './store';
import { roundEnds, roundState } from './time';

const nowIso = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export function contestOf(db: DB, id = 'sfmo-2027'): Contest {
  return db.contests.find((c) => c.id === id) ?? db.contests[0];
}

function roundIn(db: DB, roundId: string): Round {
  const r = contestOf(db).rounds.find((x) => x.id === roundId);
  if (!r) throw new Error(`No round ${roundId}`);
  return r;
}

export function signIn(login: string, password: string): User | null {
  const l = login.trim().toLowerCase();
  return getDB().users.find((u) => u.email.toLowerCase() === l && u.password === password) ?? null;
}

// ------------------------------------------------------------------ rounds

export function openRound(roundId: string) {
  update((db) => {
    const r = roundIn(db, roundId);
    r.status = 'open';
    r.openedAt = nowIso();
    // Reopening in the demo starts the round afresh.
    db.attempts = db.attempts.filter((a) => !(a.roundId === roundId && a.source === 'online'));
  });
}

export function closeRound(roundId: string) {
  update((db) => {
    const r = roundIn(db, roundId);
    r.status = 'closed';
    for (const a of db.attempts) if (a.roundId === roundId && a.startedAt && !a.submittedAt) a.submittedAt = nowIso();
  });
}

export function saveRound(roundId: string, patch: Partial<Round>) {
  update((db) => {
    Object.assign(roundIn(db, roundId), patch);
  });
}

// ---------------------------------------------------------------- attempts

export type SaveResult = { ok: true } | { ok: false; reason: string };

/** Start (or rejoin) an online attempt. Team rounds share one attempt per team. */
export function startAttempt(roundId: string, entrantId: string, honorName: string): Attempt | null {
  let out: Attempt | null = null;
  update((db) => {
    const round = roundIn(db, roundId);
    if (roundState(round) !== 'open') return;
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === entrantId);
    if (!a) {
      a = {
        id: `${roundId}:${entrantId}`, roundId, entrantId, source: 'online', startedAt: nowIso(),
        deadline: new Date(roundEnds(round)!).toISOString(), responses: {}, events: [], honorName,
        ...(round.kind === 'guts' ? { setsSubmitted: 0 } : {}),
      };
      db.attempts.push(a);
    } else if (!a.startedAt) {
      a.startedAt = nowIso();
    }
    out = a;
  });
  return out;
}

function deadlinePassed(db: DB, a: Attempt) {
  const round = roundIn(db, a.roundId);
  return !!a.deadline && Date.now() > new Date(a.deadline).getTime() + round.graceSeconds * 1000;
}

export function saveResponse(attemptId: string, problemId: string, value: string, userId: string): SaveResult {
  let result: SaveResult = { ok: true };
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
  });
  return result;
}

export function submitGutsSet(attemptId: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a || a.submittedAt || deadlinePassed(db, a)) return;
    const round = roundIn(db, a.roundId);
    const sets = Math.max(...round.problems.map((p) => p.set ?? 1));
    a.setsSubmitted = Math.min(sets, (a.setsSubmitted ?? 0) + 1);
    if (a.setsSubmitted >= sets) a.submittedAt = nowIso();
  });
}

export function submitAttempt(attemptId: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (a && !a.submittedAt) a.submittedAt = nowIso();
  });
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
  return outcome;
}

export function unlockAttempt(attemptId: string, by: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a) return;
    a.locked = false;
    a.events.push({ at: nowIso(), kind: 'unlocked', by });
  });
}

export function lockAttempt(attemptId: string, by: string) {
  update((db) => {
    const a = db.attempts.find((x) => x.id === attemptId);
    if (!a) return;
    a.locked = true;
    a.events.push({ at: nowIso(), kind: 'locked', by });
  });
}

// ---------------------------------------------------------- clarifications

export function askClarification(roundId: string, competitorId: string, question: string) {
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
}

export function broadcast(roundId: string, text: string) {
  update((db) => {
    db.clarifications.push({ id: uid('cl'), roundId, question: '', answer: text.trim(), broadcast: true, at: nowIso(), answeredAt: nowIso() });
  });
}

// ----------------------------------------------------------------- grading

export function setRuling(roundId: string, problemId: string, normalized: string, correct: boolean | null, by: string) {
  update((db) => {
    db.rulings = db.rulings.filter((r) => !(r.problemId === problemId && r.normalized === normalized));
    if (correct !== null) db.rulings.push({ roundId, problemId, normalized, correct, by, at: nowIso() });
  });
}

/** Save a keyed paper sheet. Blanks are kept: a blank is the competitor's answer. */
export function savePaperSheet(roundId: string, entrantId: string, values: Record<string, string>, by: string) {
  update((db) => {
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === entrantId);
    if (!a) {
      a = { id: `${roundId}:${entrantId}`, roundId, entrantId, source: 'paper', responses: {}, events: [] };
      db.attempts.push(a);
    }
    const at = nowIso();
    a.responses = {};
    for (const [pid, v] of Object.entries(values)) if (v.trim()) a.responses[pid] = { value: v.trim(), savedAt: at, by };
    a.submittedAt = at;
  });
}

// ---------------------------------------------------------------- results

export function updateRecipe(fn: (c: Contest) => void) {
  update((db) => fn(contestOf(db)));
}

export function setPublished(published: boolean) {
  update((db) => {
    contestOf(db).resultsPublished = published;
  });
}

// ------------------------------------------------------------------ roster

export function setTeamStatus(teamIds: string[], status: TeamStatus, by: string) {
  update((db) => {
    for (const t of db.teams) {
      if (!teamIds.includes(t.id) || t.status === status) continue;
      t.status = status;
      db.activity.push({ id: uid('a'), teamId: t.id, at: nowIso(), text: status === 'confirmed' ? `Confirmed by ${by}` : `Marked ${status} by ${by}`, tone: status === 'confirmed' ? 'g' : '' });
    }
  });
}

export function remindWaiver(competitorId: string, by: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c) return;
    c.reminderSentAt = nowIso();
    db.activity.push({ id: uid('a'), teamId: c.teamId, at: nowIso(), text: `Waiver reminder sent to ${c.guardianName} by ${by}`, tone: 'a' });
  });
}

export function signWaiver(competitorId: string, signedName: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c || c.waiverSignedAt) return;
    c.waiverSignedAt = nowIso();
    db.activity.push({ id: uid('a'), teamId: c.teamId, at: nowIso(), text: `Waiver for ${c.publicId} signed by ${signedName}`, tone: 'g' });
  });
}

export function addCompetitor(teamId: string, input: { name: string; grade: number; guardianName: string; guardianEmail: string }, by: string) {
  update((db) => {
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) return;
    const taken = new Set(db.competitors.filter((c) => c.teamId === teamId).map((c) => c.slot));
    const slot = 'ABCD'.split('').find((s) => !taken.has(s));
    if (!slot) return;
    const id = `c${team.code}${slot}`;
    db.competitors.push({ id, teamId, slot, publicId: `${team.code}${slot}`, name: input.name.trim(), grade: input.grade, guardianName: input.guardianName.trim(), guardianEmail: input.guardianEmail.trim(), waiverSignedAt: null });
    db.users.push({ id: `u-${id}`, email: `sfmo-${team.code}${slot}`.toLowerCase(), name: input.name.trim(), role: 'student', password: 'demo', competitorId: id, managed: true });
    db.activity.push({ id: uid('a'), teamId, at: nowIso(), text: `${input.name.trim()} added as ${team.code}${slot} by ${by}; waiver request sent to ${input.guardianName.trim()}`, tone: 'b' });
  });
}

export function removeCompetitor(competitorId: string, by: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (!c) return;
    db.competitors = db.competitors.filter((x) => x.id !== competitorId);
    db.users = db.users.filter((u) => u.competitorId !== competitorId);
    db.activity.push({ id: uid('a'), teamId: c.teamId, at: nowIso(), text: `${c.name} (${c.publicId}) removed by ${by}`, tone: '' });
  });
}

export function checkIn(competitorId: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (c) c.checkedInAt = c.checkedInAt ? null : nowIso();
  });
}

// ------------------------------------------------------------------- email

export function saveTemplate(t: EmailTemplate) {
  update((db) => {
    const i = db.templates.findIndex((x) => x.id === t.id);
    if (i >= 0) db.templates[i] = t;
    else db.templates.push(t);
  });
}

/**
 * Queue a send. The provider's daily limit decides how many go today; the
 * rest wait for tomorrow. Returns [today, later].
 */
export function queueSends(templateId: string, recipients: string[]): [number, number] {
  let counts: [number, number] = [0, 0];
  update((db) => {
    const org = db.orgs[0];
    const today = new Date().toDateString();
    const sentToday = db.sends.filter((s) => new Date(s.at).toDateString() === today).length;
    const room = Math.max(0, org.emailProvider.dailyLimit - sentToday);
    const fresh = recipients.filter((to) => !db.sends.some((s) => s.templateId === templateId && s.to === to));
    fresh.forEach((to, i) => db.sends.push({ id: uid('s'), templateId, to, at: nowIso(), status: i < room ? 'sent' : 'queued' }));
    counts = [Math.min(room, fresh.length), Math.max(0, fresh.length - room)];
  });
  return counts;
}
