/**
 * Score reports: one page per student and per team, built from the same
 * standings the Results page shows, plus the email that carries each one and
 * the sending capacity of the organisation's keys today.
 */
import { resultRows, contestOf, modeOf, sendMessages, type Message } from './actions';
import { ordinal } from './hooks';
import type { Contest, DB, DivisionMode, EmailKey, EmailSend, Org } from './model';
import type { Standings } from './scoring/engine';
import { REMOTE } from './store';

export type Addr = { to: string; name: string };
export type Who = 'guardians' | 'students' | 'coaches';
export type ProblemCell = { number: number; status: 'correct' | 'incorrect' | 'blank' | 'unreviewed'; rate: number };
export type Bar = { name: string; score: number; max: number; note?: string };

export type StudentReport = {
  kind: 'student';
  id: string;
  /** Printed in the subject; what a send is matched on. */
  key: string;
  name: string;
  divisionId: string;
  division: string;
  mode: DivisionMode;
  team: { name: string; code: string; place: number | null; of: number; total: number; award: string | null } | null;
  place: number | null;
  of: number;
  score: number;
  max: number;
  award: string | null;
  /** The Individual round, then the rounds the team took together. */
  rounds: Bar[];
  problems: ProblemCell[];
  /** Everyone's Individual score in the division, for the histogram. */
  field: number[];
  median: number;
  to: Partial<Record<Who, Addr>>;
};

export type TeamReport = {
  kind: 'team';
  id: string;
  key: string;
  name: string;
  school: string;
  divisionId: string;
  division: string;
  mode: DivisionMode;
  place: number | null;
  of: number;
  total: number;
  maxTotal: number;
  award: string | null;
  rounds: (Bar & { weight: number; weighted: number })[];
  members: { name: string; publicId: string; score: number | null; max: number; place: number | null; award: string | null }[];
  field: number[];
  median: number;
  to: Partial<Record<Who, Addr>> & { members?: { guardians: Addr[]; students: Addr[] } };
};

export type Report = StudentReport | TeamReport;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function studentAddr(db: DB, competitorId: string): Addr | undefined {
  const user = db.users.find((u) => u.competitorId === competitorId);
  const c = db.competitors.find((x) => x.id === competitorId);
  if (!user || user.managed || !user.email.includes('@')) return undefined;
  return { to: user.email, name: c?.name ?? user.name };
}

/** Every report the contest can produce right now. */
export function buildReports(contest: Contest, standings: Standings, db: DB): { students: StudentReport[]; teams: TeamReport[] } {
  const rows = resultRows(contest, standings, db);
  const indRound = contest.rounds.find((r) => r.kind === 'individual');
  const students: StudentReport[] = [];
  const teams: TeamReport[] = [];

  for (const r of rows) {
    if (r.competitorId) {
      const c = db.competitors.find((x) => x.id === r.competitorId);
      const team = c && db.teams.find((t) => t.id === c.teamId);
      if (!c || !team) continue;
      const d = contest.divisions.find((x) => x.id === team.divisionId)!;
      const inds = standings.individuals[d.id] ?? [];
      const trow = standings.teams[d.id]?.find((x) => x.team.id === team.id);
      const stats = indRound ? standings.problemStats[d.id]?.[indRound.id] ?? [] : [];
      const field = inds.map((x) => x.score);
      const own = inds.find((x) => x.competitor.id === c.id);
      const rounds: Bar[] = [];
      if (indRound) rounds.push({ name: indRound.name, score: own ? r.data.score : 0, max: r.data.max ?? own?.max ?? 0, note: own ? 'Your own score' : 'Not taken' });
      for (const p of trow?.parts ?? []) {
        const round = contest.rounds.find((x) => x.id === p.roundId);
        if (!round || round.kind === 'individual') continue;
        rounds.push({ name: round.name, score: p.raw, max: p.max, note: 'With your team' });
      }
      const problems: ProblemCell[] = (r.data.problems ?? []).map((p, i) => ({ number: p.number, status: p.status, rate: stats[i]?.rate ?? 0 }));
      const coach = team.contactEmail ? { to: team.contactEmail, name: team.contactName } : undefined;
      students.push({
        kind: 'student', id: c.id, key: c.publicId, name: c.name, divisionId: d.id, division: d.name, mode: modeOf(contest, team),
        team: { name: team.name, code: team.code, place: trow?.place ?? null, of: standings.teams[d.id]?.length ?? 0, total: trow?.total ?? 0, award: trow?.award ?? null },
        place: r.data.place, of: r.data.of, score: r.data.score, max: r.data.max ?? own?.max ?? 0, award: r.data.award ?? null,
        rounds, problems, field, median: median(field),
        to: { guardians: c.guardianEmail ? { to: c.guardianEmail, name: c.guardianName } : undefined, students: studentAddr(db, c.id), coaches: coach },
      });
    } else if (r.teamId) {
      const team = db.teams.find((t) => t.id === r.teamId);
      const trow = team && standings.teams[team.divisionId]?.find((x) => x.team.id === team.id);
      if (!team || !trow) continue;
      const d = contest.divisions.find((x) => x.id === team.divisionId)!;
      const all = standings.teams[d.id] ?? [];
      const inds = standings.individuals[d.id] ?? [];
      const members = db.competitors.filter((c) => c.teamId === team.id);
      teams.push({
        kind: 'team', id: team.id, key: team.code, name: team.name, school: team.school, divisionId: d.id, division: d.name, mode: modeOf(contest, team),
        place: trow.place, of: all.length, total: trow.total, award: trow.award ?? null,
        maxTotal: trow.parts.reduce((n, p) => n + p.max * p.weight, 0),
        rounds: trow.parts.map((p) => ({ name: contest.rounds.find((x) => x.id === p.roundId)?.name ?? p.label, score: p.raw, max: p.max, note: contest.rounds.find((x) => x.id === p.roundId)?.kind === 'individual' ? p.detail : undefined, weight: p.weight, weighted: p.weighted })),
        members: members.map((m) => {
          const ir = inds.find((x) => x.competitor.id === m.id);
          return { name: m.name, publicId: m.publicId, score: ir?.score ?? null, max: ir?.max ?? 0, place: ir?.place ?? null, award: ir?.award ?? null };
        }),
        field: all.map((x) => x.total), median: median(all.map((x) => x.total)),
        to: {
          coaches: team.contactEmail ? { to: team.contactEmail, name: team.contactName } : undefined,
          members: {
            guardians: members.filter((m) => m.guardianEmail).map((m) => ({ to: m.guardianEmail, name: m.guardianName })),
            students: members.map((m) => studentAddr(db, m.id)).filter((a): a is Addr => !!a),
          },
        },
      });
    }
  }
  students.sort((a, b) => a.division.localeCompare(b.division) || (a.place ?? 1e9) - (b.place ?? 1e9) || a.key.localeCompare(b.key));
  teams.sort((a, b) => a.division.localeCompare(b.division) || (a.place ?? 1e9) - (b.place ?? 1e9) || a.key.localeCompare(b.key));
  return { students, teams };
}

