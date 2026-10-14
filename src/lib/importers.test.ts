import { describe, expect, it } from 'vitest';
import { buildPlan, guessMapping, parseCsv, SAMPLE_CSV } from './csv';
import type { Round } from './model';
import {
  applyProblems, dedupeTeams, defaultTeamAction, isDuplicate, guessProblemMap, guessSheetMap, guessStudentImport, gutsSetsOf, inferType, norm, normCode,
  parseProblemRows, parseProblemText, planSheets, planStudents, readAnswerType, SAMPLE_PROBLEMS, summarizeTeams,
} from './importers';

const existing = [
  { id: 't01', code: '01', name: 'Krill Seekers', school: 'Harborview High', city: 'San Francisco', contactName: 'Grace Okafor', contactEmail: 'grace.okafor@example.com', divisionId: 'in_person', status: 'confirmed' as const },
  { id: 't03', code: '03', name: 'Blue Tangents', school: 'Fogline Academy', city: 'Daly City', contactName: 'Claire Laurent', contactEmail: 'claire.laurent@example.com', divisionId: 'in_person', status: 'pending' as const },
];
const students = [
  { id: 'c01A', teamId: 't01', name: 'Maya Okafor', guardianEmail: 'grace.okafor@example.com' },
  { id: 'c03A', teamId: 't03', name: 'Theo Laurent', guardianEmail: 'claire.laurent@example.com' },
  { id: 'c03B', teamId: 't03', name: 'Amara Diallo', guardianEmail: 'fatou.diallo@example.com' },
];

describe('norm and normCode', () => {
  it('ignores case, accents and punctuation', () => {
    expect(norm('  Pi-Rates! ')).toBe('pi rates');
    expect(norm('Sofía Marín')).toBe(norm('sofia marin'));
    expect(normCode('7')).toBe('07');
    expect(normCode(' 7a ')).toBe('07A');
  });
});

describe('dedupeTeams on the sample', () => {
  const rows = parseCsv(SAMPLE_CSV);
  const plan = buildPlan(rows, guessMapping(rows[0]), { defaultMode: 'in_person', offered: ['in_person', 'online'], teamMax: 4 });
  const d = dedupeTeams(plan, existing, students, 4);
  const by = Object.fromEntries(d.rows.map((r) => [r.name, r]));

  it('merges a resubmitted team into its first row, keeping each student once', () => {
    expect(d.merged).toBe(1);
    expect(by['Pi-Rates']).toBeUndefined();
    expect(by['Pi Rates'].students.map((s) => s.name)).toEqual(['Jin Lee', 'Omar Haddad', 'Clara Voss', 'Theo Brandt']);
    expect(by['Pi Rates'].notes[0]).toMatch(/merged in \(same name\), 1 more student/);
    expect(d.studentDups).toBe(2);
  });

  it('matches registered teams by name, or by contact email and school', () => {
    expect(by['Krill Seekers'].existing?.why).toBe('same name');
    expect(by['Krill Seekers'].newStudents).toEqual([]);
    expect(by['Blue Tangent'].existing).toMatchObject({ id: 't03', why: 'same contact email and school' });
    expect(by['Blue Tangent'].newStudents.map((s) => s.name)).toEqual(['Nina Laurent']);
    expect(by['Blue Tangent'].changes).toEqual([]);
    expect(by['Blue Tangent'].notes[0]).toMatch(/keeps that name/);
    expect(defaultTeamAction(by['Krill Seekers'])).toBe('skip');
    expect(defaultTeamAction(by['Angle Fish'])).toBe('new');
  });

  it('counts what each action does', () => {
    const s = summarizeTeams(d.rows, { [by['Blue Tangent'].key]: 'update' });
    expect(s.update.map((r) => r.name)).toEqual(['Blue Tangent']);
    expect(s.skipped).toBe(1);
    expect(s.blocked).toBe(1); // Prime Tide's bad email
    expect(s.create.map((r) => r.name)).toEqual(['Angle Fish', 'Rational Reef', 'Pi Rates', 'Eigen Eels']);
  });
});

describe('two rows from the same coach and school', () => {
  const rows = parseCsv(['Team,Format,Contact email,School,Student', 'Sine Waves,online,a@b.co,Elm High,Ann', 'Sine Waves B,online,a@b.co,Elm High,Bo', 'Sine Wavez,online,a@b.co,Elm High,Ann'].join('\n'));
  const plan = buildPlan(rows, guessMapping(rows[0]), { defaultMode: null, offered: ['online'], teamMax: 4 });
  const d = dedupeTeams(plan, [], [], 4);
  it('merges when they share a student, flags when they do not', () => {
    expect(d.rows.map((r) => r.name)).toEqual(['Sine Waves', 'Sine Waves B']);
    expect(d.rows[0].notes[0]).toMatch(/same contact email and school/);
    expect(d.rows[1].fileDupOf).toMatchObject({ name: 'Sine Waves', row: 2 });
    expect(isDuplicate(d.rows[1])).toBe(true);
  });
});

