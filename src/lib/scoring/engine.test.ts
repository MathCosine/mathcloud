import { describe, expect, it } from 'vitest';
import type { Attempt, Competitor, Contest, Problem, Round, Team } from '../model';
import { gradeAnswer, indexRulings, normalize } from './answers';
import { assignPlaces, awardFor, computeStandings, distinctAnswers, rareWrongCollisions, teamIndividual } from './engine';

const p = (id: string, number: number, answers: string[], answerType: Problem['answerType'] = 'integer', points = 1, set?: number): Problem => ({
  id,
  number,
  answers,
  answerType,
  points,
  set,
  text: '',
});

describe('normalize', () => {
  it('ignores typing differences in integers', () => {
    expect(normalize(' 007 ', 'integer')).toBe('7');
    expect(normalize('+12', 'integer')).toBe('12');
    expect(normalize('1,000', 'integer')).toBe('1000');
    expect(normalize('−5', 'integer')).toBe('-5');
    expect(normalize('$42$', 'integer')).toBe('42');
    expect(normalize('-0', 'integer')).toBe('0');
  });
  it('reads LaTeX fractions and roots as plain text', () => {
    expect(normalize('\\frac{1}{2}', 'expression')).toBe('1/2');
    expect(normalize('\\dfrac{3}{4}', 'expression')).toBe('3/4');
    expect(normalize('\\frac{\\sqrt{3}}{2}', 'expression')).toBe('(sqrt(3))/2');
    expect(normalize('2\\sqrt{2}', 'expression')).toBe('2sqrt(2)');
    expect(normalize('x^{2}', 'expression')).toBe('x^2');
    expect(normalize('\\frac12', 'expression')).toBe('1/2');
  });
  it('never decides that different maths is the same', () => {
    expect(normalize('0.5', 'expression')).not.toBe(normalize('1/2', 'expression'));
  });
});

describe('gradeAnswer', () => {
  const half = p('h', 1, ['\\frac{1}{2}'], 'expression');
  const seven = p('s', 2, ['7']);
  const none = indexRulings([]);
  it('marks key matches correct and blanks blank', () => {
    expect(gradeAnswer(half, '1/2', none)).toBe('correct');
    expect(gradeAnswer(seven, ' 07', none)).toBe('correct');
    expect(gradeAnswer(seven, '', none)).toBe('blank');
    expect(gradeAnswer(seven, undefined, none)).toBe('blank');
  });
  it('marks a different clean integer wrong without asking anyone', () => {
    expect(gradeAnswer(seven, '8', none)).toBe('incorrect');
    expect(gradeAnswer(half, '2', none)).toBe('incorrect');
  });
  it('marks a fraction or decimal with a different value wrong', () => {
    expect(gradeAnswer(half, '1/4', none)).toBe('incorrect');
    expect(gradeAnswer(half, '0.6', none)).toBe('incorrect');
    expect(gradeAnswer(half, '2/4', none)).toBe('unreviewed');
  });
  it('sends odd forms to a person, and then follows the ruling', () => {
    expect(gradeAnswer(half, '0.5', none)).toBe('unreviewed');
    expect(gradeAnswer(seven, 'seven', none)).toBe('unreviewed');
    const ruled = indexRulings([{ roundId: 'r', problemId: 'h', normalized: '0.5', correct: true, by: 'd', at: '' }]);
    expect(gradeAnswer(half, '0.5', ruled)).toBe('correct');
  });
});

describe('assignPlaces', () => {
  it('shares places on ties and skips the next (1, 1, 3)', () => {
    const rows = [20, 20, 18, 17, 17, 17, 9];
    const placed = assignPlaces(rows, (a, b) => a === b);
    expect(placed.map((x) => x.place)).toEqual([1, 1, 3, 4, 4, 4, 7]);
    expect(placed.map((x) => x.tied)).toEqual([1, 1, 0, 2, 2, 2, 0]);
  });
});

describe('awardFor', () => {
  const rules = [
    { id: 'a', scope: 'individual' as const, label: 'Top 10%', rule: 'top_percent' as const, value: 10 },
    { id: 'b', scope: 'individual' as const, label: 'Top half', rule: 'top_percent' as const, value: 50 },
  ];
  it('uses the first rule that fits, rounding cut-offs up', () => {
    expect(awardFor(1, 25, rules)).toBe('Top 10%');
    expect(awardFor(3, 25, rules)).toBe('Top 10%');
    expect(awardFor(4, 25, rules)).toBe('Top half');
    expect(awardFor(14, 25, rules)).toBeUndefined();
  });
});

