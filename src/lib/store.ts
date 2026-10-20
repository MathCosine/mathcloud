/**
 * The app's copy of the database: one object every screen reads.
 *
 * Two ways to fill it:
 *  - Connected (VITE_SUPABASE_URL is set): it is a cache of what Supabase lets
 *    this person see, loaded at sign-in and refreshed on realtime changes.
 *    Actions change it at once for a snappy screen and send the same change
 *    to the database, which has the final say (see remote/).
 *  - Sandbox (no Supabase configured): a made-up SFMO lives in the browser,
 *    saved to localStorage and shared between tabs, for development and for
 *    trying the app with nothing to set up.
 */
import { useSyncExternalStore } from 'react';
import type { DB } from './model';
import { buildDemo, type Moment } from './demo/seed';
import { contestSwitched } from './store-hooks';

/** Connected to a Supabase project, rather than the in-browser sandbox. */
export const REMOTE = !!import.meta.env.VITE_SUPABASE_URL;

const KEY = 'mathcloud-demo-v1';
const tabId = Math.random().toString(36).slice(2);

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the sandbox still runs, in memory */
  }
}

export function emptyDB(): DB {
  return {
    schema: 6, gen: 'remote', moment: 'live', seededAt: new Date().toISOString(),
    orgs: [], users: [], contests: [], teams: [], competitors: [], attempts: [], rulings: [],
    clarifications: [], templates: [], sends: [], activity: [], results: [],
  };
}

function load(): DB {
  if (REMOTE) return emptyDB();
  const raw = storageGet(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.schema === 6 && Date.now() - new Date(parsed.seededAt).getTime() < 4 * 3600 * 1000) return parsed;
      if (parsed.schema === 6 && parsed.moment !== 'live') return buildDemo(parsed.moment);
    } catch {
      /* fall through to a fresh sandbox */
    }
  }
  return buildDemo('guts');
}

let db: DB = load();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

// --------------------------------------------------------- active contest

/**
 * Which contest this tab is looking at. Per tab, like the session, so a
 * director can set up a new contest while another tab runs SFMO.
 */
const CONTEST_KEY = 'mathcloud-contest';
let activeContest: string | null = (() => {
  try {
    return sessionStorage.getItem(CONTEST_KEY);
  } catch {
    return null;
  }
})();

export const activeContestId = (): string =>
  activeContest && db.contests.some((c) => c.id === activeContest) ? activeContest : (db.contests.find((c) => c.id === 'sfmo-2027') ?? db.contests[0])?.id ?? '';

/** Look at another contest. Connected, its detail is fetched (pass load: false when it already has been). */
export function setActiveContest(id: string, opts: { load?: boolean } = {}) {
  if (id === activeContest) return;
  activeContest = id;
  try {
    sessionStorage.setItem(CONTEST_KEY, id);
  } catch {
    /* this tab only */
  }
  emit();
  if (REMOTE && opts.load !== false) contestSwitched(id);
}

/**
 * The database as one contest sees it: its teams, their people, its rounds'
 * attempts. Screens read this; actions write to the whole database. Connected,
 * row level security has already cut it down to what this person may see.
 */
let view: { v: number; c: string; db: DB } | null = null;
function scoped(): DB {
  const c = activeContestId();
  if (view && view.v === version && view.c === c) return view.db;
  const contest = db.contests.find((x) => x.id === c);
  if (!contest) {
    view = { v: version, c, db };
    return db;
  }
  const teams = db.teams.filter((t) => t.contestId === c);
  const teamIds = new Set(teams.map((t) => t.id));
  const roundIds = new Set(contest.rounds.map((r) => r.id));
  const out: DB = {
    ...db,
    teams,
    competitors: db.competitors.filter((x) => teamIds.has(x.teamId)),
    attempts: db.attempts.filter((a) => roundIds.has(a.roundId)),
    rulings: db.rulings.filter((r) => roundIds.has(r.roundId)),
    clarifications: db.clarifications.filter((x) => roundIds.has(x.roundId)),
    activity: db.activity.filter((a) => !a.teamId || teamIds.has(a.teamId)),
    results: (db.results ?? []).filter((r) => (r.teamId ? teamIds.has(r.teamId) : db.competitors.some((x) => x.id === r.competitorId && teamIds.has(x.teamId)))),
  };
  view = { v: version, c, db: out };
  return out;
}

