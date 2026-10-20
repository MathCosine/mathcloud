/**
 * SFMO 2027 as a demo. Everything here is invented: teams, people, answers.
 *
 * Four moments can be loaded:
 *  - 'before': the week before. Registration is open, some waivers are
 *    missing, nobody has checked in, online students still have a device
 *    check to run.
 *  - 'morning': the Individual round has just opened. Online competitors are
 *    partway through; in-person papers have not been collected yet.
 *  - 'guts': Individual and Mystery Dive are done and keyed. Guts has been
 *    running for 22 minutes; teams in both divisions are handing in sets and
 *    the live board is moving.
 *  - 'after': every round is over, papers are keyed in, a few odd answers
 *    wait for a ruling, and results are ready to publish.
 */
import type { Activity, AgendaItem, Attempt, Competitor, Contest, DB, EmailTemplate, IntegrityEvent, Problem, Round, Team, User, Venue } from '../model';
import { splitEditions } from './editions';
import { GUTS, GUTS_POINTS, INDIVIDUAL, MYSTERY, type DemoProblem } from './problems';

export type Moment = 'before' | 'morning' | 'guts' | 'after';

// ------------------------------------------------------------------ random

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const iso = (d: Date) => d.toISOString();
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

// -------------------------------------------------------------------- teams

/** Where each online team sits, so their portal shows their own clock. */
const ZONES: Record<number, string> = {
  14: 'America/Los_Angeles', 15: 'Asia/Tashkent', 16: 'America/Chicago', 17: 'Europe/Bucharest',
  18: 'America/Toronto', 19: 'Asia/Singapore', 20: 'Asia/Almaty', 21: 'America/New_York',
};

type Seat = [name: string, grade: number, guardian: string, signed: 0 | 1];
type TeamSeed = {
  no: number; name: string; div: 'in_person' | 'online'; school: string; city: string; contact: string;
  status: Team['status']; reg: string; pledge: number | null; solo?: boolean; members: Seat[];
};