describe('teamIndividual', () => {
  it('takes the best k and writes out the sum', () => {
    const r = teamIndividual(
      [
        { id: 'A', score: 12 },
        { id: 'B', score: 15 },
        { id: 'C', score: 9 },
        { id: 'D', score: 14 },
      ],
      { method: 'best', best: 3, fillMissingTo: 0 },
      20,
    );
    expect(r.raw).toBe(41);
    expect(r.max).toBe(60);
    expect(r.counted).toEqual(['B', 'D', 'A']);
    expect(r.detail).toBe('15 + 14 + 12 = 41 (best 3 of 4)');
  });
  it('fills missing members with zero (the BMT rule)', () => {
    const r = teamIndividual([{ id: 'A', score: 10 }, { id: 'B', score: 8 }], { method: 'sum', best: 4, fillMissingTo: 4 }, 20);
    expect(r.raw).toBe(18);
    expect(r.detail).toBe('10 + 8 + 0 + 0 = 18');
  });
});

// --------------------------------------------------------------- standings

function fixture() {
  const ind: Round = {
    id: 'ind', name: 'Individual', short: 'Ind', kind: 'individual', minutes: 60, startsAt: '', status: 'closed', graceSeconds: 0,
    integrity: { policy: 'log', lockAfter: 3 }, rules: '',
    problems: [p('i1', 1, ['1']), p('i2', 2, ['2']), p('i3', 3, ['3'])],
  };
  const guts: Round = {
    id: 'guts', name: 'Guts', short: 'Guts', kind: 'guts', minutes: 60, startsAt: '', status: 'closed', graceSeconds: 0,
    integrity: { policy: 'log', lockAfter: 3 }, rules: '',
    problems: [p('g1', 1, ['5'], 'integer', 4, 1), p('g2', 2, ['6'], 'integer', 6, 2)],
  };
  const contest: Contest = {
    id: 'c', orgId: 'o', name: 'Test', short: 'T', slug: 't', dateLabel: '', timeZone: 'UTC', rooms: [], venue: null, agenda: [], resultsPublished: false, board: { freezeMinutes: 10, revealed: false },
    registration: { open: true, closesLabel: '', teamMin: 1, teamMax: 4 },
    divisions: [{ id: 'd', name: 'D', mode: 'in_person', detail: '' }],
    rounds: [ind, guts],
    recipe: {
      teamIndividual: { method: 'best', best: 2, fillMissingTo: 0 },
      weights: { ind: 2, guts: 1 },
      harderFirst: true,
      awards: [
        { id: 'w', scope: 'individual', label: 'Winner', rule: 'top_n', value: 1 },
        { id: 't', scope: 'team', label: 'Champions', rule: 'top_n', value: 1 },
      ],
    },
  };
  const team = (id: string, code: string): Team => ({
    id, contestId: 'c', code, name: id, divisionId: 'd', school: '', city: '', contactName: '', contactEmail: '', status: 'confirmed',
    registeredAt: '', joinCode: '', pledge: null,
  });
  const comp = (id: string, teamId: string, publicId: string): Competitor => ({
    id, teamId, slot: publicId.slice(-1), publicId, name: id, grade: 10, guardianName: '', guardianEmail: '', waiverSignedAt: null,
  });
  const att = (roundId: string, entrantId: string, values: Record<string, string>): Attempt => ({
    id: `${roundId}-${entrantId}`, roundId, entrantId, source: 'paper', events: [],
    responses: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, savedAt: '', by: 'g' }])),
  });
  const teams = [team('T1', '01'), team('T2', '02')];
  const competitors = [comp('a', 'T1', '01A'), comp('b', 'T1', '01B'), comp('c', 'T1', '01C'), comp('x', 'T2', '02A'), comp('y', 'T2', '02B')];
  const attempts = [
    // a and x both score 2, but x solved problem 3, which fewer people solved.
    att('ind', 'a', { i1: '1', i2: '2', i3: '0' }),
    att('ind', 'x', { i1: '1', i2: '0', i3: '3' }),
    att('ind', 'b', { i1: '1', i2: '2', i3: '9' }),
    att('ind', 'c', { i1: '1', i2: '', i3: '' }),
    att('ind', 'y', { i1: '0', i2: '0', i3: '0' }),
    att('guts', 'T1', { g1: '5', g2: '0' }),
    att('guts', 'T2', { g1: '5', g2: '6' }),
  ];
  return { contest, teams, competitors, attempts, rulings: [] };
}

