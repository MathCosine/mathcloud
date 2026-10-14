/**
 * The import hub's thinking, kept apart from the screens so it can be tested:
 * duplicates in team files, students for teams that already exist, problems
 * and answer keys, and paper answer sheets keyed in a spreadsheet.
 *
 * Nothing here touches the database. Each function turns rows into a plan
 * the organiser reads, and can change, before anything is saved.
 */
import type { AnswerType, Problem, Round, Team } from './model';
import type { NewStudent } from './actions';
import type { PlannedTeam } from './csv';

// ----------------------------------------------------------------- matching

/** "  Pi-Rates! " and "pi rates" are the same team; "Sofía" and "Sofia" the same student. */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const normEmail = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** "7", "07", " 07 " → "07". Codes with letters ("07A", "7a") → "07A". */
export function normCode(s: string): string {
  const v = s.trim().toUpperCase().replace(/\s+/g, '');
  const m = v.match(/^(\d+)([A-Z]?)$/);
  return m ? `${m[1].padStart(2, '0')}${m[2]}` : v;
}

const cellOf = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const gradeOf = (v: string) => {
  const g = parseInt(v.replace(/\D+/g, ''), 10);
  return Number.isFinite(g) ? g : null;
};

/** The column whose header matches first, among those not taken. */
function pick(headers: string[], used: Set<number>, test: RegExp, not?: RegExp): number | undefined {
  const i = headers.findIndex((h, k) => !used.has(k) && test.test(h) && !(not && not.test(h)));
  if (i < 0) return undefined;
  used.add(i);
  return i;
}

// ===================================================== teams: duplicates

export type ExistingTeam = Pick<Team, 'id' | 'code' | 'name' | 'school' | 'city' | 'contactName' | 'contactEmail' | 'divisionId' | 'status'>;
export type ExistingStudent = { id: string; teamId: string; name: string; guardianEmail: string };

/** What to do with a team in the file. */
export type TeamAction = 'new' | 'skip' | 'update' | 'add';

export type TeamRow = PlannedTeam & {
  /** Position in the plan, stable across re-plans. */
  key: string;
  /** Set when an existing team looks like the same one. */
  existing?: { id: string; code: string; name: string; why: string };
  /** Same contact email and school as an earlier row, but another name and other students. */
  fileDupOf?: { key: string; row: number; name: string };
  /** Other rows of the file merged into this one. */
  notes: string[];
  /** Update: fields that would change (never the name: the team keeps its own), and students not on the team yet. */
  changes: { field: 'school' | 'city' | 'contactName' | 'contactEmail'; from: string; to: string }[];
  newStudents: NewStudent[];
  /** Students dropped because the same name appeared twice for this team. */
  dupStudents: number;
};

export type TeamDedupe = {
  rows: TeamRow[];
  /** In-file duplicates folded into an earlier row. */
  merged: number;
  /** Duplicate students removed inside teams. */
  studentDups: number;
};

const sameContact = (a: { contactEmail: string; school: string }, b: { contactEmail: string; school: string }) =>
  !!normEmail(a.contactEmail) && normEmail(a.contactEmail) === normEmail(b.contactEmail) && norm(a.school) === norm(b.school);

