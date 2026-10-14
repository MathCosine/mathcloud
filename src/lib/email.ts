/**
 * Email for the organisers' Email page: who gets a message, the context its
 * template is filled from, plain-text bodies turned into simple HTML, and
 * flushing the queue.
 */
import { contestOf, sendMessages, type Message } from './actions';
import { ordinal } from './hooks';
import type { DB, EmailTemplate } from './model';
import type { Standings } from './scoring/engine';
import { REMOTE, update } from './store';
import { capacityToday, esc } from './reports';
import { render, type Ctx } from './templates';
import * as W from './remote/write';

export type Audience = EmailTemplate['audience'];
export type Filter = 'all' | 'missing_waivers' | 'pending' | `div:${string}`;
export type Recipient = { to: string; key: string; label: string; competitorId?: string; ctx: Ctx };

const first = (name: string) => name.split(/\s+/)[0];
const origin = () => (typeof window !== 'undefined' ? window.location.origin : 'https://mathcloud.app');

export const AUDIENCE_LABEL: Record<Audience, string> = { contacts: 'Team contacts', guardians: 'Guardians', students: 'Students' };

/** Everyone in an audience, with the values their template can use. */
export function recipients(db: DB, standings: Standings, audience: Audience, filter: Filter): Recipient[] {
  const contest = contestOf(db);
  const c0 = { name: contest.short, full_name: contest.name, date: contest.dateLabel };
  let teams = db.teams.filter((x) => x.contestId === contest.id && x.status !== 'withdrawn');
  if (filter === 'pending') teams = teams.filter((t) => t.status === 'pending');
  if (filter.startsWith('div:')) teams = teams.filter((t) => t.divisionId === filter.slice(4));
  const division = (id: string) => contest.divisions.find((d) => d.id === id);

  if (audience === 'contacts') {
    return teams
      .filter((team) => filter !== 'missing_waivers' || db.competitors.some((c) => c.teamId === team.id && !c.waiverSignedAt))
      .filter((team) => team.contactEmail)
      .map((team) => {
        const members = db.competitors.filter((c) => c.teamId === team.id);
        return {
          to: team.contactEmail,
          key: team.code,
          label: `${team.code} ${team.name}`,
          ctx: {
            contest: c0,
            team: { name: team.name, code: team.code, join_code: team.joinCode },
            contact: { name: team.contactName, first_name: first(team.contactName) },
            division: division(team.divisionId)?.mode ?? team.divisionId,
            members: members.map((c) => ({ id: c.publicId, name: c.name, waiver: c.waiverSignedAt ? 'signed' : 'missing' })),
            waivers_missing: members.filter((c) => !c.waiverSignedAt).length,
            portal_link: `${origin()}/coach`,
          },
        };
      });
  }
  const comps = db.competitors.filter((c) => teams.some((x) => x.id === c.teamId) && (filter !== 'missing_waivers' || !c.waiverSignedAt));
  return comps
    .map((c): Recipient | null => {
      const team = teams.find((x) => x.id === c.teamId)!;
      const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
      const user = db.users.find((u) => u.competitorId === c.id);
      const row = standings.individuals[team.divisionId]?.find((r) => r.competitor.id === c.id);
      const ctx: Ctx = {
        contest: c0,
        team: { name: team.name, code: team.code },
        guardian: { name: c.guardianName },
        competitor: { name: c.name, first_name: first(c.name), id: c.publicId, login: user?.email ?? `sfmo-${c.publicId.toLowerCase()}` },
        division: { name: division(team.divisionId)?.name ?? '', mode: division(team.divisionId)?.mode ?? '' },
        zoom: { room: room?.name ?? 'your room', link: room?.url ?? '' },
        waiver_link: `${origin()}/waiver/${c.id}`,
        portal_link: `${origin()}/me`,
        score: { individual: row ? `${row.score} of ${row.max}` : '–' },
        place: { individual: row ? ordinal(row.place) : '–' },
        award: row?.award ?? '',
        report_link: `${origin()}/me`,
      };
      if (audience === 'guardians') return c.guardianEmail ? { to: c.guardianEmail, key: c.publicId, label: `${c.publicId} ${c.guardianName} (for ${c.name})`, competitorId: c.id, ctx } : null;
      const to = user && !user.managed && user.email.includes('@') ? user.email : c.guardianEmail;
      return to ? { to, key: c.publicId, label: `${c.publicId} ${c.name}`, competitorId: c.id, ctx } : null;
    })
    .filter((x): x is Recipient => !!x);
}