const TEAMS: TeamSeed[] = [
  { no: 1, name: 'Krill Seekers', div: 'in_person', school: 'Harborview High', city: 'San Francisco', contact: 'Grace Okafor', status: 'confirmed', reg: '2026-10-24T09:02', pledge: 40,
    members: [['Maya Okafor', 11, 'Grace Okafor', 1], ['Daniel Reyes', 11, 'Ana Reyes', 1], ['Ishaan Mehta', 10, 'Priya Mehta', 1], ['Lena Fischer', 10, 'Jonas Fischer', 1]] },
  { no: 2, name: 'Tidepool Theorems', div: 'in_person', school: 'Sunset Prep', city: 'San Francisco', contact: 'Owen Park', status: 'confirmed', reg: '2026-10-24T09:41', pledge: 40,
    members: [['Owen Park', 12, 'Min-ji Park', 1], ['Sofia Marín', 12, 'Lucía Marín', 1], ['Kai Nakamura', 11, 'Hiro Nakamura', 1], ['Ruth Abebe', 11, 'Selam Abebe', 1]] },
  { no: 3, name: 'Blue Tangents', div: 'in_person', school: 'Fogline Academy', city: 'Daly City', contact: 'Claire Laurent', status: 'pending', reg: '2026-10-26T18:20', pledge: null,
    members: [['Theo Laurent', 9, 'Claire Laurent', 1], ['Amara Diallo', 9, 'Fatou Diallo', 1], ['Ben Cohen', 8, 'Rachel Cohen', 0]] },
  { no: 4, name: 'The Benthics', div: 'in_person', school: 'Ocean Ave Middle', city: 'San Francisco', contact: 'Nora Lindqvist', status: 'confirmed', reg: '2026-10-27T16:05', pledge: 20,
    members: [['Nora Lindqvist', 8, 'Erik Lindqvist', 1], ['Arjun Rao', 8, 'Meera Rao', 1], ['Chloe Tran', 7, 'Linh Tran', 1], ['Felix Wong', 7, 'Karen Wong', 1]] },
  { no: 5, name: 'Coral Lemma', div: 'in_person', school: 'Twin Peaks High', city: 'San Francisco', contact: 'Hannah Kim', status: 'confirmed', reg: '2026-10-29T20:47', pledge: 40,
    members: [['Hannah Kim', 10, 'Joon Kim', 1], ['Mateo Silva', 10, 'Paula Silva', 1], ['Mei Lin', 9, 'Wei Lin', 0], ['Sam Whitaker', 9, 'Dana Whitaker', 1]] },
  { no: 6, name: 'Moon Jellies', div: 'in_person', school: 'Mission Bay High', city: 'San Francisco', contact: 'Zoe Adler', status: 'pending', reg: '2026-11-02T12:13', pledge: null,
    members: [['Zoe Adler', 11, 'Miriam Adler', 1], ['Rafael Costa', 11, 'Bruno Costa', 0]] },
  { no: 7, name: 'Bioluminati', div: 'in_person', school: 'Peninsula Math Circle', city: 'San Mateo', contact: 'Elena Petrova', status: 'confirmed', reg: '2026-11-03T08:30', pledge: 40,
    members: [['Elena Petrova', 12, 'Irina Petrova', 1], ['Jun-ho Choi', 12, 'Sun Choi', 1], ['Aisha Bello', 11, 'Tunde Bello', 1], ["Liam O'Brien", 11, "Siobhan O'Brien", 1]] },
  { no: 8, name: 'Pressure Drop', div: 'in_person', school: 'Homeschool', city: 'Oakland', contact: 'Ruth Feldman', status: 'confirmed', reg: '2026-11-04T19:55', pledge: 10, solo: true,
    members: [['Noah Feldman', 10, 'Ruth Feldman', 1]] },
  { no: 9, name: 'Rip Current', div: 'in_person', school: 'Stevens Creek High', city: 'Cupertino', contact: 'Ananya Iyer', status: 'confirmed', reg: '2026-11-05T21:10', pledge: 40,
    members: [['Ananya Iyer', 11, 'Lakshmi Iyer', 1], ['Lucas Moreau', 11, 'Anne Moreau', 1], ['Grace Liu', 10, 'Tao Liu', 0], ['Ethan Brooks', 10, 'Kim Brooks', 1]] },
  { no: 10, name: 'Abyssal Plain', div: 'in_person', school: 'Lakeview Prep', city: 'San Jose', contact: 'Diego Herrera', status: 'pending', reg: '2026-11-07T10:02', pledge: null,
    members: [['Diego Herrera', 9, 'Carmen Herrera', 1], ['Mira Shah', 9, 'Nikhil Shah', 0], ['Tom Becker', 9, 'Anja Becker', 0], ['Yuki Sato', 8, 'Emi Sato', 1]] },
  { no: 11, name: 'Hydrothermal', div: 'in_person', school: 'East Bay Math Club', city: 'Fremont', contact: 'Ravi Nair', status: 'confirmed', reg: '2026-11-08T14:44', pledge: 40,
    members: [['Ravi Nair', 12, 'Anil Nair', 1], ['Isabel Ortiz', 12, 'Marta Ortiz', 1], ['Henry Zhou', 11, 'Lei Zhou', 1], ['Leila Haddad', 11, 'Omar Haddad', 1]] },
  { no: 12, name: 'Siphonophores', div: 'in_person', school: 'Redwood Middle', city: 'Palo Alto', contact: 'Ari Goldberg', status: 'withdrawn', reg: '2026-11-09T17:26', pledge: null,
    members: [['Ari Goldberg', 8, 'Dina Goldberg', 1], ['Sana Qureshi', 8, 'Farah Qureshi', 1], ['Max Novak', 7, 'Petra Novak', 0]] },
  { no: 13, name: 'Mariana Trench Coats', div: 'in_person', school: 'Capitol Math Circle', city: 'Sacramento', contact: 'Caleb Morgan', status: 'confirmed', reg: '2026-11-11T09:18', pledge: 40,
    members: [['Caleb Morgan', 11, 'Jill Morgan', 1], ['Divya Pillai', 11, 'Rekha Pillai', 1], ['Oscar Lund', 10, 'Mats Lund', 1], ['Nina Hoffmann', 10, 'Uwe Hoffmann', 1]] },
  { no: 14, name: 'Polar Gyre', div: 'online', school: 'Northshore High', city: 'Seattle, WA', contact: 'Erik Johansson', status: 'confirmed', reg: '2026-11-12T22:40', pledge: 20,
    members: [['Erik Johansson', 12, 'Sara Johansson', 1], ['Maya Patel', 11, 'Raj Patel', 1], ['Leo Martin', 11, 'Julie Martin', 1], ['Ivy Chen', 10, 'Hong Chen', 1]] },
  { no: 15, name: 'Deep Field', div: 'online', school: 'Independent', city: 'Tashkent, Uzbekistan', contact: 'Timur Rakhimov', status: 'confirmed', reg: '2026-11-14T06:12', pledge: null,
    members: [['Timur Rakhimov', 11, 'Rustam Rakhimov', 1], ['Dilnoza Karimova', 11, 'Gulnora Karimova', 1], ['Aziz Yusupov', 10, 'Bekzod Yusupov', 1]] },
  { no: 16, name: 'Sea Urchin Sums', div: 'online', school: 'Barton Creek Middle', city: 'Austin, TX', contact: 'Megan Hughes', status: 'confirmed', reg: '2026-11-15T15:31', pledge: 40,
    members: [['Carter Hughes', 9, 'Megan Hughes', 1], ['Valeria Ruiz', 9, 'Andrea Ruiz', 1], ['Jacob Klein', 9, 'Miriam Klein', 0], ['Priya Das', 8, 'Sunil Das', 1]] },
  { no: 17, name: 'Thermocline', div: 'online', school: 'Colegiul Sf. Sava', city: 'Bucharest, Romania', contact: 'Andrei Popescu', status: 'confirmed', reg: '2026-11-16T11:03', pledge: null,
    members: [['Andrei Popescu', 12, 'Elena Popescu', 1], ['Ioana Ionescu', 12, 'Mihai Ionescu', 1], ['Mihai Stan', 11, 'Cristina Stan', 1], ['Ana Dumitru', 11, 'Victor Dumitru', 1]] },
  { no: 18, name: 'Kelp Vectors', div: 'online', school: 'Bloor Collegiate', city: 'Toronto, Canada', contact: 'Ethan Lam', status: 'pending', reg: '2026-11-18T10:16', pledge: null,
    members: [['Ethan Lam', 10, 'Wendy Lam', 1], ['Clara Dubois', 10, 'Luc Dubois', 1]] },
  { no: 19, name: 'Lanternfish', div: 'online', school: 'Raffles Math Society', city: 'Singapore', contact: 'Wei Jie Tan', status: 'confirmed', reg: '2026-11-19T07:45', pledge: 20,
    members: [['Wei Jie Tan', 11, 'Mei Ling Tan', 1], ['Arun Pillai', 11, 'Kavitha Pillai', 1], ['Sarah Goh', 10, 'David Goh', 1], ['Ryan Lim', 10, 'Jenny Lim', 1]] },
  { no: 20, name: 'Brine Pool', div: 'online', school: 'NIS Physics and Mathematics', city: 'Almaty, Kazakhstan', contact: 'Aruzhan Bekova', status: 'confirmed', reg: '2026-11-20T04:30', pledge: null,
    members: [['Aruzhan Bekova', 12, 'Saule Bekova', 1], ['Daniyar Seitkali', 12, 'Nurlan Seitkali', 1], ['Madina Omarova', 11, 'Gulmira Omarova', 1]] },
  { no: 21, name: 'Gulf Stream', div: 'online', school: 'Brookline Math Team', city: 'Boston, MA', contact: 'Megan Hughes', status: 'confirmed', reg: '2026-11-21T16:12', pledge: 40,
    members: [['Nathan Shapiro', 10, 'Laura Shapiro', 1], ['Emma Walsh', 10, 'Kevin Walsh', 1], ['Jonah Park', 9, 'Grace Park', 1], ['Lily Chen', 9, 'Ming Chen', 1]] },
];

