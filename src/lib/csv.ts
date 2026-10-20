/**
 * Importing teams that registered somewhere else: a Google Form, the SFMO
 * site, a spreadsheet a coach emailed. Two shapes are common and both work:
 *
 *  - one row per team, with "Student 1 name", "Student 2 name", ... columns
 *    (what a Google Form produces);
 *  - one row per student, with a team column repeated on each row.
 *
 * Nothing here touches the database. It turns text into a plan the director
 * can read, row by row, before anything is created.
 */
import type { DivisionMode } from './model';
import type { NewTeam } from './actions';

// -------------------------------------------------------------------- parse

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes, CRLF, a BOM. Comma, tab or semicolon. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = ['\t', ';', ','].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// ------------------------------------------------------------------ columns

export type TeamField = 'team' | 'school' | 'city' | 'mode' | 'contactName' | 'contactEmail' | 'code' | 'externalId';
export type StudentField = 'student' | 'grade' | 'guardianName' | 'guardianEmail' | 'waiver' | 'studentId';

export const TEAM_FIELDS: { key: TeamField; label: string; required?: boolean }[] = [
  { key: 'team', label: 'Team name', required: true },
  { key: 'mode', label: 'In person or online' },
  { key: 'school', label: 'School' },
  { key: 'city', label: 'City' },
  { key: 'contactName', label: 'Coach or contact' },
  { key: 'contactEmail', label: 'Contact email', required: true },
  { key: 'code', label: 'Team number (keep yours)' },
  { key: 'externalId', label: 'Team ID in your old system' },
];
export const STUDENT_FIELDS: { key: StudentField; label: string; required?: boolean }[] = [
  { key: 'student', label: 'Student name', required: true },
  { key: 'grade', label: 'Grade' },
  { key: 'guardianName', label: 'Guardian name' },
  { key: 'guardianEmail', label: 'Guardian email' },
  { key: 'waiver', label: 'Waiver signed?' },
  { key: 'studentId', label: 'Student ID in your old system' },
];

const GUESS: Record<TeamField | StudentField, RegExp> = {
  team: /^team( name)?$|team name|name of (your )?team/i,
  mode: /in.?person|online|compete|attend|format|participat|division|location|how will/i,
  school: /school|club|organi[sz]ation|institution/i,
  city: /city|town|location of|where are you/i,
  contactName: /coach|contact|sponsor|teacher|registrant|your name/i,
  contactEmail: /e-?mail/i,
  student: /student|competitor|member|participant|name/i,
  grade: /grade|year|class of/i,
  guardianName: /(parent|guardian).*name|name.*(parent|guardian)/i,
  guardianEmail: /(parent|guardian).*e-?mail|e-?mail.*(parent|guardian)/i,
  code: /^team ?(number|no\.?|#|code)$|^(code|number|#|no\.?)$/i,
  externalId: /^(team )?(id|ref(erence)?|registration (id|number))$/i,
  waiver: /waiver|consent|release|permission slip/i,
  studentId: /^(student |competitor )?id$|student (id|number)|competitor (id|number)/i,
};

/** Columns like "Student 2 grade" or "Member #3 - Parent email". */
const NUMBERED = /\b(student|member|competitor|participant|contestant)\s*#?\s*(\d+)\b/i;

export type Mapping = {
  shape: 'wide' | 'long';
  team: Partial<Record<TeamField, number>>;
  /** Long shape: one set of student columns. Wide: one per numbered student. */
  students: Partial<Record<StudentField, number>>[];
};

function studentFieldOf(header: string): StudentField | null {
  const rest = header.replace(NUMBERED, ' ');
  if (GUESS.waiver.test(rest)) return 'waiver';
  if (/\b(id|number)\b/i.test(rest) && !/phone/i.test(rest)) return 'studentId';
  if (GUESS.guardianEmail.test(rest) || (/parent|guardian/i.test(rest) && /e-?mail/i.test(rest))) return 'guardianEmail';
  if (GUESS.guardianName.test(rest) || /parent|guardian/i.test(rest)) return 'guardianName';
  if (/e-?mail/i.test(rest)) return null;
  if (GUESS.grade.test(rest)) return 'grade';
  return 'student';
}

/** Best guess at which column is which. The director can change any of it. */
export function guessMapping(headers: string[]): Mapping {
  const numbered = headers.map((h) => h.match(NUMBERED));
  const team: Mapping['team'] = {};
  const used = new Set<number>();
  const take = (key: TeamField, test: (h: string) => boolean) => {
    const i = headers.findIndex((h, k) => !used.has(k) && !numbered[k] && test(h));
    if (i >= 0) {
      team[key] = i;
      used.add(i);
    }
  };
  take('team', (h) => GUESS.team.test(h));
  take('mode', (h) => GUESS.mode.test(h) && !/e-?mail/i.test(h));
  take('contactEmail', (h) => /e-?mail/i.test(h) && !/parent|guardian/i.test(h));
  take('contactName', (h) => GUESS.contactName.test(h) && !/e-?mail/i.test(h));
  take('school', (h) => GUESS.school.test(h));
  take('city', (h) => GUESS.city.test(h) && !GUESS.mode.test(h));
  take('code', (h) => GUESS.code.test(h.trim()));
  take('externalId', (h) => GUESS.externalId.test(h.trim()));

  if (numbered.some(Boolean)) {
    const byNo = new Map<number, Partial<Record<StudentField, number>>>();
    headers.forEach((h, i) => {
      const m = numbered[i];
      if (!m) return;
      const f = studentFieldOf(h);
      if (!f) return;
      const no = Number(m[2]);
      const s = byNo.get(no) ?? {};
      if (s[f] === undefined) s[f] = i;
      byNo.set(no, s);
    });
    return { shape: 'wide', team, students: [...byNo.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s) };
  }

  const s: Partial<Record<StudentField, number>> = {};
  const free = (i: number) => !used.has(i) && !Object.values(s).includes(i);
  const pickS = (key: StudentField, test: (h: string) => boolean) => {
    const i = headers.findIndex((h, k) => free(k) && test(h));
    if (i >= 0) s[key] = i;
  };
  pickS('guardianEmail', (h) => GUESS.guardianEmail.test(h) || (/parent|guardian/i.test(h) && /e-?mail/i.test(h)));
  pickS('guardianName', (h) => GUESS.guardianName.test(h) || (/parent|guardian/i.test(h) && !/e-?mail/i.test(h)));
  pickS('grade', (h) => GUESS.grade.test(h));
  pickS('waiver', (h) => GUESS.waiver.test(h));
  pickS('studentId', (h) => GUESS.studentId.test(h.trim()));
  pickS('student', (h) => GUESS.student.test(h) && !/e-?mail|parent|guardian/i.test(h));
  return { shape: 'long', team, students: [s] };
}

// --------------------------------------------------------------------- plan

/** "Yes", "signed", "TRUE", "x", "✓", a date: the waiver is in. Blank, "no", "pending": it is not. */
export function readYes(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || /^(no|n|false|0|pending|missing|not yet|unsigned|-)$/.test(v)) return false;
  return /^(yes|y|true|1|x|✓|✔|signed|received|done|complete|completed|on file)$/.test(v) || /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(v) || /signed|received/.test(v);
}

