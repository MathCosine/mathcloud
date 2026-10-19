/**
 * Keeping the connected app current without spending the free plan:
 *
 *  - One full load at sign-in, and again only when switching contest or
 *    coming back to a tab that has been hidden for a few minutes.
 *  - While the tab is open, realtime messages carry each changed row, and
 *    that row is patched into the copy here. Nothing is refetched.
 *  - The realtime channel listens to one contest, filtered by contest or
 *    round where the database allows it; row level security filters the rest.
 */
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { getDB, replaceDB, setActiveContest as storeSetActive, setReady, setSession, update, emptyDB, activeContestId } from '../store';
import { setContestSwitchHook } from '../store-hooks';
import { client, sb } from './client';
import { loadAll } from './load';
import { contestFlags, mapAttempt, mapClarification, mapCompetitor, mapEvent, mapResponse, mapResult, mapRows, mapTeam, roundFields, type Row } from './map';

let uid: string | null = null;
let email: string | null = null;
let channel: RealtimeChannel | null = null;
let loadedAt = 0;
let loading: Promise<void> | null = null;

// ------------------------------------------------------------------ errors

type ErrorListener = (title: string, detail: string) => void;
const errorListeners = new Set<ErrorListener>();
export function onRemoteError(l: ErrorListener) {
  errorListeners.add(l);
  return () => errorListeners.delete(l);
}
export function reportError(title: string, e: unknown) {
  const detail = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  errorListeners.forEach((l) => l(title, detail));
}

// ------------------------------------------------------------------- loading

/** Load (or reload) everything for the signed-in person, for one contest. */
export function reload(contestId: string | null = activeContestId() || null): Promise<void> {
  if (!uid) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const { rows, contestId: active } = await loadAll(uid!, email, contestId);
      replaceDB(mapRows(rows));
      if (active) storeSetActive(active, { load: false });
      loadedAt = Date.now();
      subscribe(active);
    } catch (e) {
      reportError('Could not load', e);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Reload soon, once, however many times it is asked for. */
let soon: ReturnType<typeof setTimeout> | null = null;
export function reloadSoon(ms = 1500) {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    void reload();
  }, ms);
}

let pending: Promise<void> = Promise.resolve();

/** Load for whoever is signed in now. A second call for the same person waits for the first load instead of skipping it. */
function signedIn(session: Session | null): Promise<void> {
  const next = session?.user?.id ?? null;
  if (next === uid) return pending;
  pending = load(session, next);
  return pending;
}

async function load(session: Session | null, next: string | null) {
  uid = next;
  email = session?.user?.email ?? null;
  if (!uid) {
    channel?.unsubscribe();
    channel = null;
    replaceDB(emptyDB());
    setSession(null);
    return;
  }
  await reload(null);
  setSession(uid);
}

/** Start the connected app: restore the session, load, and follow sign-ins and sign-outs. */
let booted: Promise<void> | null = null;

export function boot(): Promise<void> {
  booted ??= start();
  return booted;
}

async function start() {
  const sbc = client();
  setContestSwitchHook((id) => {
    setReady(false);
    void reload(id).then(() => setReady(true));
  });
  const { data } = await sbc.auth.getSession();
  await signedIn(data.session);
  setReady(true);
  sbc.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') void signedIn(session);
  });
  // A tab left in the background for a while may have missed changes
  // (realtime pauses with it). Catch up once when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && uid && Date.now() - loadedAt > 3 * 60 * 1000) void reload();
  });
}

// ------------------------------------------------------------------ realtime

function subscribe(contestId: string | null) {
  channel?.unsubscribe();
  channel = null;
  if (!sb || !contestId) return;
  const contest = getDB().contests.find((c) => c.id === contestId);
  const roundIds = contest?.rounds.map((r) => r.id) ?? [];
  const inRounds = roundIds.length ? `round_id=in.(${roundIds.join(',')})` : undefined;
  const ch = sb.channel(`contest-${contestId}`);
  const on = (table: string, filter?: string) =>
    ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (p) => patch(table, p.eventType, p.new as Row, p.old as Row));
  on('contests', `id=eq.${contestId}`);
  on('rounds', `contest_id=eq.${contestId}`);
  on('teams', `contest_id=eq.${contestId}`);
  on('results', `contest_id=eq.${contestId}`);
  if (inRounds) {
    on('attempts', inRounds);
    on('clarifications', inRounds);
  }
  // No contest column to filter on: row level security limits these to rows
  // this person may see, and rows from elsewhere are ignored below.
  on('competitors');
  on('responses');
  on('integrity_events');
  on('rulings');
  ch.subscribe();
  channel = ch;
}

