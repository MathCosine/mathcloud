import { describe, expect, it } from 'vitest';
import type { Competitor, Team } from './model';
import { badEmails, badIds, contactsOf, duplicateStudents, duplicateTeams, freeSlot, gradeIssues, isEmail, normName, rosterHealth, sizeIssues, slotIssues } from './people';

const team = (id: string, code: string, extra: Partial<Team> = {}): Team => ({
  id, contestId: 'k', code, name: `Team ${code}`, divisionId: 'in_person', school: `School ${code}`, city: 'SF', contactName: `Coach ${code}`,
  contactEmail: `coach${code}@x.org`, status: 'confirmed', registeredAt: `2026-10-${code}T10:00:00Z`, joinCode: 'J', pledge: null, ...extra,
});
const kid = (id: string, teamId: string, code: string, slot: string, name: string, extra: Partial<Competitor> = {}): Competitor => ({
  id, teamId, slot, publicId: `${code}${slot}`, name, grade: 9, guardianName: 'G', guardianEmail: `${id}@home.org`, waiverSignedAt: null, ...extra,
});

describe('names and emails', () => {
  it('normalises names', () => {
    expect(normName('  José  O’Neil-Smith ')).toBe('jose o neil smith');
    expect(normName('ANNA lee')).toBe(normName('Anna  Lee'));
  });
  it('checks emails', () => {
    expect(isEmail('a@b.org')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.org')).toBe(false);
  });
});

describe('duplicate students', () => {
  const teams = [team('t1', '01'), team('t2', '02')];
  it('keeps the one with a signed waiver and marks same-guardian pairs exact', () => {
    const a = kid('a', 't1', '01', 'A', 'Anna Lee', { guardianEmail: 'mom@x.org' });
    const b = kid('b', 't2', '02', 'A', 'anna lee', { guardianEmail: 'MOM@x.org', waiverSignedAt: '2026-10-05T00:00:00Z' });
    const [d] = duplicateStudents(teams, [a, b]);
    expect(d.keep.id).toBe('b');
    expect(d.drop.id).toBe('a');
    expect(d.why).toBe('same_guardian');
    expect(d.exact).toBe(true);
  });
  it('same name on different teams with different guardians is not exact', () => {
    const [d] = duplicateStudents(teams, [kid('a', 't1', '01', 'A', 'Sam Wu'), kid('b', 't2', '02', 'A', 'Sam Wu')]);
    expect(d.why).toBe('same_name');
    expect(d.exact).toBe(false);
    expect(d.keep.id).toBe('a'); // older team
  });
  it('same team is exact', () => {
    const [d] = duplicateStudents(teams, [kid('a', 't1', '01', 'A', 'Sam Wu'), kid('b', 't1', '01', 'B', 'Sam Wu')]);
    expect(d.why).toBe('same_team');
  });
});

describe('duplicate teams', () => {
  it('pairs same name, and same contact at the same school', () => {
    const dups = duplicateTeams([
      team('t1', '01', { name: 'Lowell A' }),
      team('t2', '02', { name: 'lowell  a' }),
      team('t3', '03', { contactEmail: 'c@x.org', school: 'Hill' }),
      team('t4', '04', { contactEmail: 'C@x.org', school: 'Hill' }),
      team('t5', '05', { contactEmail: 'c@x.org', school: 'Other' }),
    ]);
    expect(dups.map((d) => [d.keep.id, d.drop.id, d.why])).toEqual([
      ['t1', 't2', 'same_name'],
      ['t3', 't4', 'same_contact'],
    ]);
  });
});

describe('IDs and slots', () => {
  const teams = [team('t1', '01'), team('t2', '02')];
  it('finds IDs that do not match code and slot', () => {
    const c = kid('a', 't1', '01', 'A', 'X', { publicId: '07A' });
    expect(badIds(teams, [c])).toEqual([{ c, expected: '01A' }]);
  });
  it('finds collisions, gaps and taken codes', () => {
    const issues = slotIssues([...teams, team('t3', '02')], [
      kid('a', 't1', '01', 'A', 'X'), kid('b', 't1', '01', 'A', 'Y'), kid('c', 't2', '02', 'A', 'Z'), kid('d', 't2', '02', 'C', 'W'),
    ]);
    expect(issues.map((i) => i.kind).sort()).toEqual(['code_taken', 'collision', 'gap']);
    const gap = issues.find((i) => i.kind === 'gap');
    expect(gap && gap.kind === 'gap' && gap.missing).toEqual(['B']);
  });
  it('gives the first free letter', () => {
    expect(freeSlot('t1', [kid('a', 't1', '01', 'A', 'X'), kid('b', 't1', '01', 'C', 'Y')], 4)).toBe('B');
    expect(freeSlot('t1', [kid('a', 't1', '01', 'A', 'X')], 1)).toBe(null);
  });
});

describe('sizes, emails, grades, report', () => {
  const teams = [team('t1', '01'), team('t2', '02'), team('t3', '03', { status: 'withdrawn' })];
  const comps = [
    kid('a', 't1', '01', 'A', 'A1'), kid('b', 't1', '01', 'B', 'B1'), kid('c', 't1', '01', 'C', 'C1', { guardianEmail: '' }),
    kid('d', 't1', '01', 'D', 'D1', { grade: 0 }), kid('e', 't1', '01', 'E', 'E1', { guardianEmail: 'nope', grade: 14 }),
  ];
  it('sizes', () => {
    const s = sizeIssues(teams, comps, { teamMin: 1, teamMax: 4 });
    expect(s.map((x) => [x.team.id, x.kind])).toEqual([['t1', 'over'], ['t2', 'under']]);
  });
  it('emails and grades', () => {
    expect(badEmails(teams, comps).map((e) => e.email)).toEqual(['nope']);
    expect(gradeIssues(comps).map((g) => [g.c.id, g.kind])).toEqual([['d', 'missing'], ['e', 'range']]);
  });
  it('report totals every list', () => {
    const h = rosterHealth(teams, comps, { teamMin: 1, teamMax: 4 });
    expect(h.noGuardianEmail.map((c) => c.id)).toEqual(['c']);
    expect(h.total).toBe(h.sizes.length + h.badEmails.length + h.grades.length + h.noGuardianEmail.length + h.dupStudents.length + h.dupTeams.length + h.badIds.length + h.slots.length);
  });
  it('groups contacts by email', () => {
    const cs = contactsOf([team('t1', '01', { contactEmail: 'm@x.org', contactName: 'Mo' }), team('t2', '02', { contactEmail: 'M@x.org ', contactName: 'Mo' })]);
    expect(cs).toHaveLength(1);
    expect(cs[0].teams.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});
