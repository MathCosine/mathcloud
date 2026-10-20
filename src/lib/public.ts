/**
 * Helpers for the public and account pages: the demo accounts shown on the
 * front page and the sign-in page, and the few reads and writes those pages
 * make on their own (a contest page for someone signed out, open contests
 * for a new coach, a new name or password).
 */
import type { Contest, DB, DivisionMode } from './model';
import { REMOTE, update } from './store';
import { client } from './remote/client';
import { dateLabelOf, emptyRows, mapRows, type Row } from './remote/map';

// ------------------------------------------------------------ demo accounts

/** Connected: show the seeded demo accounts (scripts/seed.ts) on the front page and the sign-in page. */
export const SHOW_DEMO = !REMOTE || !!import.meta.env.VITE_SHOW_DEMO_ACCOUNTS;

/** The password scripts/seed.ts gives every demo account when connected; the sandbox's is "demo". */
export const DEMO_PASSWORD: string = REMOTE ? (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) || 'mathcloud-demo' : 'demo';

export type DemoAccount = {
  /** The sandbox user id (src/lib/demo/seed.ts). */
  id: string;
  /** What to type when connected: an email, or a username for students without one. */
  login: string;
  name: string;
  role: string;
  what: string;
  mode?: DivisionMode;
  group: 'staff' | 'in_person' | 'online';
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'u-director', login: 'director@mathcloud.test', name: 'Jordan Lee', role: 'Organiser', what: 'Sets up contests, imports teams, opens rounds, publishes results', group: 'staff' },
  { id: 'u-grader', login: 'grader@mathcloud.test', name: 'Sam Ortega', role: 'Grader', what: 'Keys paper answer sheets and rules on unusual answers', group: 'staff' },
  { id: 'u-proctor', login: 'proctor@mathcloud.test', name: 'Priya Nand', role: 'Proctor', what: 'Watches Zoom Room 1 and the integrity log', group: 'staff' },
  { id: 'u-coach', login: 'coach@mathcloud.test', name: 'Megan Hughes', role: 'Coach', what: 'Coaches teams 16 (online) and 21', group: 'online' },
  { id: 'u-c16A', login: 'student@mathcloud.test', name: 'Carter Hughes', role: 'Student', what: 'Team 16, online, takes rounds in the browser', mode: 'online', group: 'online' },
  { id: 'u-c16B', login: 'sfmo-16b', name: 'Valeria Ruiz', role: 'Student', what: 'Team 16, online, signs in with a username', mode: 'online', group: 'online' },
  { id: 'u-c05A', login: 'sfmo-05a', name: 'Hannah Kim', role: 'Student', what: 'Team 05, in person in San Francisco, signs in with a username', mode: 'in_person', group: 'in_person' },
];

/** The accounts that exist in this copy, with what to type to sign in as each. */
export function demoAccounts(db: DB): (DemoAccount & { signIn: string })[] {
  if (REMOTE) return DEMO_ACCOUNTS.map((a) => ({ ...a, signIn: a.login }));
  return DEMO_ACCOUNTS.flatMap((a) => {
    const u = db.users.find((x) => x.id === a.id);
    return u ? [{ ...a, name: u.name, signIn: u.email }] : [];
  });
}

// ------------------------------------------------------------------ reads

export type OpenContest = { id: string; name: string; short: string; slug: string; dateLabel: string; closesLabel: string };

/** Contests taking registrations, for a coach who has just signed up. Connected only. */
export async function fetchOpenContests(): Promise<{ contests: OpenContest[]; error: string | null }> {
  const { data, error } = await client()
    .from('contests')
    .select('id,name,short_name,slug,date_label,starts_on,registration')
    .eq('registration->>open', 'true')
    .order('starts_on', { ascending: true, nullsFirst: false })
    .limit(50);
  if (error) return { contests: [], error: error.message };
  const rows = (data ?? []) as Row[];
  return {
    error: null,
    contests: rows.map((c) => ({
      id: c.id, name: c.name, short: c.short_name, slug: c.slug,
      dateLabel: dateLabelOf(c),
      closesLabel: c.registration?.closes_label ?? '',
    })),
  };
}

/**
 * One contest's public page, for anyone: the contest row, its divisions,
 * rounds and schedule. Problems, rooms and teams are not public.
 */
export async function fetchPublicContest(slug: string): Promise<{ contest: Contest | null; orgName: string | null; error: string | null; twin?: { slug: string; mode: string } | null }> {
  const sb = client();
  const { data, error } = await sb
    .from('contests')
    .select('id,org_id,name,short_name,slug,time_zone,starts_on,date_label,registration,venue,board,results_published,linked_id')
    .eq('slug', slug)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { contest: null, orgName: null, error: error.message };
  const row = (data as Row[] | null)?.[0];
  if (!row) return { contest: null, orgName: null, error: null };
  const [divisions, rounds, agenda, org, twin] = await Promise.all([
    sb.from('divisions').select('id,contest_id,name,mode,detail').eq('contest_id', row.id),
    sb.from('rounds').select('id,contest_id,name,short_name,kind,minutes,starts_at,status,opened_at,grace_seconds,mystery,integrity,position').eq('contest_id', row.id),
    sb.from('agenda_items').select('*').eq('contest_id', row.id),
    sb.from('organizations').select('name').eq('id', row.org_id).maybeSingle(),
    // The other edition (online or in person, same time), for a link to its page.
    row.linked_id ? sb.from('contests').select('slug,divisions(mode)').eq('id', row.linked_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = twin.data as Row | null;
  const twinInfo = t ? { slug: String(t.slug), mode: String((t.divisions as Row[] | undefined)?.[0]?.mode ?? '') } : null;
  const err = divisions.error ?? rounds.error ?? agenda.error;
  if (err) return { contest: null, orgName: null, error: err.message };
  const db = mapRows({ ...emptyRows(), contests: [row], divisions: divisions.data ?? [], rounds: rounds.data ?? [], agenda_items: agenda.data ?? [] });
  return { contest: db.contests[0] ?? null, orgName: (org.data as Row | null)?.name ?? null, error: null, twin: twinInfo };
}

// ----------------------------------------------------------------- writes

/** A new display name, shown to organisers and on certificates. Connected only. */
export async function saveDisplayName(userId: string, name: string): Promise<string | null> {
  const clean = name.trim();
  if (clean.length < 2) return 'Type at least two letters.';
  const { error } = await client().from('profiles').update({ name: clean }).eq('id', userId);
  if (error) return error.message;
  update((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u) u.name = clean;
  });
  return null;
}

export async function changePassword(password: string): Promise<string | null> {
  if (password.length < 8) return 'Use at least 8 characters.';
  const { error } = await client().auth.updateUser({ password });
  return error?.message ?? null;
}

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