/** The variables each audience can use, for the buttons under the editor. */
export const FIELDS: Record<Audience, string[]> = {
  contacts: ['contest.name', 'contest.date', 'team.name', 'team.code', 'team.join_code', 'contact.first_name', 'waivers_missing', 'portal_link'],
  guardians: ['contest.name', 'contest.date', 'guardian.name', 'competitor.name', 'competitor.id', 'team.name', 'waiver_link', 'score.individual', 'award'],
  students: ['contest.name', 'competitor.first_name', 'competitor.id', 'competitor.login', 'team.name', 'zoom.room', 'zoom.link', 'portal_link', 'score.individual', 'place.individual', 'award', 'report_link'],
};

/** A plain-text message as simple HTML: paragraphs kept, links clickable. */
export function textToHtml(text: string): string {
  const body = esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2346C8">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#ffffff"><div style="max-width:600px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#12151C">${body}</div></body></html>`;
}

/** Waiver links that work when connected: each needs a signed token from the server. */
async function withWaiverTokens(list: Recipient[], uses: boolean): Promise<Recipient[]> {
  if (!REMOTE || !uses) return list;
  const out: Recipient[] = [];
  for (let i = 0; i < list.length; i += 10) {
    const chunk = list.slice(i, i + 10);
    const tokens = await Promise.all(chunk.map((r) => (r.competitorId ? W.waiverToken(r.competitorId) : Promise.resolve({ data: null, error: null }))));
    chunk.forEach((r, j) => {
      const t = tokens[j]?.data;
      out.push(t ? { ...r, ctx: { ...r.ctx, waiver_link: `${origin()}/waiver/${t}` } } : r);
    });
  }
  return out;
}

/** Fill a subject and body for each person and send. A templateId lets a send skip people who already have it. */
export async function sendComposed(list: Recipient[], subject: string, body: string, templateId: string | null, again: boolean) {
  const filled = await withWaiverTokens(list, (subject + body).includes('waiver_link'));
  const stamp = Date.now().toString(36);
  const messages: Message[] = filled.map((r) => ({
    to: r.to,
    subject: render(subject, r.ctx),
    html: textToHtml(render(body, r.ctx)),
    tag: templateId && !again ? r.key : `${r.key}:${stamp}`,
  }));
  return sendMessages(templateId ? 'template' : 'message', templateId, messages);
}

/** Who on this list already has this template (sent or waiting). */
export function alreadyHave(db: DB, templateId: string, list: Recipient[], subject: string) {
  const set = new Set<string>();
  for (const r of list) {
    const subj = render(subject, r.ctx);
    if (db.sends.some((s) => s.templateId === templateId && s.status !== 'failed' && s.to.toLowerCase() === r.to.toLowerCase() && (!s.subject || s.subject === subj))) set.add(`${r.to}|${r.key}`);
  }
  return set;
}

/**
 * Send what is waiting in the queue, as far as today's capacity goes.
 * Connected, the server's sender does this; in the sandbox it is counted here.
 */
export async function flushQueue(db: DB): Promise<{ sent: number; waiting: number; error: string | null }> {
  if (REMOTE) return sendMessages('template', null, []);
  let room = capacityToday(db).left;
  let sent = 0;
  let waiting = 0;
  const key = db.orgs[0]?.emailKeys?.find((k) => k.active)?.id ?? null;
  update((d) => {
    for (const s of d.sends) {
      if (s.status !== 'queued') continue;
      if (room > 0) {
        room--;
        sent++;
        s.status = 'sent';
        s.at = new Date().toISOString();
        s.keyId = s.keyId ?? key;
      } else waiting++;
    }
  });
  return { sent, waiting, error: null };
}
