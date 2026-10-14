/**
 * Roster health: the checks behind People → ID check. Pure functions over
 * teams and students, so they can be tested without a database and run on
 * every render (a contest is a few hundred rows).
 */
import type { Competitor, Contest, Team } from './model';

/** "  José  O'Neil-Smith " → "jose o neil smith". Accents, case, punctuation and spacing do not make a different person. */
export const normName = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const normEmail = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

const EMAIL_RE = /^[^@\s,;<>()]+@[^@\s,;<>()]+\.[a-z]{2,}$/i;
export const isEmail = (s: string | null | undefined) => EMAIL_RE.test((s ?? '').trim());

export const GRADE_MIN = 1;
export const GRADE_MAX = 12;
export const SLOTS = 'ABCDEFGH';

// ------------------------------------------------------------- duplicates

export type DupStudent = {
  keep: Competitor;
  drop: Competitor;
  /** Same team, or same guardian email: almost surely one child entered twice. Same name only: maybe two children. */
  why: 'same_team' | 'same_guardian' | 'same_name';
  exact: boolean;
};

/**
 * Which of two records of the same student to keep: the one with a signed
 * waiver, then the one checked in, then the one on a live team, then the older.
 */
export function keeperOf(a: Competitor, b: Competitor, teams: Map<string, Team>): [Competitor, Competitor] {
  const score = (c: Competitor) => {
    const t = teams.get(c.teamId);
    return [c.waiverSignedAt ? 0 : 1, c.checkedInAt ? 0 : 1, t && t.status !== 'withdrawn' ? 0 : 1, t?.registeredAt ?? '9999', c.publicId] as const;
  };
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] < sb[i]) return [a, b];
    if (sa[i] > sb[i]) return [b, a];
  }
  return [a, b];
}

