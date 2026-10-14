/**
 * The contest's own details: name, short name, date, time zone and public
 * address. Applied here at once; connected, sent when the typing stops.
 */
import { contestOf } from './actions';
import type { Contest } from './model';
import * as W from './remote/write';
import { getDB, REMOTE, update } from './store';

export type ContestBasics = Pick<Contest, 'name' | 'short' | 'dateLabel' | 'timeZone'>;

let timer: ReturnType<typeof setTimeout> | null = null;

export function saveContestBasics(patch: Partial<ContestBasics>) {
  update((db) => {
    Object.assign(contestOf(db), patch);
  });
  if (!REMOTE) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void W.saveContestBasics(contestOf(getDB()));
  }, 700);
}

/** Lower-case letters, digits and single hyphens; 3 to 60 characters. */
export function slugProblem(slug: string, contestId: string): string | null {
  if (slug.length < 3) return 'At least 3 characters.';
  if (slug.length > 60) return 'At most 60 characters.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Use lower-case letters, digits and hyphens, like sfmo-2027.';
  if (getDB().contests.some((c) => c.id !== contestId && c.slug === slug)) return 'Another contest already uses this address.';
  return null;
}

export const toSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Change the public address. Resolves to an error, or null. */
export async function saveSlug(slug: string): Promise<string | null> {
  const c = contestOf(getDB());
  const why = slugProblem(slug, c.id);
  if (why) return why;
  if (REMOTE) {
    const { client } = await import('./remote/client');
    const { error } = await client().from('contests').update({ slug }).eq('id', c.id);
    if (error) return /duplicate|unique/i.test(error.message) ? 'Another contest already uses this address.' : error.message;
  }
  update((db) => {
    contestOf(db, c.id).slug = slug;
  });
  return null;
}