/** Who gets a report, given the boxes ticked. Addresses are deduplicated per report. */
export function addressesFor(r: Report, who: Record<Who, boolean>): Addr[] {
  const out: Addr[] = [];
  const add = (a?: Addr) => {
    if (a && a.to && !out.some((x) => x.to.toLowerCase() === a.to.toLowerCase())) out.push(a);
  };
  if (r.kind === 'student') {
    if (who.guardians) add(r.to.guardians);
    if (who.students) add(r.to.students);
    if (who.coaches) add(r.to.coaches);
  } else {
    if (who.coaches) add(r.to.coaches);
    if (who.guardians) r.to.members?.guardians.forEach(add);
    if (who.students) r.to.members?.students.forEach(add);
  }
  return out;
}

export const reportSubject = (contest: Contest, r: Report) =>
  `${contest.short} score report: ${r.name} (${r.key})`;

/** The last score-report send to this address for this report, if any. */
export function lastSend(sends: EmailSend[], r: Report, to: string): EmailSend | undefined {
  const tag = `(${r.key})`;
  const lc = to.toLowerCase();
  let best: EmailSend | undefined;
  for (const s of sends) {
    if (s.kind !== 'score_report' || s.to.toLowerCase() !== lc || !(s.subject ?? '').includes(tag)) continue;
    if (!best || s.at > best.at) best = s;
  }
  return best;
}

export type SendState = 'none' | 'sent' | 'queued' | 'failed' | 'partial';

export function reportState(sends: EmailSend[], r: Report, addrs: Addr[]): { state: SendState; at?: string; error?: string | null } {
  if (!addrs.length) return { state: 'none' };
  const last = addrs.map((a) => lastSend(sends, r, a.to));
  const at = last.reduce<string | undefined>((m, s) => (s && (!m || s.at > m) ? s.at : m), undefined);
  if (last.some((s) => s?.status === 'failed')) return { state: 'failed', at, error: last.find((s) => s?.status === 'failed')?.error };
  if (last.every((s) => s?.status === 'sent')) return { state: 'sent', at };
  if (last.some((s) => s?.status === 'queued')) return { state: 'queued', at };
  if (last.some((s) => s)) return { state: 'partial', at };
  return { state: 'none' };
}

// ---------------------------------------------------------------- capacity

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export type Capacity = {
  keys: { key: EmailKey; used: number; left: number }[];
  capacity: number;
  used: number;
  left: number;
  /** No key at all: in the sandbox sending is only counted, against the demo limit. */
  noKeys: boolean;
};