export const DEMO_PASSWORD = 'demo';
/** The demo student's team, which the simulation leaves alone. */
export const DEMO_TEAM = 't16';

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
}

function toProblems(list: DemoProblem[], prefix: string, points: (i: number) => number, set?: (i: number) => number): Problem[] {
  return list.map((p, i) => ({
    id: `${prefix}${i + 1}`,
    number: i + 1,
    set: set?.(i),
    text: p.text,
    answers: p.answers,
    answerType: p.type ?? 'integer',
    points: points(i),
  }));
}

const DEMO_BY_ID: Record<string, DemoProblem> = {};
INDIVIDUAL.forEach((p, i) => (DEMO_BY_ID[`ind${i + 1}`] = p));
MYSTERY.forEach((p, i) => (DEMO_BY_ID[`myst${i + 1}`] = p));
GUTS.flat().forEach((p, i) => (DEMO_BY_ID[`guts${i + 1}`] = p));

function rounds(now: Date, moment: Moment): Round[] {
  const ind: Round = {
    id: 'ind', name: 'Individual', short: 'Individual', kind: 'individual', minutes: 60,
    startsAt: '2027-01-23T09:20:00-08:00', status: 'scheduled', graceSeconds: 30,
    integrity: { policy: 'warn', lockAfter: 4 },
    rules: 'Twenty short-answer problems, climbing in difficulty. Work alone. No calculators, notes or other tabs. Exact answers: integers, or fractions in lowest terms.',
    problems: toProblems(INDIVIDUAL, 'ind', () => 1),
  };
  const myst: Round = {
    id: 'myst', name: 'Mystery Dive', short: 'Mystery', kind: 'team', minutes: 45, mystery: true,
    startsAt: '2027-01-23T10:35:00-08:00', status: 'scheduled', graceSeconds: 30,
    integrity: { policy: 'warn', lockAfter: 4 },
    rules: 'A team round. One answer sheet for the whole team; anyone on the team can fill in any box, and everyone sees the latest answer.',
    problems: toProblems(MYSTERY, 'myst', () => 5),
  };
  const guts: Round = {
    id: 'guts', name: 'Guts', short: 'Guts', kind: 'guts', minutes: 60,
    startsAt: '2027-01-23T12:00:00-08:00', status: 'scheduled', graceSeconds: 30,
    integrity: { policy: 'log', lockAfter: 6 },
    rules: 'Six sets of four. Hand in a set to get the next one; you cannot go back. Later sets are worth more.',
    problems: toProblems(GUTS.flat(), 'guts', (i) => GUTS_POINTS[Math.floor(i / 4)], (i) => Math.floor(i / 4) + 1),
  };
  if (moment === 'before') {
    // Everything still scheduled.
  } else if (moment === 'morning') {
    ind.status = 'open';
    ind.openedAt = iso(minutes(now, -8));
  } else if (moment === 'guts') {
    ind.status = 'closed'; ind.openedAt = iso(minutes(now, -190));
    myst.status = 'closed'; myst.openedAt = iso(minutes(now, -112));
    guts.status = 'open'; guts.openedAt = iso(minutes(now, -22));
  } else {
    ind.status = 'closed'; ind.openedAt = iso(minutes(now, -300));
    myst.status = 'closed'; myst.openedAt = iso(minutes(now, -215));
    guts.status = 'closed'; guts.openedAt = iso(minutes(now, -130));
  }
  return [ind, myst, guts];
}

