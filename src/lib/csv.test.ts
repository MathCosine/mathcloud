import { describe, expect, it } from 'vitest';
import { buildPlan, guessMapping, parseCsv, readMode, SAMPLE_CSV } from './csv';

const opts = { defaultMode: null, offered: ['in_person', 'online'] as ('in_person' | 'online')[], existingNames: ['Krill Seekers'], teamMax: 4 };

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, newlines in quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n\r\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'line\nbreak']]);
  });
  it('reads tab- and semicolon-separated files', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('readMode', () => {
  it('reads the usual ways people write it', () => {
    expect(readMode('Online (Zoom)')).toBe('online');
    expect(readMode('virtual')).toBe('online');
    expect(readMode('In-person in SF')).toBe('in_person');
    expect(readMode('on site')).toBe('in_person');
    expect(readMode('Not sure yet')).toBeNull();
  });
});

describe('the Google Form sample', () => {
  const rows = parseCsv(SAMPLE_CSV);
  const map = guessMapping(rows[0]);
  const plan = buildPlan(rows, map, opts);

  it('finds the team columns and four numbered students', () => {
    expect(map.shape).toBe('wide');
    expect(rows[0][map.team.team!]).toBe('Team name');
    expect(rows[0][map.team.mode!]).toBe('How will your team compete?');
    expect(rows[0][map.team.contactEmail!]).toBe('Coach email');
    expect(rows[0][map.team.contactName!]).toBe('Coach name');
    expect(map.students).toHaveLength(4);
    expect(rows[0][map.students[1].guardianEmail!]).toBe('Student 2 parent email');
  });

  it('plans each team with its mode, and says plainly what is wrong', () => {
    const by = Object.fromEntries(plan.map((t) => [t.name, t]));
    expect(by['Angle Fish'].mode).toBe('in_person');
    expect(by['Angle Fish'].students).toHaveLength(4);
    expect(by['Angle Fish'].errors).toEqual([]);
    expect(by['Pi Rates'].mode).toBe('online');
    expect(by['Pi Rates'].warnings[0]).toMatch(/1 without a guardian email/);
    expect(by['Prime Tide'].errors[0]).toMatch(/not an email address/);
    // Already registered: left to dedupeTeams, which offers skip or update instead of an error.
    expect(by['Krill Seekers'].errors).toEqual([]);
    expect(by['Eigen Eels'].errors[0]).toMatch(/Cannot tell/);
  });

  it('uses a default mode when one is given', () => {
    const p = buildPlan(rows, map, { ...opts, defaultMode: 'in_person' });
    const eels = p.find((t) => t.name === 'Eigen Eels')!;
    expect(eels.errors).toEqual([]);
    expect(eels.mode).toBe('in_person');
    expect(eels.warnings[0]).toMatch(/read as in person/);
  });
});

describe('a contest that runs one way', () => {
  it('brings every team in that way, and says when the file disagreed', () => {
    const rows = parseCsv(SAMPLE_CSV);
    const plan = buildPlan(rows, guessMapping(rows[0]), { ...opts, offered: ['online'] });
    const angle = plan.find((t) => t.name === 'Angle Fish')!;
    expect(angle.mode).toBe('online');
    expect(angle.errors).toEqual([]);
    expect(angle.warnings[0]).toMatch(/comes in online/);
    expect(plan.find((t) => t.name === 'Eigen Eels')!.errors).toEqual([]);
  });
});

describe('one row per student', () => {
  it('groups rows into teams by name', () => {
    const rows = parseCsv(['Team,Format,Contact email,Student,Grade,Parent email', 'Sine Waves,online,a@b.co,Ann,9,p@q.co', 'Sine Waves,online,a@b.co,Bo,10,r@s.co', 'Tangent Club,in person,c@d.co,Cy,8,t@u.co'].join('\n'));
    const map = guessMapping(rows[0]);
    expect(map.shape).toBe('long');
    const plan = buildPlan(rows, map, opts);
    expect(plan.map((t) => [t.name, t.mode, t.students.length, t.rows])).toEqual([
      ['Sine Waves', 'online', 2, [2, 3]],
      ['Tangent Club', 'in_person', 1, [4]],
    ]);
  });
});

import { readYes } from './csv';

describe('carrying data over from an old sign-up', () => {
  it('reads waiver columns the way people fill them in', () => {
    for (const v of ['Yes', 'signed', 'TRUE', 'x', '✓', '12/03/2026', 'Signed by mom', 'received']) expect(readYes(v)).toBe(true);
    for (const v of ['', 'No', 'pending', 'false', 'not yet', '-']) expect(readYes(v)).toBe(false);
  });

  it('keeps team numbers, old IDs and waiver answers from the file', () => {
    const rows = parseCsv([
      'Team #,Team name,Contact email,Student 1 name,Student 1 waiver,Student 1 ID,Student 2 name,Student 2 waiver',
      '7,Angle Fish,a@example.com,Iris,Yes,S-001,Leo,',
    ].join('\n'));
    const map = guessMapping(rows[0]);
    expect(map.team.code).toBe(0);
    const [t] = buildPlan(rows, map, { defaultMode: 'in_person', offered: ['in_person'], teamMax: 4 });
    expect(t.code).toBe('7');
    expect(t.students[0]).toMatchObject({ name: 'Iris', fileWaiver: true, externalId: 'S-001' });
    expect(t.students[1]).toMatchObject({ name: 'Leo', fileWaiver: false });
  });
});