export function orgOf(db: DB): Org | undefined {
  const contest = contestOf(db);
  return db.orgs.find((o) => o.id === contest.orgId) ?? db.orgs[0];
}

export function capacityToday(db: DB): Capacity {
  const org = orgOf(db);
  const keys = org?.emailKeys ?? [];
  const sentToday = db.sends.filter((s) => s.status === 'sent' && isToday(s.at));
  if (!keys.length) {
    const cap = REMOTE ? 0 : org?.emailProvider.dailyLimit ?? 0;
    return { keys: [], capacity: cap, used: sentToday.length, left: Math.max(0, cap - sentToday.length), noKeys: true };
  }
  const per = keys.map((key) => {
    const used = sentToday.filter((s) => s.keyId === key.id).length;
    return { key, used, left: key.active ? Math.max(0, key.dailyLimit - used) : 0 };
  });
  const active = per.filter((p) => p.key.active);
  const capacity = active.reduce((n, p) => n + p.key.dailyLimit, 0);
  // Sends with no key recorded (older ones) still count against the pool.
  const unkeyed = sentToday.filter((s) => !s.keyId || !keys.some((k) => k.id === s.keyId)).length;
  const used = active.reduce((n, p) => n + p.used, 0) + unkeyed;
  return { keys: per, capacity, used, left: Math.max(0, capacity - used), noKeys: false };
}

export const sentToday = (db: DB, keyId: string) => db.sends.filter((s) => s.keyId === keyId && s.status === 'sent' && isToday(s.at)).length;

// ------------------------------------------------------------------- email

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const placeText = (place: number | null, of: number) => (place ? `${ordinal(place)} of ${of}` : 'Not placed');

const INK = '#12151C';
const SOFT = '#5B6170';
const LINE = '#E3E5EA';
const BLUE = '#2346C8';
const GREEN = '#0F7B55';
const RED = '#B8382A';

function barRow(b: Bar, extra = '') {
  const pct = b.max ? Math.max(0, Math.min(100, Math.round((b.score / b.max) * 100))) : 0;
  return `<tr>
<td style="padding:6px 12px 6px 0;font-size:14px;color:${INK};white-space:nowrap;vertical-align:middle">${esc(b.name)}${b.note ? `<div style="font-size:12px;color:${SOFT}">${esc(b.note)}</div>` : ''}</td>
<td style="padding:6px 0;width:100%;vertical-align:middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
${pct > 0 ? `<td width="${pct}%" style="background:${BLUE};height:10px;line-height:10px;font-size:0;border-radius:3px 0 0 3px">&nbsp;</td>` : ''}
${pct < 100 ? `<td width="${100 - pct}%" style="background:#ECEEF2;height:10px;line-height:10px;font-size:0">&nbsp;</td>` : ''}
</tr></table></td>
<td style="padding:6px 0 6px 12px;font-size:14px;color:${INK};white-space:nowrap;text-align:right;vertical-align:middle"><b>${fmt(b.score)}</b> / ${fmt(b.max)}${extra}</td>
</tr>`;
}

function stat(label: string, value: string, sub = '') {
  return `<td style="padding:12px 14px;border:1px solid ${LINE};vertical-align:top">
<div style="font-size:12px;color:${SOFT};text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
<div style="font-size:20px;font-weight:700;color:${INK};margin-top:2px">${esc(value)}</div>${sub ? `<div style="font-size:12px;color:${SOFT}">${esc(sub)}</div>` : ''}</td>`;
}

function frame(contest: Contest, orgName: string, title: string, inner: string, link: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK}">
<tr><td style="padding:20px 24px;border-bottom:2px solid ${INK}">
<div style="font-size:12px;color:${SOFT}">${esc(orgName)} · ${esc(contest.dateLabel)}</div>
<div style="font-size:18px;font-weight:700">${esc(contest.name)}</div>
<div style="font-size:13px;color:${SOFT}">${esc(title)}</div>
</td></tr>
${inner}
<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};font-size:12px;color:${SOFT}">See it online and print it: <a href="${esc(link)}" style="color:${BLUE}">${esc(link)}</a><br>Questions about a score? Reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
}