const nameOf = (id?: string | null) => (id ? getDB().users.find((u) => u.id === id)?.name : undefined);

/** Apply one changed row to the copy here. Unknown parents mean a reload, later. */
function patch(table: string, type: string, row: Row, old: Row) {
  const db = getDB();
  const del = type === 'DELETE';
  update((d) => {
    switch (table) {
      case 'contests': {
        const c = d.contests.find((x) => x.id === row.id);
        if (c && !del) Object.assign(c, contestFlags(row), { name: row.name, short: row.short_name, timeZone: row.time_zone });
        if (c && !del && row.recipe?.teamIndividual) c.recipe = row.recipe;
        if (c && !del && row.venue && c.venue) Object.assign(c.venue, { name: row.venue.name ?? '', address: row.venue.address ?? '', hall: row.venue.hall ?? '', bring: row.venue.bring ?? [] });
        break;
      }
      case 'rounds': {
        const c = d.contests.find((x) => x.id === (row.contest_id ?? old.contest_id));
        const i = c?.rounds.findIndex((r) => r.id === (row.id ?? old.id)) ?? -1;
        if (!c) break;
        if (del) c.rounds = c.rounds.filter((r) => r.id !== old.id);
        else if (i >= 0) Object.assign(c.rounds[i], roundFields(row));
        else reloadSoon();
        break;
      }
      case 'teams': {
        const i = d.teams.findIndex((t) => t.id === (row.id ?? old.id));
        if (del) d.teams = d.teams.filter((t) => t.id !== old.id);
        else if (i >= 0) d.teams[i] = { ...mapTeam(row), contactName: row.contact_name ?? d.teams[i].contactName, contactEmail: row.contact_email ?? d.teams[i].contactEmail };
        else d.teams.push(mapTeam(row));
        break;
      }
      case 'competitors': {
        const i = d.competitors.findIndex((c) => c.id === (row.id ?? old.id));
        if (del) d.competitors = d.competitors.filter((c) => c.id !== old.id);
        else if (i >= 0) d.competitors[i] = mapCompetitor(row);
        else if (d.teams.some((t) => t.id === row.team_id)) d.competitors.push(mapCompetitor(row));
        break;
      }
      case 'attempts': {
        const i = d.attempts.findIndex((a) => a.id === (row.id ?? old.id));
        if (del) d.attempts = d.attempts.filter((a) => a.id !== old.id);
        else if (i >= 0) d.attempts[i] = { ...mapAttempt(row), responses: d.attempts[i].responses, events: d.attempts[i].events };
        else d.attempts.push(mapAttempt(row));
        break;
      }
      case 'responses': {
        const a = d.attempts.find((x) => x.id === (row.attempt_id ?? old.attempt_id));
        if (!a) {
          if (!del && db.contests.some((c) => c.rounds.length)) reloadSoon(4000);
          break;
        }
        if (del) delete a.responses[old.problem_id];
        else a.responses[row.problem_id] = mapResponse(row);
        break;
      }
      case 'integrity_events': {
        const a = d.attempts.find((x) => x.id === row.attempt_id);
        if (a && !del && !a.events.some((e) => e.at === row.at && e.kind === row.kind)) {
          a.events.push(mapEvent(row, nameOf));
          a.events.sort((x, y) => x.at.localeCompare(y.at));
        }
        break;
      }
      case 'rulings': {
        const pid = row.problem_id ?? old.problem_id;
        const round = d.contests.flatMap((c) => c.rounds).find((r) => r.problems.some((p) => p.id === pid));
        if (!round) break;
        d.rulings = d.rulings.filter((r) => !(r.problemId === pid && r.normalized === (row.normalized ?? old.normalized)));
        if (!del) d.rulings.push({ roundId: round.id, problemId: pid, normalized: row.normalized, correct: row.correct, by: nameOf(row.ruled_by) ?? '', at: row.ruled_at });
        break;
      }
      case 'clarifications': {
        const i = d.clarifications.findIndex((q) => q.id === (row.id ?? old.id));
        if (del) d.clarifications = d.clarifications.filter((q) => q.id !== old.id);
        else if (i >= 0) d.clarifications[i] = mapClarification(row);
        else d.clarifications.push(mapClarification(row));
        break;
      }
      case 'results': {
        const key = (r: { competitorId?: string; teamId?: string }) => r.competitorId ?? r.teamId;
        const id = row.competitor_id ?? row.team_id ?? old.competitor_id ?? old.team_id;
        d.results = (d.results ?? []).filter((r) => key(r) !== id);
        if (!del) d.results.push(mapResult(row));
        if (del && !old.competitor_id && !old.team_id) reloadSoon();
        break;
      }
    }
  });
}

export const currentUid = () => uid;
