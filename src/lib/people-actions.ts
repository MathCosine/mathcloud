/**
 * Organiser actions for the roster screens (Teams, People, Waivers) that
 * build on actions.ts: merging teams, sending waiver reminders with real
 * links, student sign-ins, adding and removing staff.
 */
import type { Competitor, Role } from './model';
import { contestOf, deleteTeam, markWaiver, moveCompetitor, removeCompetitor, remindWaiver, saveCompetitor, sendMessages, type Message } from './actions';
import { esc, normEmail, normName } from './people';
import { getDB, REMOTE, update } from './store';
import * as W from './remote/write';
import { client } from './remote/client';

/** Move every student of `dropId` into `keepId`, then delete `dropId`. A student already on the kept team is not copied twice. */
export function mergeTeams(keepId: string, dropId: string, by: string): string | null {
  const db = getDB();
  const keep = db.teams.find((t) => t.id === keepId);
  const drop = db.teams.find((t) => t.id === dropId);
  if (!keep || !drop) return 'No such team.';
  const kept = db.competitors.filter((c) => c.teamId === keepId);
  for (const c of db.competitors.filter((x) => x.teamId === dropId)) {
    const twin = kept.find((k) => normName(k.name) === normName(c.name));
    if (twin) {
      // Keep the waiver if only the copy had it.
      if (c.waiverSignedAt && !twin.waiverSignedAt) saveCompetitor({ ...twin, waiverSignedAt: c.waiverSignedAt, waiverSignedBy: c.waiverSignedBy ?? null }, by);
      continue;
    }
    const err = moveCompetitor(c.id, keepId, by);
    if (err) return `${c.name} could not move: ${err}`;
  }
  deleteTeam(dropId, by);
  return null;
}

/** Remove the second record of a student, carrying over a waiver or check-in only the copy had. */
export function removeDuplicate(keep: Competitor, drop: Competitor, by: string) {
  const patch: Partial<Competitor> = {};
  if (drop.waiverSignedAt && !keep.waiverSignedAt) Object.assign(patch, { waiverSignedAt: drop.waiverSignedAt, waiverSignedBy: drop.waiverSignedBy ?? null });
  if (drop.checkedInAt && !keep.checkedInAt) patch.checkedInAt = drop.checkedInAt;
  if (!normEmail(keep.guardianEmail) && normEmail(drop.guardianEmail)) Object.assign(patch, { guardianEmail: drop.guardianEmail, guardianName: keep.guardianName || drop.guardianName });
  if (Object.keys(patch).length) {
    const now = getDB().competitors.find((c) => c.id === keep.id);
    if (now) saveCompetitor({ ...now, ...patch }, by);
  }
  removeCompetitor(drop.id, by);
}

// ------------------------------------------------------------------ waivers

const base = () => `${location.origin}${import.meta.env.BASE_URL.replace(/\/?$/, '/')}`;