/** The report as an email: tables and inline styles only, so every mail client shows it the same. */
export function reportHtml(contest: Contest, orgName: string, r: Report, origin: string): string {
  if (r.kind === 'student') {
    const cells = r.problems
      .map((p) => {
        const bg = p.status === 'correct' ? GREEN : p.status === 'incorrect' ? RED : '#ECEEF2';
        const fg = p.status === 'blank' || p.status === 'unreviewed' ? SOFT : '#ffffff';
        return `<td align="center" style="padding:2px"><div style="background:${bg};color:${fg};font-size:12px;font-weight:700;width:28px;line-height:24px;border-radius:3px">${p.number}</div><div style="font-size:10px;color:${SOFT}">${Math.round(p.rate * 100)}%</div></td>`;
      })
      .join('');
    const inner = `
<tr><td style="padding:20px 24px 4px">
<div style="font-size:24px;font-weight:700">${esc(r.name)}</div>
<div style="font-size:13px;color:${SOFT}">${esc(r.key)} · ${esc(r.team?.name ?? '')} · ${esc(r.division)} division</div>
</td></tr>
<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
${stat('Place', placeText(r.place, r.of))}${stat('Individual score', `${fmt(r.score)} / ${fmt(r.max)}`, `Division median ${fmt(r.median)}`)}${stat('Award', r.award ?? 'None')}
</tr></table></td></tr>
<tr><td style="padding:8px 24px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">Rounds</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${r.rounds.map((b) => barRow(b)).join('')}</table></td></tr>
${r.problems.length ? `<tr><td style="padding:8px 24px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">Individual round, problem by problem</div>
<div style="font-size:12px;color:${SOFT};margin-bottom:6px">Green correct, red incorrect, grey blank. Below each: the share of the division who solved it.</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${cells}</tr></table></td></tr>` : ''}
${r.team ? `<tr><td style="padding:8px 24px 16px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">Team</div>
<div style="font-size:14px">${esc(r.team.name)} placed <b>${esc(placeText(r.team.place, r.team.of))}</b> with ${fmt(r.team.total)} points${r.team.award ? ` (${esc(r.team.award)})` : ''}.</div></td></tr>` : ''}`;
    return frame(contest, orgName, 'Score report', inner, `${origin}/me`);
  }
  const inner = `
<tr><td style="padding:20px 24px 4px">
<div style="font-size:24px;font-weight:700">${esc(r.name)}</div>
<div style="font-size:13px;color:${SOFT}">Team ${esc(r.key)} · ${esc(r.school)} · ${esc(r.division)} division</div>
</td></tr>
<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
${stat('Place', placeText(r.place, r.of))}${stat('Total', fmt(r.total), `Division median ${fmt(r.median)}`)}${stat('Award', r.award ?? 'None')}
</tr></table></td></tr>
<tr><td style="padding:8px 24px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">Rounds</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${r.rounds.map((b) => barRow(b, b.weight !== 1 ? ` <span style="color:${SOFT}">×${b.weight} = ${fmt(b.weighted)}</span>` : '')).join('')}</table></td></tr>
<tr><td style="padding:8px 24px 16px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">Members</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${r.members.map((m) => `<tr><td style="padding:5px 0;border-top:1px solid ${LINE}">${esc(m.name)} <span style="color:${SOFT};font-size:12px">${esc(m.publicId)}</span></td><td style="padding:5px 0;border-top:1px solid ${LINE};text-align:right">${m.score === null ? '–' : `${fmt(m.score)} / ${fmt(m.max)}`}</td><td style="padding:5px 0 5px 12px;border-top:1px solid ${LINE};text-align:right;color:${SOFT}">${m.place ? ordinal(m.place) : ''}${m.award ? ` · ${esc(m.award)}` : ''}</td></tr>`).join('')}
</table></td></tr>`;
  return frame(contest, orgName, 'Team score report', inner, `${origin}/coach`);
}

/**
 * Send these reports. With `resend`, people who already have theirs get a new
 * copy; otherwise only addresses with no sent or queued copy are sent.
 */
export async function sendReports(db: DB, reports: Report[], who: Record<Who, boolean>, resend: boolean) {
  const contest = contestOf(db);
  const org = orgOf(db);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://mathcloud.app';
  const stamp = Date.now().toString(36);
  const messages: Message[] = [];
  for (const r of reports) {
    const html = reportHtml(contest, org?.name ?? '', r, origin);
    for (const a of addressesFor(r, who)) {
      const last = lastSend(db.sends, r, a.to);
      if (!resend && last && last.status !== 'failed') continue;
      messages.push({ to: a.to, subject: reportSubject(contest, r), html, tag: resend && last ? `${r.key}:${stamp}` : r.key });
    }
  }
  if (!messages.length) return { sent: 0, waiting: 0, error: null as string | null, count: 0 };
  const res = await sendMessages('score_report', null, messages);
  return { ...res, count: messages.length };
}

/** How many emails a send would make. */
export function countMessages(db: DB, reports: Report[], who: Record<Who, boolean>, resend: boolean) {
  let fresh = 0;
  let again = 0;
  for (const r of reports) {
    for (const a of addressesFor(r, who)) {
      const last = lastSend(db.sends, r, a.to);
      if (last && last.status !== 'failed') again++;
      else fresh++;
    }
  }
  return { fresh, again, total: resend ? fresh + again : fresh };
}