// ---------------------------------------------------------------- answers

function answerFor(r: () => number, p: Problem, correct: boolean, blankChance: number): string | null {
  const demo = DEMO_BY_ID[p.id];
  if (correct) {
    if (demo.alt && r() < 0.3) return pick(r, demo.alt);
    return p.answers[0].replace(/^\\frac\{(\d+)\}\{(\d+)\}$/, '$1/$2');
  }
  if (r() < blankChance) return null;
  if (demo.wrong && r() < 0.75) return pick(r, demo.wrong);
  const key = Number(p.answers[0]);
  if (Number.isFinite(key)) return String(key + pick(r, [-2, -1, 1, 2, 10]));
  return pick(r, ['1/3', '5/8', '1']);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function fill(
  attempt: Attempt, round: Round, skill: number, r: () => number, by: string, at: Date,
  upTo = round.problems.length,
) {
  round.problems.slice(0, upTo).forEach((p, i) => {
    const d = round.kind === 'guts' ? -2.4 + (p.set! - 1) * 0.6 + (i % 4) * 0.12 : round.kind === 'team' ? -1.6 + i * 0.5 : -2.3 + i * 0.24;
    const v = answerFor(r, p, r() < sigmoid(1.5 * (skill - d)), 0.08 + i * (round.kind === 'individual' ? 0.025 : 0.04));
    if (v !== null) attempt.responses[p.id] = { value: v, savedAt: iso(minutes(at, i * 2.4 + r())), by };
  });
}

function events(r: () => number, start: Date, count: number): IntegrityEvent[] {
  const out: IntegrityEvent[] = [];
  for (let i = 0; i < count; i++) {
    const kind = pick(r, ['hidden', 'hidden', 'blur', 'blur', 'fullscreen_exit', 'resize'] as const);
    out.push({ at: iso(minutes(start, 3 + r() * 50)), kind, ms: Math.round(1500 + r() * 14000) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ------------------------------------------------------------- the venue

/** In-person teams sit four to a room for the Individual and Mystery rounds. */
function VENUE(teams: Team[]): Venue {
  const here = teams.filter((t) => t.divisionId === 'in_person').map((t) => t.id);
  return {
    name: 'Embarcadero Learning Center',
    address: '500 Embarcadero, San Francisco',
    hall: 'Main Hall',
    rooms: [
      { id: 'v204', name: 'Room 204', teamIds: here.slice(0, 4) },
      { id: 'v205', name: 'Room 205', teamIds: here.slice(4, 8) },
      { id: 'v206', name: 'Room 206', teamIds: here.slice(8) },
    ],
    bring: ['Pencils and an eraser', 'A water bottle', 'Nothing else: no calculators, and phones stay in bags during rounds'],
  };
}

const at = (hhmm: string) => `2027-01-23T${hhmm}:00-08:00`;
const AGENDA: AgendaItem[] = [
  { id: 'ag-checkin', at: at('08:30'), title: 'Check-in', modes: ['in_person'], where: 'Lobby', note: 'Give your competitor ID at the desk and pick up your badge.' },
  { id: 'ag-zoom', at: at('09:00'), title: 'Join your Zoom room', modes: ['online'], note: 'Camera on, showing you and your desk. Your proctor checks everyone in.' },
  { id: 'ag-open', at: at('09:00'), title: 'Opening', modes: ['in_person'], where: 'hall' },
  { id: 'ag-ind', at: at('09:20'), title: 'Individual', roundId: 'ind', modes: ['in_person', 'online'], where: 'room' },
  { id: 'ag-myst', at: at('10:35'), title: 'Mystery Dive', roundId: 'myst', modes: ['in_person', 'online'], where: 'room' },
  { id: 'ag-lunch', at: at('11:20'), title: 'Lunch', modes: ['in_person'], where: 'hall', note: 'Provided. Allergies go on the registration form.' },
  { id: 'ag-break', at: at('11:20'), title: 'Break', modes: ['online'], note: 'Back on Zoom by 11:50 San Francisco time.' },
  { id: 'ag-guts', at: at('12:00'), title: 'Guts', roundId: 'guts', modes: ['in_person', 'online'], where: 'hall', note: 'The live scoreboard is on the big screen, and beside your questions online.' },
  { id: 'ag-awards', at: at('14:00'), title: 'Awards', modes: ['in_person'], where: 'hall' },
  { id: 'ag-awards-online', at: at('14:00'), title: 'Awards', modes: ['online'], note: 'Streamed into every Zoom room.' },
];

// ------------------------------------------------------------------ build

/** SFMO 2027 as it really runs: two linked contests, in person and online, at the same time. */
export function buildDemo(moment: Moment, now = new Date()): DB {
  return splitEditions(buildOneContest(moment, now));
}

function buildOneContest(moment: Moment, now: Date): DB {
  const contestId = 'sfmo-2027';
  const teams: Team[] = [];
  const competitors: Competitor[] = [];
  const activity: Activity[] = [];
  const skills = new Map<string, number>();

  for (const t of TEAMS) {
    const code = String(t.no).padStart(2, '0');
    const id = `t${code}`;
    const team: Team = {
      id, contestId, code, name: t.name, divisionId: t.div, school: t.school, city: t.city,
      contactName: t.contact, contactEmail: `${slug(t.contact)}@example.com`, status: t.status,
      registeredAt: new Date(t.reg).toISOString(), joinCode: `SF${code}${'QRTVXZ'[t.no % 6]}${(t.no * 7) % 10}`,
      pledge: t.pledge, wantsTeammates: t.solo, timeZone: ZONES[t.no],
      coachId: t.no === 16 || t.no === 21 ? 'u-coach' : undefined,
    };
    teams.push(team);
    const reg = new Date(t.reg);
    activity.push({ id: `a-${id}-r`, teamId: id, at: iso(reg), text: `Registered by ${t.contact}`, tone: 'b' });
    activity.push({ id: `a-${id}-c`, teamId: id, at: iso(minutes(reg, 1)), text: `Confirmation emailed to ${team.contactEmail}`, tone: 'g' });
    if (t.status === 'confirmed') activity.push({ id: `a-${id}-ok`, teamId: id, at: iso(minutes(reg, 60 * 26)), text: 'Confirmed by Jordan Lee', tone: 'g' });
    if (t.status === 'withdrawn') activity.push({ id: `a-${id}-w`, teamId: id, at: '2026-11-15T21:22:00.000Z', text: 'Withdrawn at the contact’s request', tone: '' });
    t.members.forEach(([name, grade, guardian, signed], i) => {
      const slot = 'ABCD'[i];
      const c: Competitor = {
        id: `c${code}${slot}`, teamId: id, slot, publicId: `${code}${slot}`, name, grade,
        guardianName: guardian, guardianEmail: `${slug(guardian)}@example.com`,
        waiverSignedAt: signed ? iso(minutes(reg, 90 + i * 211)) : null,
        checkedInAt: (moment === 'guts' || moment === 'after') && t.div === 'in_person' && t.status !== 'withdrawn' ? iso(minutes(now, moment === 'guts' ? -220 : -330)) : null,
        // The demo student has not run the device check yet the week before.
        deviceCheckedAt: t.div === 'online' && (moment !== 'before' || (t.no !== 16 && i < 3)) ? iso(minutes(reg, 60 * 24 * 30 + i * 97)) : null,
      };
      competitors.push(c);
      const r = rng(c.publicId);
      const strong = t.no === 19 || t.no === 7 || t.no === 2 ? 0.7 : t.no === 4 || t.no === 6 ? -0.5 : 0;
      skills.set(c.id, (grade - 10) * 0.35 + strong + normal(r) * 0.85);
      if (signed) activity.push({ id: `a-${c.id}-w`, teamId: id, at: c.waiverSignedAt!, text: `Waiver for ${c.publicId} signed by ${guardian}`, tone: 'g' });
      else if (t.status !== 'withdrawn') activity.push({ id: `a-${c.id}-rem`, teamId: id, at: '2026-11-25T17:00:00.000Z', text: `Waiver reminder sent to ${guardian}`, tone: 'a' });
    });
  }

  if (moment === 'guts' || moment === 'after') {
    // Anyone still missing a waiver signed it at check-in or before the first round.
    for (const c of competitors) {
      const t = teams.find((x) => x.id === c.teamId)!;
      if (!c.waiverSignedAt && t.status !== 'withdrawn') c.waiverSignedAt = iso(minutes(now, -340));
    }
  }

  const contestRounds = rounds(now, moment);
  const [ind, myst, guts] = contestRounds;
  const attempts: Attempt[] = [];
  const live = (t: Team) => t.status !== 'withdrawn';
  const teamSkill = (t: Team) => {
    const ms = competitors.filter((c) => c.teamId === t.id).map((c) => skills.get(c.id)!);
    return ms.reduce((a, b) => a + b, 0) / ms.length + 0.5 + Math.min(ms.length, 4) * 0.08;
  };

  if (moment === 'before') {
    // Nothing has happened yet.
  } else if (moment === 'morning') {
    // Online competitors partway through the Individual round, except the
    // demo student's own team, who have not started.
    const opened = new Date(ind.openedAt!);
    for (const c of competitors) {
      const t = teams.find((x) => x.id === c.teamId)!;
      if (t.divisionId !== 'online' || !live(t) || t.code === '16') continue;
      const r = rng(`m-${c.publicId}`);
      const started = minutes(opened, r() * 1.5);
      const a: Attempt = {
        id: `ind:${c.id}`, roundId: 'ind', entrantId: c.id, source: 'online', startedAt: iso(started),
        deadline: iso(minutes(opened, ind.minutes)), responses: {}, events: r() < 0.4 ? events(r, started, 1).map((e) => ({ ...e, at: iso(minutes(started, 1 + r() * 5)) })) : [],
        honorName: c.name,
      };
      fill(a, ind, skills.get(c.id)!, r, `u-${c.id}`, started, 2 + Math.floor(r() * 5));
      attempts.push(a);
    }
  } else {
    for (const c of competitors) {
      const t = teams.find((x) => x.id === c.teamId)!;
      if (!live(t)) continue;
      const r = rng(`a-${c.publicId}`);
      const online = t.divisionId === 'online';
      const start = minutes(new Date(ind.openedAt!), online ? r() * 1.5 : 0);
      const a: Attempt = {
        id: `ind:${c.id}`, roundId: 'ind', entrantId: c.id, source: online ? 'online' : 'paper',
        responses: {},
        events: online ? events(r, start, r() < 0.55 ? Math.floor(r() * 3) : 0) : [],
        ...(online
          ? { startedAt: iso(start), deadline: iso(minutes(new Date(ind.openedAt!), ind.minutes)), submittedAt: iso(minutes(start, 52 + r() * 8)), honorName: c.name }
          : { submittedAt: iso(minutes(start, 60)) }),
      };
      fill(a, ind, skills.get(c.id)!, r, online ? `u-${c.id}` : 'u-grader', online ? start : minutes(start, 70));
      attempts.push(a);
    }
    // Two online students who share rare wrong answers.
    for (const cid of ['c17B', 'c19C']) {
      const a = attempts.find((x) => x.entrantId === cid)!;
      for (const [pid, v] of [['ind11', '26'], ['ind14', '44'], ['ind18', '54']]) a.responses[pid] = { value: v, savedAt: a.startedAt!, by: `u-${cid}` };
    }
    const flagged = attempts.find((x) => x.entrantId === 'c19C')!;
    const s = new Date(flagged.startedAt!);
    flagged.events = [
      { at: iso(minutes(s, 6)), kind: 'hidden', ms: 9200 },
      { at: iso(minutes(s, 14)), kind: 'hidden', ms: 41800 },
      { at: iso(minutes(s, 14.8)), kind: 'warned' },
      { at: iso(minutes(s, 22)), kind: 'blur', ms: 6400 },
      { at: iso(minutes(s, 31)), kind: 'hidden', ms: 95100 },
      { at: iso(minutes(s, 32.7)), kind: 'locked' },
      { at: iso(minutes(s, 35)), kind: 'unlocked', by: 'Priya Nand' },
    ];
    attempts.find((x) => x.entrantId === 'c17B')!.events.push({ at: iso(minutes(s, 18)), kind: 'paste' });

    for (const t of teams.filter(live)) {
      const r = rng(`team-${t.code}`);
      const online = t.divisionId === 'online';
      const start = new Date(myst.openedAt!);
      const a: Attempt = {
        id: `myst:${t.id}`, roundId: 'myst', entrantId: t.id, source: online ? 'online' : 'paper', responses: {},
        events: online ? events(r, start, Math.floor(r() * 2)) : [],
        ...(online ? { startedAt: iso(start), deadline: iso(minutes(start, myst.minutes)), submittedAt: iso(minutes(start, myst.minutes - r() * 4)) } : { submittedAt: iso(minutes(start, myst.minutes)) }),
      };
      fill(a, myst, teamSkill(t), r, online ? `u-c${t.code}A` : 'u-grader', minutes(start, 5));
      attempts.push(a);

      // Guts: every set handed in after the contest; partway through during it.
      // The demo student's team has not started, so you can start it yourself.
      if (moment === 'guts' && t.id === DEMO_TEAM) continue;
      const opened = new Date(guts.openedAt!);
      const sets = moment === 'after' ? 6 : 1 + Math.floor(r() * 3);
      const gap = moment === 'after' ? 9.4 : 6.2;
      const setTimes = Array.from({ length: sets }, (_, i) => iso(minutes(opened, (i + 1) * gap - r() * 2)));
      const g: Attempt = {
        id: `guts:${t.id}`, roundId: 'guts', entrantId: t.id, source: online ? 'online' : 'paper', responses: {},
        events: online && moment === 'after' ? events(r, opened, Math.floor(r() * 2)) : [],
        setsSubmitted: sets, setTimes,
        ...(online ? { startedAt: iso(opened), deadline: iso(minutes(opened, guts.minutes)) } : {}),
        ...(sets === 6 ? { submittedAt: setTimes[5] } : {}),
      };
      fill(g, guts, teamSkill(t), r, online ? `u-c${t.code}A` : 'u-grader', minutes(opened, 2), sets * 4);
      attempts.push(g);
    }
  }

  const contest: Contest = {
    id: contestId, orgId: 'sfmi', name: 'San Francisco Math Open 2027', short: 'SFMO 2027', slug: 'sfmo-2027',
    dateLabel: 'Saturday 23 January 2027',
    timeZone: 'America/Los_Angeles',
    divisions: [
      { id: 'in_person', name: 'In person', mode: 'in_person', detail: 'San Francisco' },
      { id: 'online', name: 'Online', mode: 'online', detail: 'Teams more than 100 miles from the Bay Area, same time, on Zoom' },
    ],
    rounds: contestRounds,
    recipe: {
      teamIndividual: { method: 'best', best: 3, fillMissingTo: 0 },
      weights: { ind: 2, myst: 1, guts: 1 },
      harderFirst: true,
      awards: [
        { id: 'i1', scope: 'individual', label: '1st', rule: 'top_n', value: 1 },
        { id: 'i2', scope: 'individual', label: '2nd', rule: 'top_n', value: 2 },
        { id: 'i3', scope: 'individual', label: '3rd', rule: 'top_n', value: 3 },
        { id: 'i4', scope: 'individual', label: 'Distinguished HM', rule: 'top_percent', value: 25 },
        { id: 'i5', scope: 'individual', label: 'Honorable Mention', rule: 'top_percent', value: 50 },
        { id: 't1', scope: 'team', label: '1st', rule: 'top_n', value: 1 },
        { id: 't2', scope: 'team', label: '2nd', rule: 'top_n', value: 2 },
        { id: 't3', scope: 'team', label: '3rd', rule: 'top_n', value: 3 },
      ],
    },
    venue: VENUE(teams),
    agenda: AGENDA,
    rooms: [
      { id: 'room-1', name: 'Room 1', url: 'https://zoom.us/j/85550101234', proctorId: 'u-proctor', teamIds: ['t14', 't15', 't16', 't17'] },
      { id: 'room-2', name: 'Room 2', url: 'https://zoom.us/j/85550105678', proctorId: 'u-director', teamIds: ['t18', 't19', 't20', 't21'] },
    ],
    resultsPublished: false,
    board: { freezeMinutes: 10, revealed: false },
    registration: { open: moment === 'before', closesLabel: '9 Jan', teamMin: 1, teamMax: 4 },
  };

  const users: User[] = [
    { id: 'u-director', email: 'director@sfmo.demo', name: 'Jordan Lee', role: 'director', password: DEMO_PASSWORD },
    { id: 'u-grader', email: 'grader@sfmo.demo', name: 'Sam Ortega', role: 'grader', password: DEMO_PASSWORD, roundIds: ['ind', 'myst', 'guts'] },
    { id: 'u-proctor', email: 'proctor@sfmo.demo', name: 'Priya Nand', role: 'proctor', password: DEMO_PASSWORD, roomId: 'room-1' },
    { id: 'u-coach', email: 'coach@sfmo.demo', name: 'Megan Hughes', role: 'coach', password: DEMO_PASSWORD, teamIds: ['t16', 't21'] },
    { id: 'u-c16A', email: 'student@sfmo.demo', name: 'Carter Hughes', role: 'student', password: DEMO_PASSWORD, competitorId: 'c16A' },
    { id: 'u-c05A', email: 'sfmo-05a', name: 'Hannah Kim', role: 'student', password: DEMO_PASSWORD, competitorId: 'c05A', managed: true },
  ];

  const templates: EmailTemplate[] = [
    {
      id: 'tpl-confirm', name: 'Registration confirmation', trigger: 'registered', audience: 'contacts',
      subject: 'You are registered for {{contest.name}}: team {{team.code}}',
      body: `Hi {{contact.first_name}},

{{team.name}} is registered for {{contest.name}} on {{contest.date}}.

Your team code is {{team.code}}. Competitor IDs:
{{#each members}}  {{id}}  {{name}}
{{/each}}
{{#if division == "online"}}You are in the online division. Each competitor gets their own sign-in and a Zoom room a week before the contest.
{{/if}}{{#if division == "in_person"}}Bring pencils. Check-in opens at 9:00.
{{/if}}
Questions? Reply to this email.

SF Math Initiative`,
    },
    {
      id: 'tpl-waiver', name: 'Waiver reminder', trigger: 'waiver_missing', audience: 'guardians',
      subject: 'Please sign the waiver for {{competitor.name}}',
      body: `Hello {{guardian.name}},

{{competitor.name}} ({{competitor.id}}) is registered for {{contest.name}}, but we do not have a signed waiver yet. Nobody competes without one.

Sign here, it takes a minute: {{waiver_link}}

SF Math Initiative`,
    },
    {
      id: 'tpl-online', name: 'Online division: your test day', trigger: 'before_contest', audience: 'students',
      subject: '{{contest.name}} on Saturday: your sign-in and Zoom room',
      body: `Hi {{competitor.first_name}},

Saturday's rounds start at 9:20 Pacific, the same moment as the room in San Francisco.

1. Sign in at {{portal_link}} with {{competitor.login}}.
2. Join {{zoom.room}} at 9:00: {{zoom.link}}
   Camera on, showing you and your desk.
3. Run the device check before Saturday.

Good luck,
SF Math Initiative`,
    },
    {
      id: 'tpl-results', name: 'Results and certificate', trigger: 'results', audience: 'students',
      subject: 'Your {{contest.name}} results',
      body: `Hi {{competitor.first_name}},

You scored {{score.individual}} on the Individual round, placing {{place.individual}} in the {{division.name}} division.
{{#if award}}You earned {{award}}. Your certificate is attached.
{{/if}}
Your full score report: {{report_link}}

Thank you for diving with us.
SF Math Initiative`,
    },
  ];

  return {
    schema: 5,
    gen: `${moment}-${now.getTime()}`,
    moment,
    seededAt: now.toISOString(),
    orgs: [{ id: 'sfmi', name: 'SF Math Initiative', short: 'SF', emailProvider: { kind: 'resend', from: 'SFMO 2027 <registration@sfmathopen.org>', dailyLimit: 100 } }],
    users,
    contests: [contest],
    teams,
    competitors,
    attempts,
    rulings:
      moment === 'after'
        ? [{ roundId: 'ind', problemId: 'ind7', normalized: '0.375', correct: true, by: 'u-director', at: iso(minutes(now, -40)) }]
        : [],
    clarifications: [
      { id: 'cl-1', roundId: 'ind', question: 'Problem 11: is x a real number?', answer: 'Yes. In problem 11, x is a nonzero real number.', broadcast: true, at: iso(minutes(now, moment === 'morning' ? -4 : -280)), answeredAt: iso(minutes(now, moment === 'morning' ? -3 : -279)) },
      ...(moment === 'morning'
        ? [{ id: 'cl-2', roundId: 'ind', fromCompetitorId: 'c14B', question: 'For problem 9, do you want the area in square units?', broadcast: false, at: iso(minutes(now, -1)) }]
        : []),
    ],
    templates,
    sends: [],
    activity,
  };
}
