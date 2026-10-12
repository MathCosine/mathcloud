import { describe, expect, it } from 'vitest';
import type { Attempt, Contest, Team } from '../model';
import { buildBoard } from './board';

const T0 = new Date('2027-01-23T20:00:00Z').getTime();
const at = (min: number) => new Date(T0 + min * 60000).toISOString();

function fixture() {
  const contest: Contest = {
    id: 'c', orgId: 'o', name: 'Test', short: 'T', slug: 't', dateLabel: '', timeZone: 'UTC', rooms: [],
    resultsPublished: false, registration: { open: false, closesLabel: '', teamMin: 1, teamMax: 4 },
    board: { freezeMinutes: 10, revealed: false },
    divisions: [{ id: 'd', name: 'D', mode: 'in_person', detail: '' }],
    recipe: { teamIndividual: { method: 'sum', best: 4, fillMissingTo: 0 }, weights: {}, harderFirst: false, awards: [] },
    rounds: [
      {
        id: 'g', name: 'Guts', short: 'Guts', kind: 'guts', minutes: 60, startsAt: '', status: 'open', openedAt: at(0), graceSeconds: 0,
        integrity: { policy: 'log', lockAfter: 9 }, rules: '',
        problems: [
          { id: 'p1', number: 1, set: 1, text: '', answers: ['1'], answerType: 'integer', points: 4 },
          { id: 'p2', number: 2, set: 1, text: '', answers: ['2'], answerType: 'integer', points: 4 },
          { id: 'p3', number: 3, set: 2, text: '', answers: ['3'], answerType: 'integer', points: 6 },
          { id: 'p4', number: 4, set: 2, text: '', answers: ['4'], answerType: 'integer', points: 6 },
        ],
      },
    ],
  };
  const team = (id: string, code: string): Team => ({
    id, contestId: 'c', code, name: id, divisionId: 'd', school: '', city: '', contactName: '', contactEmail: '',
    status: 'confirmed', registeredAt: '', joinCode: '', pledge: null,
  });
  const att = (teamId: string, values: Record<string, string>, setTimes: string[]): Attempt => ({
    id: `g:${teamId}`, roundId: 'g', entrantId: teamId, source: 'paper', events: [], setsSubmitted: setTimes.length, setTimes,
    responses: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, savedAt: '', by: '' }])),
  });
  const teams = [team('A', '01'), team('B', '02'), team('C', '03'), team('D', '04')];
  const attempts = [
    att('A', { p1: '1', p2: '2', p3: '3', p4: '9' }, [at(10), at(55)]), // set 2 after the freeze
    att('B', { p1: '1', p2: '0', p3: '3', p4: '4' }, [at(12), at(30)]),
    att('C', { p1: '1', p2: '0' }, [at(20)]),
  ];
  return { contest, teams, attempts, rulings: [] };
}

describe('buildBoard', () => {
  it('scores handed-in sets and orders by score, with no place for a team on 0', () => {
    const b = buildBoard({ ...fixture(), divisionId: 'all', now: T0 + 40 * 60000 })!;
    expect(b.frozen).toBe(false);
    expect(b.rows.map((r) => [r.team.id, r.score, r.sets, r.place])).toEqual([
      ['B', 16, 2, 1],
      ['A', 8, 1, 2],
      ['C', 4, 1, 3],
      ['D', 0, 0, null],
    ]);
    expect(b.rows[1].current).toBe(2);
    expect(b.rows[0].current).toBeNull();
    expect(b.rows[3].started).toBe(false);
  });

  it('freezes before the end: sets handed in after the freeze do not show', () => {
    const b = buildBoard({ ...fixture(), divisionId: 'all', now: T0 + 58 * 60000 })!;
    expect(b.frozen).toBe(true);
    expect(b.rows.find((r) => r.team.id === 'A')!.score).toBe(8);
  });

  it('shows everything once the director reveals', () => {
    const f = fixture();
    f.contest.board.revealed = true;
    const b = buildBoard({ ...f, divisionId: 'all', now: T0 + 58 * 60000 })!;
    expect(b.frozen).toBe(false);
    expect(b.rows.find((r) => r.team.id === 'A')!.score).toBe(14);
  });

  it('shares a place on equal scores', () => {
    const f = fixture();
    f.attempts[2].responses.p2 = { value: '2', savedAt: '', by: '' };
    f.attempts[1].responses.p3 = { value: '0', savedAt: '', by: '' };
    f.attempts[1].responses.p4 = { value: '0', savedAt: '', by: '' };
    const b = buildBoard({ ...f, divisionId: 'all', now: T0 + 40 * 60000 })!;
    const places = Object.fromEntries(b.rows.map((r) => [r.team.id, r.place]));
    expect(places).toEqual({ A: 1, C: 1, B: 3, D: null });
    expect(b.rows.find((r) => r.team.id === 'A')!.tied).toBe(true);
  });
});