function uniqueStudents(list: NewStudent[]): { kept: NewStudent[]; dropped: number } {
  const seen = new Set<string>();
  const kept: NewStudent[] = [];
  for (const s of list) {
    const k = norm(s.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    kept.push(s);
  }
  return { kept, dropped: list.length - kept.length };
}

/**
 * Find duplicates in a planned team import: inside the file (same name, or
 * same contact email and school), which are merged into the first row, and
 * against teams already registered, which get an action to choose.
 */
export function dedupeTeams(plan: PlannedTeam[], existing: ExistingTeam[], students: ExistingStudent[], teamMax: number): TeamDedupe {
  const rows: TeamRow[] = [];
  let merged = 0;
  let studentDups = 0;

  for (const t of plan) {
    // Same name, or same contact and school with a student in common: the same team sent twice.
    const overlap = (r: TeamRow) => r.students.some((a) => t.students.some((b) => norm(a.name) === norm(b.name)));
    const into = t.name ? rows.find((r) => (norm(r.name) === norm(t.name) && !!norm(t.name)) || (sameContact(r, t) && overlap(r))) : undefined;
    if (into) {
      const why = norm(into.name) === norm(t.name) ? 'same name' : 'same contact email and school';
      const before = into.students.length;
      const { kept, dropped } = uniqueStudents([...into.students, ...t.students]);
      into.students = kept;
      studentDups += dropped;
      into.rows = [...into.rows, ...t.rows];
      into.notes.push(`Row ${t.rows.join(', ')} merged in (${why})${kept.length > before ? `, ${kept.length - before} more ${kept.length - before === 1 ? 'student' : 'students'}` : ''}`);
      // Fill blanks the first row left.
      for (const f of ['school', 'city', 'contactName'] as const) if (!into[f] && t[f]) into[f] = t[f];
      if (into.errors.some((e) => /No students/.test(e)) && kept.length) into.errors = into.errors.filter((e) => !/No students/.test(e));
      into.errors = into.errors.filter((e) => !/students; teams have at most/.test(e));
      if (kept.length > teamMax) into.errors.push(`${kept.length} students; teams have at most ${teamMax}`);
      merged++;
      continue;
    }
    const { kept, dropped } = uniqueStudents(t.students);
    studentDups += dropped;
    const row: TeamRow = { ...t, students: kept, key: `r${t.rows[0]}`, notes: [], changes: [], newStudents: [], dupStudents: dropped, errors: [...t.errors], warnings: [...t.warnings] };
    if (dropped) row.notes.push(`${dropped} repeated ${dropped === 1 ? 'student' : 'students'} removed`);
    // Same coach and school, different team and students: maybe a second team, maybe a duplicate. The organiser decides.
    const twin = rows.find((r) => sameContact(r, t));
    if (twin) row.fileDupOf = { key: twin.key, row: twin.rows[0], name: twin.name };
    if (kept.length !== t.students.length) {
      row.errors = row.errors.filter((e) => !/students; teams have at most/.test(e));
      if (kept.length > teamMax) row.errors.push(`${kept.length} students; teams have at most ${teamMax}`);
    }
    rows.push(row);
  }

  // Against what is already registered.
  for (const r of rows) {
    const byName = existing.find((e) => norm(e.name) === norm(r.name) && !!norm(r.name));
    const byContact = byName ? undefined : existing.find((e) => sameContact(e, r));
    const e = byName ?? byContact;
    if (!e) continue;
    r.existing = { id: e.id, code: e.code, name: e.name, why: byName ? 'same name' : 'same contact email and school' };
    if (byContact && r.name.trim()) r.notes.push(`Registered as “${e.name}”; an update keeps that name`);
    for (const f of ['school', 'city', 'contactName', 'contactEmail'] as const) {
      const to = r[f].trim();
      if (to && to !== (e[f] ?? '').trim()) r.changes.push({ field: f, from: e[f] ?? '', to });
    }
    const on = new Set(students.filter((s) => s.teamId === e.id).map((s) => norm(s.name)));
    r.newStudents = r.students.filter((s) => !on.has(norm(s.name)));
    const room = Math.max(0, teamMax - on.size);
    if (r.newStudents.length > room) r.warnings.push(`${e.name} has room for ${room} more; ${r.newStudents.length - room} would not fit`);
  }
  return { rows, merged, studentDups };
}

/** Skip for existing teams, import for the rest. */
export const defaultTeamAction = (r: TeamRow): TeamAction => (r.existing ? 'skip' : 'new');
export const isDuplicate = (r: TeamRow) => !!r.existing || !!r.fileDupOf;

export type TeamSummary = { create: TeamRow[]; update: TeamRow[]; skipped: number; blocked: number };

export function summarizeTeams(rows: TeamRow[], actions: Record<string, TeamAction>): TeamSummary {
  const out: TeamSummary = { create: [], update: [], skipped: 0, blocked: 0 };
  for (const r of rows) {
    const a = actions[r.key] ?? defaultTeamAction(r);
    if (r.errors.length) out.blocked++;
    else if (a === 'skip') out.skipped++;
    else if (a === 'update') out.update.push(r);
    else out.create.push(r);
  }
  return out;
}

// ========================================== students into existing teams

export type StudentImportField = 'team' | 'student' | 'grade' | 'guardianName' | 'guardianEmail';
export const STUDENT_IMPORT_FIELDS: { key: StudentImportField; label: string; required?: boolean }[] = [
  { key: 'team', label: 'Team (code or name)', required: true },
  { key: 'student', label: 'Student name', required: true },
  { key: 'grade', label: 'Grade' },
  { key: 'guardianName', label: 'Guardian name' },
  { key: 'guardianEmail', label: 'Guardian email' },
];
export type StudentImportMap = Partial<Record<StudentImportField, number>>;

export function guessStudentImport(headers: string[]): StudentImportMap {
  const used = new Set<number>();
  const m: StudentImportMap = {};
  m.guardianEmail = pick(headers, used, /(parent|guardian).*e-?mail|e-?mail.*(parent|guardian)/i) ?? pick(headers, used, /e-?mail/i);
  m.guardianName = pick(headers, used, /parent|guardian/i);
  m.team = pick(headers, used, /team|code/i);
  m.grade = pick(headers, used, /grade|year/i);
  m.student = pick(headers, used, /student|competitor|member|participant|name/i);
  return m;
}

export type StudentAction = 'add' | 'skip';

export type StudentRow = NewStudent & {
  row: number;
  key: string;
  teamRaw: string;
  teamId: string | null;
  teamLabel: string;
  /** Why this looks like someone already there. */
  dup?: string;
  errors: string[];
  warnings: string[];
};

export type StudentContext = {
  teams: Pick<Team, 'id' | 'code' | 'name'>[];
  students: ExistingStudent[];
  teamMax: number;
};

export function planStudents(rows: string[][], map: StudentImportMap, ctx: StudentContext, actions: Record<string, StudentAction> = {}): StudentRow[] {
  const byCode = new Map(ctx.teams.map((t) => [normCode(t.code), t]));
  const byName = new Map(ctx.teams.map((t) => [norm(t.name), t]));
  const count = new Map<string, number>();
  for (const s of ctx.students) count.set(s.teamId, (count.get(s.teamId) ?? 0) + 1);
  const seen = new Set<string>();
  const out: StudentRow[] = [];

  rows.slice(1).forEach((r, k) => {
    const teamRaw = cellOf(r, map.team);
    const name = cellOf(r, map.student);
    const team = teamRaw ? byCode.get(normCode(teamRaw)) ?? byName.get(norm(teamRaw)) : undefined;
    const s: StudentRow = {
      row: k + 2, key: `s${k + 2}`, teamRaw, teamId: team?.id ?? null, teamLabel: team ? `${team.code} ${team.name}` : '',
      name, grade: gradeOf(cellOf(r, map.grade)), guardianName: cellOf(r, map.guardianName), guardianEmail: cellOf(r, map.guardianEmail),
      errors: [], warnings: [],
    };
    if (!name) s.errors.push('No student name');
    if (!teamRaw) s.errors.push('No team');
    else if (!team) s.errors.push(`No team with code or name “${teamRaw}”`);
    if (s.guardianEmail && !EMAIL.test(s.guardianEmail)) s.warnings.push(`“${s.guardianEmail}” is not an email address`);
    else if (!s.guardianEmail) s.warnings.push('No guardian email, so no waiver can be sent yet');

    if (team && name) {
      const fileKey = `${team.id}|${norm(name)}`;
      const onTeam = ctx.students.find((x) => x.teamId === team.id && norm(x.name) === norm(name));
      const elsewhere = !onTeam && s.guardianEmail
        ? ctx.students.find((x) => x.teamId !== team.id && norm(x.name) === norm(name) && normEmail(x.guardianEmail) === normEmail(s.guardianEmail))
        : undefined;
      if (seen.has(fileKey)) s.dup = 'Appears earlier in this file';
      else if (onTeam) s.dup = 'Already on this team';
      else if (elsewhere) {
        const t = ctx.teams.find((x) => x.id === elsewhere.teamId);
        s.dup = `Same name and guardian email on ${t ? `${t.code} ${t.name}` : 'another team'}`;
      }
      seen.add(fileKey);
      const action = actions[s.key] ?? (s.dup ? 'skip' : 'add');
      if (!s.errors.length && action === 'add') {
        const n = (count.get(team.id) ?? 0) + 1;
        if (n > ctx.teamMax) s.errors.push(`${team.name} is full (${ctx.teamMax} students)`);
        else count.set(team.id, n);
      }
    }
    out.push(s);
  });
  return out;
}

export const defaultStudentAction = (s: StudentRow): StudentAction => (s.dup ? 'skip' : 'add');

// ======================================================= problems and keys

export type ProblemField = 'number' | 'set' | 'text' | 'answers' | 'points' | 'type';
export const PROBLEM_FIELDS: { key: ProblemField; label: string; required?: boolean }[] = [
  { key: 'number', label: 'Number' },
  { key: 'set', label: 'Guts set' },
  { key: 'text', label: 'Problem text', required: true },
  { key: 'answers', label: 'Answer(s)', required: true },
  { key: 'points', label: 'Points' },
  { key: 'type', label: 'Answer type' },
];
export type ProblemMap = Partial<Record<ProblemField, number>>;

export function guessProblemMap(headers: string[]): ProblemMap {
  const used = new Set<number>();
  const m: ProblemMap = {};
  m.set = pick(headers, used, /^set|set\b|guts/i);
  m.type = pick(headers, used, /type|format|kind/i);
  m.answers = pick(headers, used, /answer|key|solution/i);
  m.points = pick(headers, used, /point|pts|score|weight/i);
  m.number = pick(headers, used, /^(#|no\.?|num(ber)?|problem ?#|q(uestion)? ?#?|n)$/i) ?? pick(headers, used, /number|#/i);
  m.text = pick(headers, used, /text|problem|question|statement|body|latex/i);
  return m;
}

export type DraftProblem = {
  /** Spreadsheet row, or block number for pasted text. */
  row: number;
  number: number | null;
  set: number | null;
  text: string;
  answers: string[];
  points: number | null;
  answerType: AnswerType | null;
  errors: string[];
  warnings: string[];
};

/** "int", "Integer", "number" → integer; "expr", "fraction", "exact", "latex" → expression. */
export function readAnswerType(v: string): AnswerType | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^(int|integer|number|numeric|whole)/.test(s)) return 'integer';
  if (/expr|fraction|exact|latex|text|frac|radical|other/.test(s)) return 'expression';
  return null;
}

export const splitAnswers = (v: string) => v.split('|').map((a) => a.trim()).filter(Boolean);

/** Integer if every accepted answer is a whole number; otherwise an expression. */
export const inferType = (answers: string[]): AnswerType => (answers.length && answers.every((a) => /^-?\d+$/.test(a)) ? 'integer' : 'expression');

function checkDraft(d: DraftProblem, guts: boolean) {
  if (!d.text) d.errors.push('No problem text');
  if (!d.answers.length) d.warnings.push('No answer yet');
  if ((d.text.match(/\$/g)?.length ?? 0) % 2) d.warnings.push('Odd number of $ signs: some maths will not render');
  if (guts && d.set === null) d.warnings.push('No set given');
}

export function parseProblemRows(rows: string[][], map: ProblemMap, guts: boolean): DraftProblem[] {
  return rows.slice(1).map((r, k) => {
    const n = parseInt(cellOf(r, map.number).replace(/[^\d]/g, ''), 10);
    const set = parseInt(cellOf(r, map.set).replace(/[^\d]/g, ''), 10);
    const pts = Number(cellOf(r, map.points));
    const rawType = cellOf(r, map.type);
    const d: DraftProblem = {
      row: k + 2,
      number: Number.isFinite(n) ? n : null,
      set: Number.isFinite(set) ? set : null,
      text: cellOf(r, map.text),
      answers: splitAnswers(cellOf(r, map.answers)),
      points: cellOf(r, map.points) && Number.isFinite(pts) ? pts : null,
      answerType: readAnswerType(rawType),
      errors: [],
      warnings: [],
    };
    if (rawType && !d.answerType) d.warnings.push(`Answer type “${rawType}” not recognised; guessed from the answer`);
    checkDraft(d, guts);
    return d;
  });
}

/**
 * Problems pasted as plain text: blocks separated by blank lines, each with
 * an "Answer:" line. A block may start with "3." or "Problem 3:", and may
 * have "Points: 5", "Set: 2" and "Type: expression" lines.
 */
export function parseProblemText(text: string, guts: boolean): DraftProblem[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, k) => {
    const d: DraftProblem = { row: k + 1, number: null, set: null, text: '', answers: [], points: null, answerType: null, errors: [], warnings: [] };
    const body: string[] = [];
    for (const line of b.split('\n')) {
      const m = line.match(/^\s*(answers?|ans|key|points?|pts|set|type)\s*[:=]\s*(.*)$/i);
      if (m) {
        const [, k2, v] = m;
        const key = k2.toLowerCase();
        if (/^(answers?|ans|key)$/.test(key)) d.answers.push(...splitAnswers(v));
        else if (/^(points?|pts)$/.test(key)) d.points = Number.isFinite(Number(v)) && v.trim() ? Number(v) : null;
        else if (key === 'set') d.set = parseInt(v, 10) || null;
        else d.answerType = readAnswerType(v);
      } else body.push(line);
    }
    let first = body.join('\n').trim();
    const head = first.match(/^(?:problem|question|q|#)?\s*(\d+)\s*[.):-]\s*/i);
    if (head) {
      d.number = Number(head[1]);
      first = first.slice(head[0].length);
    }
    d.text = first.trim();
    checkDraft(d, guts);
    return d;
  });
}

export type ProblemMode = 'replace' | 'append' | 'update';

export type ProblemResult = {
  problems: Problem[];
  added: number;
  updated: number;
  removed: number;
};

/**
 * The round's problem list after importing. `newId` makes a fresh id (from
 * newProblem). Problems keep their order by set, then number; numbers run
 * 1..n after a replace or append.
 */
export function applyProblems(round: Round, drafts: DraftProblem[], mode: ProblemMode, newId: () => string): ProblemResult {
  const guts = round.kind === 'guts';
  const usable = drafts.filter((d) => !d.errors.length);
  const lastPoints = round.problems[round.problems.length - 1]?.points ?? (round.kind === 'team' ? 5 : 1);
  const pointsInSet = (list: Problem[], set: number | null) => list.find((p) => p.set === set)?.points;
  const make = (d: DraftProblem, number: number, list: Problem[], idx: number): Problem => {
    const set = guts ? d.set ?? Math.floor(idx / 4) + 1 : undefined;
    return {
      id: newId(), number, set,
      text: d.text, answers: d.answers.length ? d.answers : [''],
      answerType: d.answerType ?? inferType(d.answers),
      points: d.points ?? (guts ? pointsInSet(list, set ?? null) : undefined) ?? lastPoints,
    };
  };
  const order = (list: Problem[]) => (guts ? [...list].sort((a, b) => (a.set ?? 0) - (b.set ?? 0) || a.number - b.number) : [...list].sort((a, b) => a.number - b.number));

  if (mode === 'replace') {
    const sorted = [...usable].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.row - b.row);
    const list: Problem[] = [];
    sorted.forEach((d, i) => list.push(make(d, i + 1, [...list, ...round.problems], i)));
    const problems = renumber(order(list));
    return { problems, added: problems.length, updated: 0, removed: round.problems.length };
  }
  if (mode === 'append') {
    const list = [...round.problems];
    usable.forEach((d, i) => list.push(make(d, Math.max(0, ...list.map((p) => p.number)) + 1, list, round.problems.length + i)));
    return { problems: renumber(order(list)), added: usable.length, updated: 0, removed: 0 };
  }
  // Update by number: matching numbers change, the rest are added at the end.
  const list = round.problems.map((p) => ({ ...p }));
  let updated = 0;
  let added = 0;
  for (const d of usable) {
    const p = d.number !== null ? list.find((x) => x.number === d.number) : undefined;
    if (p) {
      p.text = d.text;
      if (d.answers.length) p.answers = d.answers;
      if (d.answerType) p.answerType = d.answerType;
      else if (d.answers.length) p.answerType = inferType(d.answers);
      if (d.points !== null) p.points = d.points;
      if (guts && d.set !== null) p.set = d.set;
      updated++;
    } else {
      list.push(make(d, Math.max(0, ...list.map((x) => x.number)) + 1, list, list.length));
      added++;
    }
  }
  return { problems: renumber(order(list)), added, updated, removed: 0 };
}