/** Re-render on any change; read whatever you need from the returned db (this contest only). */
export function useDB(): DB {
  useSyncExternalStore(subscribe, getVersion);
  return scoped();
}

/** Every contest at once: the contest switcher, a coach with teams in several contests. */
export function useAllDB(): DB {
  useSyncExternalStore(subscribe, getVersion);
  return db;
}

export function useVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}

export function getDB(): DB {
  return db;
}

// ------------------------------------------------------------ persistence

const channel: BroadcastChannel | null = !REMOTE && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mathcloud-demo') : null;
let persistQueued = false;

function persist() {
  if (REMOTE || persistQueued) return;
  persistQueued = true;
  queueMicrotask(() => {
    persistQueued = false;
    storageSet(KEY, JSON.stringify(db));
    channel?.postMessage({ from: tabId, db });
  });
}

channel?.addEventListener('message', (e: MessageEvent<{ from: string; db: DB }>) => {
  if (e.data?.from === tabId || !e.data?.db) return;
  db = mergeIncoming(db, e.data.db);
  emit();
});

/**
 * Two tabs can write within the same few milliseconds (a student saving while
 * the director's tab simulates other competitors). Take the incoming copy,
 * but keep any answer, event or question this tab has that is newer.
 */
function mergeIncoming(local: DB, incoming: DB): DB {
  if (local.schema !== incoming.schema || local.gen !== incoming.gen) return incoming;
  const byId = new Map(incoming.attempts.map((a) => [a.id, a]));
  for (const mine of local.attempts) {
    const theirs = byId.get(mine.id);
    if (!theirs) {
      if (mine.startedAt && Date.now() - new Date(mine.startedAt).getTime() < 10000) incoming.attempts.push(mine);
      continue;
    }
    for (const [pid, r] of Object.entries(mine.responses)) {
      const t = theirs.responses[pid];
      if (!t || r.savedAt > t.savedAt) theirs.responses[pid] = r;
    }
    const seen = new Set(theirs.events.map((ev) => ev.at + ev.kind));
    for (const ev of mine.events) if (!seen.has(ev.at + ev.kind)) theirs.events.push(ev);
    theirs.events.sort((a, b) => a.at.localeCompare(b.at));
    if ((mine.setsSubmitted ?? 0) > (theirs.setsSubmitted ?? 0)) {
      theirs.setsSubmitted = mine.setsSubmitted;
      theirs.setTimes = mine.setTimes;
    }
    if (mine.submittedAt && !theirs.submittedAt) theirs.submittedAt = mine.submittedAt;
  }
  const clar = new Set(incoming.clarifications.map((c) => c.id));
  for (const c of local.clarifications) if (!clar.has(c.id)) incoming.clarifications.push(c);
  return incoming;
}

/** Change the database. Every screen re-renders and (in the sandbox) other tabs follow. */
export function update(fn: (draft: DB) => void) {
  fn(db);
  emit();
  persist();
}

/** Connected: swap in a fresh copy from Supabase. */
export function replaceDB(next: DB) {
  db = next;
  emit();
}

export function loadMoment(moment: Moment) {
  db = buildDemo(moment);
  activeContest = null;
  try {
    sessionStorage.removeItem(CONTEST_KEY);
  } catch {
    /* this tab only */
  }
  emit();
  persist();
}

// ---------------------------------------------------------------- session

/** Per tab in the sandbox, so one tab can be the director and another a student. Connected, it follows Supabase Auth. */
const SESSION_KEY = 'mathcloud-session';
let sessionUserId: string | null = (() => {
  if (REMOTE) return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
})();
const sessionListeners = new Set<() => void>();

export function useSessionUserId(): string | null {
  return useSyncExternalStore(
    (l) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    },
    () => sessionUserId,
  );
}

export function setSession(userId: string | null) {
  sessionUserId = userId;
  if (!REMOTE) {
    try {
      if (userId) sessionStorage.setItem(SESSION_KEY, userId);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* in-memory session only */
    }
  }
  sessionListeners.forEach((l) => l());
}

// ------------------------------------------------------------- boot state

/** Connected: has the first load finished? The sandbox is always ready. */
let ready = !REMOTE;
const readyListeners = new Set<() => void>();
export function setReady(v: boolean) {
  ready = v;
  readyListeners.forEach((l) => l());
}
export function useReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      readyListeners.add(l);
      return () => readyListeners.delete(l);
    },
    () => ready,
  );
}
