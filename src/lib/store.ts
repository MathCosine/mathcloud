/**
 * The demo store: the whole database as one object in the browser.
 *
 * It persists to localStorage when the browser allows it and broadcasts every
 * change to other tabs, so a student in one tab and a proctor in another see
 * each other live. When the app is wired to Supabase, the actions in
 * actions.ts become RPC calls and this file becomes a cache; the screens do
 * not change.
 */
import { useSyncExternalStore } from 'react';
import type { DB } from './model';
import { buildDemo, type Moment } from './demo/seed';

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
    /* private window or blocked storage: the demo still runs, in memory */
  }
}

function load(): DB {
  const raw = storageGet(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.schema === 4 && Date.now() - new Date(parsed.seededAt).getTime() < 4 * 3600 * 1000) return parsed;
      if (parsed.schema === 4) return buildDemo(parsed.moment);
    } catch {
      /* fall through to a fresh demo */
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
const DEFAULT_CONTEST = 'sfmo-2027';
let activeContest: string = (() => {
  try {
    return sessionStorage.getItem(CONTEST_KEY) ?? DEFAULT_CONTEST;
  } catch {
    return DEFAULT_CONTEST;
  }
})();

export const activeContestId = () => (db.contests.some((c) => c.id === activeContest) ? activeContest : DEFAULT_CONTEST);

export function setActiveContest(id: string) {
  if (id === activeContest) return;
  activeContest = id;
  try {
    sessionStorage.setItem(CONTEST_KEY, id);
  } catch {
    /* this tab only */
  }
  emit();
}

/**
 * The database as one contest sees it: its teams, their people, its rounds'
 * attempts. Screens read this; actions write to the whole database. The real
 * app gets the same effect from row level security and a contest filter.
 */
let view: { v: number; c: string; db: DB } | null = null;
function scoped(): DB {
  const c = activeContestId();
  if (view && view.v === version && view.c === c) return view.db;
  const contest = db.contests.find((x) => x.id === c)!;
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

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mathcloud-demo') : null;
let persistQueued = false;

function persist() {
  if (persistQueued) return;
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

/** Change the database. Every screen re-renders and other tabs follow. */
export function update(fn: (draft: DB) => void) {
  fn(db);
  emit();
  persist();
}

export function loadMoment(moment: Moment) {
  db = buildDemo(moment);
  activeContest = DEFAULT_CONTEST;
  try {
    sessionStorage.setItem(CONTEST_KEY, DEFAULT_CONTEST);
  } catch {
    /* this tab only */
  }
  emit();
  persist();
}

// ---------------------------------------------------------------- session

/** Per tab, so one tab can be the director and another a student. */
const SESSION_KEY = 'mathcloud-session';
let sessionUserId: string | null = (() => {
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
  try {
    if (userId) sessionStorage.setItem(SESSION_KEY, userId);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* in-memory session only */
  }
  sessionListeners.forEach((l) => l());
}