describe('planStudents', () => {
  const ctx = {
    teams: [{ id: 't01', code: '01', name: 'Krill Seekers' }, { id: 't03', code: '03', name: 'Blue Tangents' }],
    students: [...students, { id: 'c01B', teamId: 't01', name: 'B', guardianEmail: '' }, { id: 'c01C', teamId: 't01', name: 'C', guardianEmail: '' }, { id: 'c01D', teamId: 't01', name: 'D', guardianEmail: '' }],
    teamMax: 4,
  };
  const csv = parseCsv([
    'Team code,Student,Grade,Guardian name,Guardian email',
    '3,Nina Laurent,9,Claire Laurent,claire.laurent@example.com',
    'blue tangents,theo laurent,9,,',
    'Krill Seekers,New Kid,10,,',
    '42,Nobody,9,,',
    '03,Nina Laurent,9,,',
    '03,Maya Okafor,9,,grace.okafor@example.com',
  ].join('\n'));
  const map = guessStudentImport(csv[0]);

  it('guesses the columns', () => {
    expect(map).toEqual({ team: 0, student: 1, grade: 2, guardianName: 3, guardianEmail: 4 });
  });

  it('matches teams by code or name and flags duplicates, full teams and unknown teams', () => {
    const p = planStudents(csv, map, ctx);
    expect(p[0]).toMatchObject({ teamId: 't03', errors: [] });
    expect(p[0].dup).toBeUndefined();
    expect(p[1].dup).toBe('Already on this team');
    expect(p[2].errors[0]).toMatch(/is full/);
    expect(p[3].errors[0]).toMatch(/No team/);
    expect(p[4].dup).toBe('Appears earlier in this file');
    expect(p[5].dup).toMatch(/Same name and guardian email on 01 Krill Seekers/);
  });

  it('counts added duplicates against the team size', () => {
    const p = planStudents(csv, map, { ...ctx, teamMax: 4 }, { s3: 'add', s6: 'add', s7: 'add' });
    // Blue Tangents had 2: Nina, Theo (add anyway) fit; the second Nina also fits (4); Maya would be the 5th.
    expect(p[5].errors[0]).toMatch(/is full/);
  });
});

describe('problems', () => {
  it('reads a CSV with types and several answers', () => {
    const rows = parseCsv(SAMPLE_PROBLEMS);
    const map = guessProblemMap(rows[0]);
    expect(map).toMatchObject({ number: 0, text: 1, answers: 2, points: 3, type: 4 });
    const d = parseProblemRows(rows, map, false);
    expect(d[1].answers).toEqual(['5/6', '\\frac{5}{6}']);
    expect(d[1].answerType).toBe('expression');
    expect(d[2].answerType).toBeNull();
    expect(d[4].warnings).toContain('No answer yet');
  });

  it('reads pasted blocks', () => {
    const d = parseProblemText('1. What is $2+2$?\nAnswer: 4\n\nProblem 2: Half of one?\nAnswer: 1/2 | 0.5\nPoints: 3\nSet: 2', true);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ number: 1, text: 'What is $2+2$?', answers: ['4'] });
    expect(d[1]).toMatchObject({ number: 2, text: 'Half of one?', answers: ['1/2', '0.5'], points: 3, set: 2 });
  });

  it('knows answer types', () => {
    expect(readAnswerType('Integer')).toBe('integer');
    expect(readAnswerType('fraction')).toBe('expression');
    expect(inferType(['12', '-3'])).toBe('integer');
    expect(inferType(['3/8'])).toBe('expression');
  });

  const round: Round = {
    id: 'r', name: 'R', short: 'R', kind: 'individual', minutes: 60, startsAt: '', status: 'scheduled', graceSeconds: 0, integrity: { policy: 'log', lockAfter: 3 }, rules: '',
    problems: [
      { id: 'a', number: 1, text: 'Old 1', answers: ['1'], answerType: 'integer', points: 2 },
      { id: 'b', number: 2, text: 'Old 2', answers: ['2'], answerType: 'integer', points: 2 },
    ],
  };
  const drafts = parseProblemText('2. New two\nAnswer: 3/4\n\n7. Brand new\nAnswer: 9', false);
  let n = 0;
  const id = () => `new${++n}`;

  it('replaces, appends, or updates by number', () => {
    const r = applyProblems(round, drafts, 'replace', id);
    expect(r.problems.map((p) => [p.number, p.text, p.points])).toEqual([[1, 'New two', 2], [2, 'Brand new', 2]]);
    expect(r.removed).toBe(2);
    const a = applyProblems(round, drafts, 'append', id);
    expect(a.problems.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(a.problems[2].answerType).toBe('expression');
    const u = applyProblems(round, drafts, 'update', id);
    expect(u.updated).toBe(1);
    expect(u.added).toBe(1);
    expect(u.problems.map((p) => [p.id, p.text])).toEqual([['a', 'Old 1'], ['b', 'New two'], [expect.stringMatching(/^new/), 'Brand new']]);
  });
});

describe('paper sheets', () => {
  const round: Round = {
    id: 'g', name: 'Guts', short: 'Guts', kind: 'guts', minutes: 60, startsAt: '', status: 'open', graceSeconds: 0, integrity: { policy: 'log', lockAfter: 3 }, rules: '',
    problems: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `g${i}`, number: i, set: Math.ceil(i / 4), text: '', answers: ['1'], answerType: 'integer' as const, points: 4 })),
  };
  it('maps numbered and set.problem columns, and flags unknown IDs', () => {
    const rows = parseCsv('Team code,1,2,3,4,2.1,2.2,2.3,2.4\n7,1,2,,4,,,,\n99,1,1,1,1,1,1,1,1\n07,,,,,,,,');
    const map = guessSheetMap(rows[0], round);
    expect(map.id).toBe(0);
    expect(map.cols.g1).toBe(1);
    expect(map.cols.g5).toBe(5);
    const p = planSheets(rows, map, [{ id: 't07', code: '07', name: 'Bioluminati' }], new Set(['t07']));
    expect(p[0]).toMatchObject({ entrant: { id: 't07' }, filled: 3, hasSheet: true, errors: [] });
    expect(p[1].errors[0]).toMatch(/Unknown ID/);
    expect(p[2].errors[0]).toMatch(/earlier in the file/);
    expect(gutsSetsOf(round, p[0].values)).toEqual([1]);
    expect(gutsSetsOf(round, { g6: '3' })).toEqual([1, 2]);
  });
});