describe('computeStandings', () => {
  it('ranks individuals and breaks ties by the harder problem', () => {
    const s = computeStandings(fixture());
    const rows = s.individuals.d.map((r) => [r.competitor.publicId, r.score, r.place]);
    expect(rows).toEqual([
      ['02A', 2, 1],
      ['01A', 2, 2],
      ['01B', 2, 2],
      ['01C', 1, 4],
      ['02B', 0, 5],
    ]);
    expect(s.individuals.d[0].award).toBe('Winner');
    expect(s.individuals.d[0].brokeTie).toBe(true);
  });

  it('builds team totals from weighted parts, with the arithmetic', () => {
    const s = computeStandings(fixture());
    const [first, second] = s.teams.d;
    // T1: best 2 of (2, 2, 1) = 4, ×2 = 8; guts 4. Total 12.
    // T2: best 2 of (2, 0) = 2, ×2 = 4; guts 10. Total 14.
    expect(first.team.id).toBe('T2');
    expect(first.total).toBe(14);
    expect(first.award).toBe('Champions');
    expect(second.total).toBe(12);
    expect(second.parts[0].detail).toBe('2 + 2 = 4 (best 2 of 3)');
  });

  it('drops a disqualified competitor from ranking and from the team', () => {
    const f = fixture();
    f.competitors[0].disqualified = 'Notes in the room';
    const s = computeStandings(f);
    expect(s.individuals.d.find((r) => r.competitor.id === 'a')).toBeUndefined();
    expect(s.teams.d.find((r) => r.team.id === 'T1')!.parts[0].raw).toBe(3);
  });

  it('reports problem solve rates per division', () => {
    const s = computeStandings(fixture());
    const stats = s.problemStats.d.ind;
    expect(stats.map((x) => x.correct)).toEqual([4, 2, 1]);
    expect(stats[2].rate).toBeCloseTo(0.2);
  });
});

describe('distinctAnswers and collisions', () => {
  it('groups answers by their normal form', () => {
    const prob = p('h', 1, ['\\frac12'], 'expression');
    const atts: Attempt[] = ['1/2', '\\frac{1}{2}', '0.5', ' 0.5', '2'].map((v, i) => ({
      id: String(i), roundId: 'r', entrantId: String(i), source: 'online', startedAt: 'x', events: [],
      responses: { h: { value: v, savedAt: '', by: '' } },
    }));
    const groups = distinctAnswers(prob, atts, [], (raw) => normalize(raw, 'expression'));
    expect(groups.map((g) => [g.normalized, g.count, g.status])).toEqual([
      ['1/2', 2, 'correct'],
      ['0.5', 2, 'unreviewed'],
      ['2', 1, 'incorrect'],
    ]);
  });

  it('flags pairs who share rare wrong answers', () => {
    const round: Round = {
      id: 'r', name: '', short: '', kind: 'individual', minutes: 1, startsAt: '', status: 'closed', graceSeconds: 0,
      integrity: { policy: 'log', lockAfter: 1 }, rules: '',
      problems: [p('q1', 1, ['10']), p('q2', 2, ['20']), p('q3', 3, ['30'])],
    };
    const mk = (id: string, v: string[]): Attempt => ({
      id, roundId: 'r', entrantId: id, source: 'online', startedAt: 'x', events: [],
      responses: { q1: { value: v[0], savedAt: '', by: '' }, q2: { value: v[1], savedAt: '', by: '' }, q3: { value: v[2], savedAt: '', by: '' } },
    });
    const atts = [mk('A', ['11', '23', '30']), mk('B', ['11', '23', '30'])];
    for (let i = 0; i < 20; i++) atts.push(mk(`n${i}`, ['10', '20', String(i)]));
    const hits = rareWrongCollisions(round, atts, []);
    expect(hits).toEqual([{ a: 'A', b: 'B', shared: ['1:11', '2:23'] }]);
  });
});