export function duplicateStudents(teams: Team[], competitors: Competitor[]): DupStudent[] {
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const groups = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const k = normName(c.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out: DupStudent[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Pair every record with the best one in its group.
    const best = group.reduce((a, b) => keeperOf(a, b, byTeam)[0]);
    for (const c of group) {
      if (c === best) continue;
      const why: DupStudent['why'] =
        c.teamId === best.teamId ? 'same_team' : normEmail(c.guardianEmail) && normEmail(c.guardianEmail) === normEmail(best.guardianEmail) ? 'same_guardian' : 'same_name';
      out.push({ keep: best, drop: c, why, exact: why !== 'same_name' });
    }
  }
  return out.sort((a, b) => a.keep.publicId.localeCompare(b.keep.publicId));
}

export type DupTeam = { keep: Team; drop: Team; why: 'same_name' | 'same_contact' };

export function duplicateTeams(teams: Team[]): DupTeam[] {
  const sorted = teams.slice().sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.code.localeCompare(b.code));
  const out: DupTeam[] = [];
  const paired = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (paired.has(b.id)) continue;
      const sameName = normName(a.name) && normName(a.name) === normName(b.name);
      const sameContact = normEmail(a.contactEmail) && normEmail(a.contactEmail) === normEmail(b.contactEmail) && normName(a.school) === normName(b.school);
      if (sameName || sameContact) {
        out.push({ keep: a, drop: b, why: sameName ? 'same_name' : 'same_contact' });
        paired.add(b.id);
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------- IDs

export type BadId = { c: Competitor; expected: string };

/** A student's ID is the team code and their letter: 07 + B = 07B. */
export function badIds(teams: Team[], competitors: Competitor[]): BadId[] {
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const out: BadId[] = [];
  for (const c of competitors) {
    const t = byTeam.get(c.teamId);
    if (!t) continue;
    const expected = `${t.code}${c.slot}`;
    if (c.publicId !== expected) out.push({ c, expected });
  }
  return out;
}

export type SlotIssue =
  | { kind: 'collision'; team: Team; slot: string; students: Competitor[] }
  | { kind: 'gap'; team: Team; missing: string[] }
  | { kind: 'id_taken'; publicId: string; students: Competitor[] }
  | { kind: 'code_taken'; code: string; teams: Team[] };

export function slotIssues(teams: Team[], competitors: Competitor[]): SlotIssue[] {
  const out: SlotIssue[] = [];
  for (const t of teams) {
    const members = competitors.filter((c) => c.teamId === t.id);
    const bySlot = new Map<string, Competitor[]>();
    for (const c of members) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
    for (const [slot, list] of bySlot) if (list.length > 1) out.push({ kind: 'collision', team: t, slot, students: list });
    const used = [...bySlot.keys()].map((s) => SLOTS.indexOf(s)).filter((i) => i >= 0);
    if (used.length) {
      const top = Math.max(...used);
      const missing = SLOTS.slice(0, top + 1).split('').filter((s) => !bySlot.has(s));
      if (missing.length) out.push({ kind: 'gap', team: t, missing });
    }
  }
  const byId = new Map<string, Competitor[]>();
  for (const c of competitors) byId.set(c.publicId, [...(byId.get(c.publicId) ?? []), c]);
  for (const [publicId, list] of byId) {
    // Already reported as a slot collision when they share a team.
    if (list.length > 1 && new Set(list.map((c) => c.teamId)).size > 1) out.push({ kind: 'id_taken', publicId, students: list });
  }
  const byCode = new Map<string, Team[]>();
  for (const t of teams) byCode.set(t.code, [...(byCode.get(t.code) ?? []), t]);
  for (const [code, list] of byCode) if (list.length > 1) out.push({ kind: 'code_taken', code, teams: list });
  return out;
}

/** The next free letter on a team, or null when it is full. */
export function freeSlot(teamId: string, competitors: Competitor[], teamMax: number): string | null {
  const taken = new Set(competitors.filter((c) => c.teamId === teamId).map((c) => c.slot));
  return SLOTS.slice(0, Math.max(1, teamMax)).split('').find((s) => !taken.has(s)) ?? null;
}

// ----------------------------------------------------------------- sizes

export type SizeIssue = { team: Team; count: number; kind: 'over' | 'under'; limit: number };

export function sizeIssues(teams: Team[], competitors: Competitor[], reg: Pick<Contest['registration'], 'teamMin' | 'teamMax'>): SizeIssue[] {
  const out: SizeIssue[] = [];
  for (const t of teams) {
    if (t.status === 'withdrawn') continue;
    const count = competitors.filter((c) => c.teamId === t.id).length;
    if (count > reg.teamMax) out.push({ team: t, count, kind: 'over', limit: reg.teamMax });
    else if (count < reg.teamMin) out.push({ team: t, count, kind: 'under', limit: reg.teamMin });
  }
  return out;
}

// ---------------------------------------------------------------- contacts

export type EmailIssue = { kind: 'guardian'; c: Competitor; email: string } | { kind: 'contact'; team: Team; email: string };

export function noGuardianEmail(competitors: Competitor[]): Competitor[] {
  return competitors.filter((c) => !normEmail(c.guardianEmail));
}

export function badEmails(teams: Team[], competitors: Competitor[]): EmailIssue[] {
  const out: EmailIssue[] = [];
  for (const t of teams) if (normEmail(t.contactEmail) && !isEmail(t.contactEmail)) out.push({ kind: 'contact', team: t, email: t.contactEmail });
  for (const c of competitors) if (normEmail(c.guardianEmail) && !isEmail(c.guardianEmail)) out.push({ kind: 'guardian', c, email: c.guardianEmail });
  return out;
}

export type GradeIssue = { c: Competitor; kind: 'missing' | 'range' };

export function gradeIssues(competitors: Competitor[], min = GRADE_MIN, max = GRADE_MAX): GradeIssue[] {
  const out: GradeIssue[] = [];
  for (const c of competitors) {
    const g = Number(c.grade);
    if (!c.grade || !Number.isFinite(g)) out.push({ c, kind: 'missing' });
    else if (g < min || g > max || !Number.isInteger(g)) out.push({ c, kind: 'range' });
  }
  return out;
}

// ------------------------------------------------------------------ report

export type Health = {
  dupStudents: DupStudent[];
  dupTeams: DupTeam[];
  badIds: BadId[];
  slots: SlotIssue[];
  sizes: SizeIssue[];
  noGuardianEmail: Competitor[];
  badEmails: EmailIssue[];
  grades: GradeIssue[];
  total: number;
};

/** Everything that looks wrong with a contest's roster. Withdrawn teams are left out of what only matters on the day. */
export function rosterHealth(teams: Team[], competitors: Competitor[], reg: Pick<Contest['registration'], 'teamMin' | 'teamMax'>): Health {
  const live = new Set(teams.filter((t) => t.status !== 'withdrawn').map((t) => t.id));
  const liveComps = competitors.filter((c) => live.has(c.teamId));
  const h = {
    dupStudents: duplicateStudents(teams, competitors),
    dupTeams: duplicateTeams(teams),
    badIds: badIds(teams, competitors),
    slots: slotIssues(teams, competitors),
    sizes: sizeIssues(teams, competitors, reg),
    noGuardianEmail: noGuardianEmail(liveComps),
    badEmails: badEmails(teams.filter((t) => live.has(t.id)), liveComps),
    grades: gradeIssues(liveComps),
  };
  const total = Object.values(h).reduce((n, list) => n + list.length, 0);
  return { ...h, total };
}

/** One row per address that runs teams: a coach or contact and every team they look after. */
export type Contact = { email: string; name: string; teams: Team[] };

export function contactsOf(teams: Team[], coaches: { id: string; name: string; email: string; teamIds?: string[] }[] = []): Contact[] {
  const map = new Map<string, Contact>();
  const add = (email: string, name: string, t: Team) => {
    const k = normEmail(email);
    if (!k) return;
    const row = map.get(k) ?? { email: email.trim(), name: name.trim(), teams: [] };
    if (!row.name && name) row.name = name.trim();
    if (!row.teams.some((x) => x.id === t.id)) row.teams.push(t);
    map.set(k, row);
  };
  for (const t of teams) add(t.contactEmail, t.contactName, t);
  for (const u of coaches) for (const id of u.teamIds ?? []) {
    const t = teams.find((x) => x.id === id);
    if (t) add(u.email, u.name, t);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Escape text for an email body. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
