/**
 * Every change the app makes goes through here. Each function enforces the
 * same rules the Postgres functions in supabase/migrations enforce, so the
 * demo behaves like the real thing: a save after the deadline is refused, a
 * locked test stays locked until a proctor unlocks it.
 */
import type { AgendaItem, Attempt, Contest, DB, Division, DivisionMode, EmailTemplate, IntegrityEvent, Problem, Round, Team, TeamStatus, User } from './model';
import { activeContestId, getDB, setActiveContest, update } from './store';
import { roundEnds, roundState } from './time';

const nowIso = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** The contest this tab is working on, or a named one. */
export function contestOf(db: DB, id = activeContestId()): Contest {
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
    if (r.kind === 'guts') contestOf(db).board.revealed = false;
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
        ...(round.kind === 'guts' ? { setsSubmitted: 0, setTimes: [] } : {}),
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
    a.setTimes = [...(a.setTimes ?? []), nowIso()].slice(0, sets);
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

/**
 * Key one Guts set from a paper sheet. Sets come in one at a time during the
 * round, and each keyed set goes on the live board at once.
 */
export function savePaperGutsSet(roundId: string, teamId: string, setNo: number, values: Record<string, string>, by: string) {
  update((db) => {
    const round = roundIn(db, roundId);
    let a = db.attempts.find((x) => x.roundId === roundId && x.entrantId === teamId);
    if (!a) {
      a = { id: `${roundId}:${teamId}`, roundId, entrantId: teamId, source: 'paper', responses: {}, events: [], setsSubmitted: 0, setTimes: [] };
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
}

export function setBoard(patch: Partial<Contest['board']>) {
  update((db) => {
    Object.assign(contestOf(db).board, patch);
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

// ---------------------------------------------------- how people take part

export const MODE_LABEL: Record<DivisionMode, string> = { in_person: 'In person', online: 'Online' };

export const offers = (c: Contest, mode: DivisionMode) => c.divisions.some((d) => d.mode === mode);
export const divisionFor = (c: Contest, mode: DivisionMode) => c.divisions.find((d) => d.mode === mode);
export const modeOf = (c: Contest, team: Pick<Team, 'divisionId'>): DivisionMode => c.divisions.find((d) => d.id === team.divisionId)?.mode ?? 'in_person';

const DEFAULT_DIVISION: Record<DivisionMode, Division> = {
  in_person: { id: 'in_person', name: 'In person', mode: 'in_person', detail: 'At the venue, on paper, with proctors in the room' },
  online: { id: 'online', name: 'Online', mode: 'online', detail: 'From anywhere, in the browser, proctored on Zoom' },
};

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
  update((db) => {
    const k = contestOf(db, c.id);
    if (on) {
      k.divisions.push({ ...DEFAULT_DIVISION[mode] });
      k.divisions.sort((a, b) => (a.mode === 'in_person' ? -1 : 1) - (b.mode === 'in_person' ? -1 : 1));
      if (mode === 'in_person' && !k.venue) k.venue = { name: '', address: '', hall: 'Main hall', rooms: [{ id: uid('v'), name: 'Room 1', teamIds: [] }], bring: ['Pencils and an eraser'] };
    } else {
      k.divisions = k.divisions.filter((d) => d.mode !== mode);
    }
  });
  return null;
}

export function saveDivision(id: string, patch: Partial<Division>) {
  update((db) => {
    const d = contestOf(db).divisions.find((x) => x.id === id);
    if (d) Object.assign(d, patch);
  });
}

export function saveVenue(patch: Partial<NonNullable<Contest['venue']>>) {
  update((db) => {
    const c = contestOf(db);
    if (c.venue) Object.assign(c.venue, patch);
  });
}

export function addVenueRoom() {
  update((db) => {
    const v = contestOf(db).venue;
    if (v) v.rooms.push({ id: uid('v'), name: `Room ${v.rooms.length + 1}`, teamIds: [] });
  });
}

export function addZoomRoom() {
  update((db) => {
    const c = contestOf(db);
    c.rooms.push({ id: uid('room'), name: `Room ${c.rooms.length + 1}`, url: `https://zoom.us/j/8555${Math.floor(1e6 + Math.random() * 9e6)}`, teamIds: [] });
  });
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
}

export function setRoomProctor(roomId: string, proctorId: string | undefined) {
  update((db) => {
    const r = contestOf(db).rooms.find((x) => x.id === roomId);
    if (r) r.proctorId = proctorId;
  });
}

export function setRegistration(patch: Partial<Contest['registration']>) {
  update((db) => {
    Object.assign(contestOf(db).registration, patch);
  });
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

/** A coach moves a team between in person and online while registration is open. */
export function setTeamMode(teamId: string, mode: DivisionMode, by: string): string | null {
  const c = contestOf(getDB(), getDB().teams.find((t) => t.id === teamId)?.contestId);
  const d = divisionFor(c, mode);
  if (!d) return `${c.short} is not offering ${MODE_LABEL[mode].toLowerCase()} places.`;
  if (!c.registration.open) return `Registration closed on ${c.registration.closesLabel}. Ask the organisers to move the team.`;
  update((db) => {
    const k = contestOf(db, c.id);
    const t = db.teams.find((x) => x.id === teamId);
    if (!t) return;
    t.divisionId = d.id;
    placeTeam(k, t);
    db.activity.push({ id: uid('a'), teamId, at: nowIso(), text: `Moved to ${MODE_LABEL[mode].toLowerCase()} by ${by}`, tone: 'b' });
  });
  return null;
}

// ------------------------------------------------------------ registering

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
export function registerTeam(contestId: string, input: NewTeam, coachId?: string): Team | null {
  let made: Team | null = null;
  update((db) => {
    const c = contestOf(db, contestId);
    if (!divisionFor(c, input.mode)) return;
    made = addTeam(db, c, input, 'pending', `Registered by ${input.contactName.trim()}`, coachId);
  });
  return made;
}

/** Teams that signed up somewhere else: a spreadsheet, a Google Form, another site. */
export function importTeams(teams: NewTeam[], status: TeamStatus, by: string): number {
  let n = 0;
  update((db) => {
    const c = contestOf(db);
    for (const t of teams) {
      if (!divisionFor(c, t.mode)) continue;
      addTeam(db, c, t, status, `Imported from a spreadsheet by ${by}`);
      n++;
    }
  });
  return n;
}

export function markDeviceCheck(competitorId: string) {
  update((db) => {
    const c = db.competitors.find((x) => x.id === competitorId);
    if (c) c.deviceCheckedAt = nowIso();
  });
}

// ------------------------------------------------------------- new contest

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
function wallClock(ymd: string, hhmm: string, timeZone: string) {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime())).toISOString();
}

export function createContest(input: NewContest): string {
  const slug = `${input.short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contest'}-${Math.random().toString(36).slice(2, 5)}`;
  const times = ['09:30', '11:00', '13:00'];
  const rounds: Round[] = input.rounds.map((plan, k) => {
    const p = ROUND_PLANS[plan];
    const problems: Problem[] = Array.from({ length: p.count }, (_, i) => ({
      id: `${slug}-${plan}-${i + 1}`, number: i + 1, set: p.set?.(i), text: `Problem ${i + 1}`, answers: [''], answerType: 'integer', points: p.points(i),
    }));
    return {
      id: `${slug}-${plan}`, name: p.name, short: p.name, kind: p.kind, minutes: p.minutes, startsAt: wallClock(input.date, times[k] ?? '14:00', input.timeZone),
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
    id: slug, orgId: 'sfmi', name: input.name.trim(), short: input.short.trim(), slug, dateLabel: longDate(input.date), timeZone: input.timeZone,
    divisions: input.modes.map((m) => ({ ...DEFAULT_DIVISION[m], detail: m === 'online' && input.onlineDetail.trim() ? input.onlineDetail.trim() : DEFAULT_DIVISION[m].detail })),
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
  update((db) => {
    db.contests.push(contest);
  });
  setActiveContest(slug);
  return slug;
}