/** "Online (Zoom)", "virtual", "In-person in SF", "on site" → a mode; anything else → null. */
export function readMode(value: string): DivisionMode | null {
  const v = value.toLowerCase();
  if (/online|virtual|remote|zoom|from home/.test(v)) return 'online';
  if (/in.?person|on.?site|venue|campus|at the|attend/.test(v)) return 'in_person';
  return null;
}

export type PlannedTeam = NewTeam & {
  /** 1-based spreadsheet rows this team came from (the header is row 1). */
  rows: number[];
  /** Reasons it will not be imported. */
  errors: string[];
  /** Imported, but someone should look. */
  warnings: string[];
};

export type PlanOptions = {
  /** Used when there is no mode column, or a value cannot be read. */
  defaultMode: DivisionMode | null;
  /** The modes this contest offers. */
  offered: DivisionMode[];
  /** Duplicates against registered teams are found by dedupeTeams (importers.ts), which offers skip or update. */
  existingNames?: string[];
  teamMax: number;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MODE_WORD: Record<DivisionMode, string> = { in_person: 'in person', online: 'online' };

export function buildPlan(rows: string[][], map: Mapping, opts: PlanOptions): PlannedTeam[] {
  const [, ...body] = rows;
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
  // A contest that runs one way takes every team that way, whatever the file says.
  const only = opts.offered.length === 1 ? opts.offered[0] : null;
  const teams: PlannedTeam[] = [];
  const byName = new Map<string, PlannedTeam>();

  body.forEach((r, k) => {
    const rowNo = k + 2;
    const name = cell(r, map.team.team);
    const key = name.toLowerCase();
    let t = map.shape === 'long' && name ? byName.get(key) : undefined;
    if (!t) {
      const rawMode = cell(r, map.team.mode);
      t = {
        mode: only ?? (rawMode ? readMode(rawMode) : null) ?? opts.defaultMode ?? 'in_person',
        name, school: cell(r, map.team.school), city: cell(r, map.team.city),
        contactName: cell(r, map.team.contactName), contactEmail: cell(r, map.team.contactEmail),
        code: cell(r, map.team.code).replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || undefined,
        externalId: cell(r, map.team.externalId) || undefined,
        students: [], rows: [], errors: [], warnings: [],
      };
      if (!name) t.errors.push('No team name');
      if (!EMAIL.test(t.contactEmail)) t.errors.push(t.contactEmail ? `“${t.contactEmail}” is not an email address` : 'No contact email');
      if (only) {
        const said = rawMode ? readMode(rawMode) : null;
        if (said && said !== only) t.warnings.push(`File says “${rawMode}”; comes in ${MODE_WORD[only]}, the only way this contest runs`);
      } else if (rawMode && !readMode(rawMode)) {
        if (opts.defaultMode) t.warnings.push(`“${rawMode}” read as ${MODE_WORD[opts.defaultMode]}`);
        else t.errors.push(`Cannot tell whether “${rawMode}” is in person or online`);
      } else if (!rawMode && !opts.defaultMode) t.errors.push('No in person or online answer');
      if (!only && !opts.offered.includes(t.mode)) t.errors.push(`This contest has no ${MODE_WORD[t.mode]} places`);
      teams.push(t);
      if (name) byName.set(key, t);
    }
    t.rows.push(rowNo);
    for (const s of map.students) {
      const sname = cell(r, s.student);
      if (!sname) continue;
      const g = parseInt(cell(r, s.grade).replace(/\D+/g, ''), 10);
      t.students.push({
        name: sname, grade: Number.isFinite(g) ? g : null, guardianName: cell(r, s.guardianName), guardianEmail: cell(r, s.guardianEmail),
        externalId: cell(r, s.studentId) || undefined,
        ...(s.waiver !== undefined ? { fileWaiver: readYes(cell(r, s.waiver)) } : {}),
      });
    }
  });

  for (const t of teams) {
    if (!t.students.length) t.errors.push('No students');
    if (t.students.length > opts.teamMax) t.errors.push(`${t.students.length} students; teams have at most ${opts.teamMax}`);
    const noGuardian = t.students.filter((s) => !EMAIL.test(s.guardianEmail)).length;
    if (noGuardian && !t.errors.length) t.warnings.push(`${noGuardian} without a guardian email, so no waiver can be sent yet`);
  }
  return teams;
}

// ------------------------------------------------------------------- sample

/** What a Google Form export looks like, for trying the importer. */
export const SAMPLE_CSV = [
  'Timestamp,Team name,School,City,How will your team compete?,Coach name,Coach email,Student 1 name,Student 1 grade,Student 1 parent email,Student 2 name,Student 2 grade,Student 2 parent email,Student 3 name,Student 3 grade,Student 3 parent email,Student 4 name,Student 4 grade,Student 4 parent email',
  '12/1/2026 18:02,Angle Fish,Lowell High,San Francisco,In person (San Francisco),Dana Moore,dmoore@example.com,Iris Moore,10,pmoore@example.com,Leo Grant,10,kgrant@example.com,Ava Shah,9,rshah@example.com,Noah Kim,9,jkim@example.com',
  '12/2/2026 09:15,Rational Reef,Westlake Prep,Oakland,In person (San Francisco),Rosa Diaz,rdiaz@example.com,Elena Diaz,11,rdiaz@example.com,Marcus Bell,11,tbell@example.com,Ruby Ito,10,kito@example.com,,,',
  '12/2/2026 21:40,Pi Rates,Lakeview Math Circle,"Portland, OR",Online (Zoom),Sam Lee,samlee@example.com,Jin Lee,8,samlee@example.com,Omar Haddad,8,,Clara Voss,7,mvoss@example.com,,,',
  '12/3/2026 07:05,Prime Tide,International School,"Seoul, Korea",Online (Zoom),Min Park,minpark@example,Ha-eun Park,9,minpark@example.com,Ji-ho Choi,9,choi@example.com,,,,,,',
  '12/3/2026 16:30,Krill Seekers,Harborview High,San Francisco,In person (San Francisco),Grace Okafor,gokafor@example.com,Maya Okafor,11,gokafor@example.com,,,,,,,,,',
  '12/4/2026 11:12,Eigen Eels,Sunnyvale Middle,Sunnyvale,Not sure yet,Priya Raman,praman@example.com,Kavya Raman,7,praman@example.com,Ethan Wu,7,lwu@example.com,,,,,,',
  '12/5/2026 10:48,Pi-Rates,Lakeview Math Circle,"Portland, OR",Online (Zoom),Sam Lee,samlee@example.com,Jin Lee,8,samlee@example.com,Clara Voss,7,mvoss@example.com,Theo Brandt,8,kbrandt@example.com,,,',
  '12/6/2026 19:20,Blue Tangent,Fogline Academy,Daly City,In person (San Francisco),Claire Laurent,claire.laurent@example.com,Theo Laurent,9,claire.laurent@example.com,Nina Laurent,9,claire.laurent@example.com,,,,,,',
].join('\n');