/** Numbers 1..n in list order. */
export function renumber(list: Problem[]): Problem[] {
  return list.map((p, i) => (p.number === i + 1 ? p : { ...p, number: i + 1 }));
}

// ===================================================== paper answer sheets

export type SheetMap = { id: number | undefined; cols: Record<string, number> };

/** "1", "P1", "Q 1", "Problem 1", "#1"; for Guts also "2.3" (set 2, third problem). */
export function guessSheetMap(headers: string[], round: Round): SheetMap {
  const cols: Record<string, number> = {};
  const used = new Set<number>();
  const label = (p: Problem) => (round.kind === 'guts' && p.set ? `${p.set}.${round.problems.filter((x) => x.set === p.set).indexOf(p) + 1}` : '');
  for (const p of round.problems) {
    const i = headers.findIndex((h, k) => {
      if (used.has(k)) return false;
      const v = h.trim().toLowerCase();
      const num = v.match(/^(?:p|q|problem|question|#|no\.?)?\s*#?\s*(\d+)$/);
      if (num && Number(num[1]) === p.number) return true;
      return !!label(p) && v.replace(/\s+/g, '') === label(p);
    });
    if (i >= 0) {
      cols[p.id] = i;
      used.add(i);
    }
  }
  let id = headers.findIndex((h, k) => !used.has(k) && /\bid\b|code|team|competitor|student|entrant/i.test(h));
  if (id < 0) id = headers.findIndex((_, k) => !used.has(k));
  return { id: id >= 0 ? id : undefined, cols };
}

export type Entrant = { id: string; code: string; name: string };

export type SheetRow = {
  row: number;
  key: string;
  raw: string;
  entrant: Entrant | null;
  values: Record<string, string>;
  filled: number;
  hasSheet: boolean;
  errors: string[];
  warnings: string[];
};

export function planSheets(rows: string[][], map: SheetMap, entrants: Entrant[], withSheet: Set<string>): SheetRow[] {
  const byCode = new Map(entrants.map((e) => [normCode(e.code), e]));
  const seen = new Set<string>();
  return rows.slice(1).map((r, k) => {
    const raw = cellOf(r, map.id);
    const e = raw ? byCode.get(normCode(raw)) ?? null : null;
    const values: Record<string, string> = {};
    for (const [pid, i] of Object.entries(map.cols)) values[pid] = cellOf(r, i);
    const s: SheetRow = {
      row: k + 2, key: `p${k + 2}`, raw, entrant: e, values, filled: Object.values(values).filter(Boolean).length,
      hasSheet: !!e && withSheet.has(e.id), errors: [], warnings: [],
    };
    if (!raw) s.errors.push('No ID');
    else if (!e) s.errors.push(`Unknown ID “${raw}”`);
    else if (seen.has(e.id)) s.errors.push('Same ID earlier in the file');
    if (e) seen.add(e.id);
    if (!s.filled && !s.errors.length) s.warnings.push('Every answer blank');
    return s;
  });
}

/** Guts: the sets a row has answers for, 1..last set with anything in it (blank sets in between count as handed in). */
export function gutsSetsOf(round: Round, values: Record<string, string>): number[] {
  const last = Math.max(0, ...round.problems.filter((p) => (values[p.id] ?? '').trim()).map((p) => p.set ?? 1));
  return Array.from({ length: last }, (_, i) => i + 1);
}

// ------------------------------------------------------------------ samples

export const SAMPLE_STUDENTS = [
  'Team,Student name,Grade,Parent name,Parent email',
  '03,Nina Laurent,9,Claire Laurent,claire.laurent@example.com',
  'Blue Tangents,Theo Laurent,9,Claire Laurent,claire.laurent@example.com',
  '18,Priya Shah,10,Anil Shah,anil.shah@example.com',
  'Kelp Vectors,Tom Becker,10,Ute Becker,ute.becker@example.com',
  '99,Ghost Student,9,,',
  'Moon Jellies,Lucas Grey,8,Ivy Grey,ivy.grey@example',
].join('\n');

export const SAMPLE_PROBLEMS = [
  'Number,Problem,Answer,Points,Type',
  '1,Compute $1 + 2 + \\cdots + 10$.,55,1,integer',
  '2,What is $\\frac{1}{2} + \\frac{1}{3}$?,5/6 | \\frac{5}{6},1,expression',
  '3,"How many primes are less than $30$?",10,1,',
  '4,Find the area of a circle with radius $3$.,9\\pi | 9pi,2,expression',
  '5,"A number with no answer yet, for checking the warnings.",,1,',
].join('\n');

export const SAMPLE_PROBLEM_TEXT = `1. Compute $1 + 2 + \\cdots + 10$.
Answer: 55

2. What is $\\frac{1}{2} + \\frac{1}{3}$?
Answer: 5/6 | \\frac{5}{6}
Points: 2

3. How many primes are less than $30$?
Answer: 10`;

/** A sheet for a round, using real IDs so the sample matches. */
export function sampleSheet(round: Round, entrants: Entrant[]): string {
  const cols = round.problems.map((p) => (round.kind === 'guts' ? `${p.set}.${round.problems.filter((x) => x.set === p.set).indexOf(p) + 1}` : String(p.number)));
  const pickE = entrants.slice(0, 4);
  const lines = [['ID', ...cols].join(',')];
  pickE.forEach((e, i) => {
    const vals = round.problems.map((p, k) => (k % (3 + i) === 2 ? '' : (p.answers[0] ?? '').replace(/^\\frac\{(\d+)\}\{(\d+)\}$/, '$1/$2').replace(/,/g, '')));
    const upto = round.kind === 'guts' ? vals.map((v, k) => (round.problems[k].set! <= 2 + i ? v : '')) : vals;
    lines.push([e.code, ...upto].join(','));
  });
  lines.push(['99Z', ...round.problems.map(() => '1')].join(','));
  return lines.join('\n');
}