/** The link a guardian opens to sign. Connected, it carries a token the database made for this student. */
export async function waiverLink(competitorId: string): Promise<string | null> {
  if (!REMOTE) return `${base()}waiver/${competitorId}`;
  const r = await W.waiverToken(competitorId);
  return r.data ? `${base()}waiver/${r.data}` : null;
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export type ReminderResult = { sent: number; waiting: number; skipped: number; error: string | null };

/** Email each student's guardian their own waiver link, and note the reminder on the student. */
export async function sendWaiverReminders(competitorIds: string[], by: string): Promise<ReminderResult> {
  const db = getDB();
  const contest = contestOf(db);
  const list = competitorIds
    .map((id) => db.competitors.find((c) => c.id === id))
    .filter((c): c is Competitor => !!c && !c.waiverSignedAt);
  const reachable = list.filter((c) => normEmail(c.guardianEmail));
  const today = new Date().toISOString().slice(0, 10);
  const made = await inBatches(reachable, 6, async (c): Promise<{ c: Competitor; m: Message } | null> => {
    const link = await waiverLink(c.id);
    if (!link) return null;
    const team = db.teams.find((t) => t.id === c.teamId);
    const hello = c.guardianName && c.guardianName !== 'Parent or guardian' ? `Hello ${esc(c.guardianName)},` : 'Hello,';
    const html = [
      `<p>${hello}</p>`,
      `<p>${esc(c.name)} is registered for ${esc(contest.name)}${team ? ` with ${esc(team.name)}` : ''}. Before the contest a parent or guardian needs to sign the waiver. It takes about a minute.</p>`,
      `<p><a href="${link}">Sign the waiver for ${esc(c.name)}</a></p>`,
      `<p style="color:#666;font-size:13px">If the button does not open, copy this address into your browser:<br>${link}</p>`,
      `<p>Thank you,<br>The ${esc(contest.short)} organisers</p>`,
    ].join('\n');
    return { c, m: { to: c.guardianEmail.trim(), subject: `Waiver needed for ${c.name}: ${contest.short}`, html, tag: `${c.id}:${today}` } };
  });
  const ready = made.filter((x): x is { c: Competitor; m: Message } => !!x);
  if (!ready.length) return { sent: 0, waiting: 0, skipped: list.length, error: list.length ? 'No guardian email to send to.' : null };
  const r = await sendMessages('waiver_reminder', null, ready.map((x) => x.m));
  if (!r.error) for (const { c } of ready) remindWaiver(c.id, by);
  return { sent: r.sent, waiting: r.waiting, skipped: list.length - ready.length, error: r.error };
}

export const markPaper = (competitorId: string, by: string) => markWaiver(competitorId, 'Paper copy', by);
export const undoWaiver = (competitorId: string, by: string) => markWaiver(competitorId, null, by);

/** How a waiver came in, from what was recorded with it. */
export function waiverHow(c: Pick<Competitor, 'waiverSignedAt' | 'waiverSignedBy' | 'guardianName'>): { who: string; how: string } {
  const by = c.waiverSignedBy ?? '';
  const recorded = by.match(/^(.*) \(recorded by (.*)\)$/);
  if (recorded) return { who: recorded[1], how: `Recorded by ${recorded[2]}` };
  return { who: by || c.guardianName || 'Guardian', how: 'Signed online' };
}

// ----------------------------------------------------------- student logins

export type Login = { name: string; username: string; password: string };

const WORDS = ['maple', 'river', 'cobalt', 'falcon', 'quartz', 'cedar', 'harbor', 'orbit', 'prism', 'summit', 'tiger', 'violet', 'walnut', 'zephyr', 'lumen', 'delta'];
const word = () => WORDS[Math.floor(Math.random() * WORDS.length)];

/** Usernames and new passwords for every student on a team. The passwords are shown once. */
export async function studentLogins(teamId: string): Promise<{ accounts: Login[]; error: string | null }> {
  if (REMOTE) return W.createStudentLogins(teamId);
  const db = getDB();
  const contest = contestOf(db);
  const prefix = contest.slug.split('-')[0];
  const accounts: Login[] = [];
  update((d) => {
    for (const c of d.competitors.filter((x) => x.teamId === teamId)) {
      const password = `${word()}-${word()}-${Math.floor(10 + Math.random() * 90)}`;
      let u = d.users.find((x) => x.competitorId === c.id);
      if (!u) {
        u = { id: `u-${c.id}`, email: `${prefix}-${c.publicId}`.toLowerCase(), name: c.name, role: 'student', password, competitorId: c.id, managed: true };
        d.users.push(u);
      } else u.password = password;
      accounts.push({ name: c.name, username: u.email, password });
    }
  });
  return { accounts, error: null };
}

// -------------------------------------------------------------------- staff

export type StaffRole = Extract<Role, 'director' | 'staff' | 'grader' | 'proctor'>;
export type StaffInput = { email: string; name: string; role: StaffRole; roundIds?: string[]; roomId?: string };

type AccountsReply = { user_id?: string; password?: string; error?: string };

/** Give someone a role in this contest. Resolves to a one-time password when a new account was made. */
export async function addStaff(input: StaffInput): Promise<{ password: string | null; error: string | null }> {
  const contest = contestOf(getDB());
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim() || email.split('@')[0];
  if (REMOTE) {
    const { data, error } = await client().functions.invoke<AccountsReply>('accounts', {
      body: { action: 'add_staff', contest_id: contest.id, email, name, role: input.role, round_ids: input.role === 'grader' ? input.roundIds ?? [] : null, room_id: input.role === 'proctor' ? input.roomId ?? null : null },
    });
    if (error) return { password: null, error: error.message };
    if (data?.error) return { password: null, error: data.error };
    const { reload } = await import('./remote/live');
    void reload();
    return { password: data?.password ?? null, error: null };
  }
  let password: string | null = null;
  update((d) => {
    const existing = d.users.find((u) => u.email.toLowerCase() === email);
    const scope = { roundIds: input.role === 'grader' ? input.roundIds ?? [] : undefined, roomId: input.role === 'proctor' ? input.roomId : undefined };
    if (existing) Object.assign(existing, { role: input.role, ...scope });
    else {
      password = `${word()}-${word()}-${Math.floor(10 + Math.random() * 90)}`;
      d.users.push({ id: `u-${Date.now()}`, email, name, role: input.role, password, ...scope });
    }
    if (input.role === 'proctor' && input.roomId) {
      const c = contestOf(d);
      const room = c.rooms.find((r) => r.id === input.roomId);
      const uid = existing?.id ?? d.users[d.users.length - 1].id;
      if (room) room.proctorId = uid;
    }
  });
  return { password, error: null };
}

export async function removeStaff(userId: string, role: StaffRole): Promise<string | null> {
  const contest = contestOf(getDB());
  if (REMOTE) {
    const { data, error } = await client().functions.invoke<AccountsReply>('accounts', { body: { action: 'remove_staff', contest_id: contest.id, user_id: userId, role } });
    if (error) return error.message;
    if (data?.error) return data.error;
    const { reload } = await import('./remote/live');
    void reload();
    return null;
  }
  update((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u) Object.assign(u, { role: 'guest', roundIds: undefined, roomId: undefined });
    for (const r of contestOf(d).rooms) if (r.proctorId === userId) r.proctorId = undefined;
  });
  return null;
}
