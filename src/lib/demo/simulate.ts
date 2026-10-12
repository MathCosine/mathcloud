/**
 * Simulated competitors, so proctoring, grading and the Guts board move while
 * you watch. One tab at a time runs it (the leader), so two open tabs do not
 * double the pace. It never touches the demo accounts' own team.
 */
import { useEffect } from 'react';
import { contestOf } from '../actions';
import type { Attempt, Problem, Round } from '../model';
import { getDB, update } from '../store';
import { roundEnds, roundState } from '../time';
import { DEMO_TEAM } from './seed';

const LEADER_KEY = 'mathcloud-sim-leader';
const tab = Math.random().toString(36).slice(2);

/** Claim or keep leadership; true when this tab should run the simulation. */
function lead(): boolean {
  try {
    const raw = localStorage.getItem(LEADER_KEY);
    const now = Date.now();
    const cur = raw ? (JSON.parse(raw) as { tab: string; at: number }) : null;
    if (!cur || cur.tab === tab || now - cur.at > 6000) {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ tab, at: now }));
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** A team's strength, stable for the whole demo. */
function strength(code: string) {
  let h = 7;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 0.45 + (h % 40) / 100;
}

function answer(p: Problem, chance: number) {
  const key = p.answers[0].replace(/^\\frac\{(\d+)\}\{(\d+)\}$/, '$1/$2');
  if (Math.random() < 0.08) return '';
  if (Math.random() < chance) return key;
  return /^-?\d+$/.test(key) ? String(Number(key) + (Math.random() < 0.5 ? 1 : -2)) : '1/2';
}

function step() {
  // The simulated competitors are SFMO's, whatever contest this tab is showing.
  const contest = contestOf(getDB(), 'sfmo-2027');
  const open = contest.rounds.filter((r) => roundState(r) === 'open');
  if (!open.length) return;
  update((db) => {
    const now = new Date().toISOString();
    for (const round of open) {
      const live = db.teams.filter((t) => t.contestId === contest.id && t.status !== 'withdrawn' && t.id !== DEMO_TEAM);
      if (round.kind === 'guts') {
        // Every team, both divisions: online teams hand in sets, graders key paper ones.
        const moving = live.filter(() => Math.random() < 0.035);
        for (const t of moving) gutsSet(round, db.attempts, t.id, t.divisionId === 'online' ? 'online' : 'paper', strength(t.code), now);
        continue;
      }
      const onlineTeams = live.filter((t) => t.divisionId === 'online');
      const entrants =
        round.kind === 'individual' ? db.competitors.filter((c) => onlineTeams.some((t) => t.id === c.teamId)).map((c) => c.id) : onlineTeams.map((t) => t.id);
      for (let k = 0; k < 3; k++) {
        const id = entrants[Math.floor(Math.random() * entrants.length)];
        if (!id) continue;
        let a = db.attempts.find((x) => x.roundId === round.id && x.entrantId === id);
        if (!a) {
          a = { id: `${round.id}:${id}`, roundId: round.id, entrantId: id, source: 'online', startedAt: now, deadline: new Date(roundEnds(round)!).toISOString(), responses: {}, events: [], honorName: 'simulated' };
          db.attempts.push(a);
          continue;
        }
        if (a.submittedAt || a.locked) continue;
        const next = round.problems.find((p) => !(p.id in a.responses));
        if (Math.random() < 0.05) a.events.push({ at: now, kind: Math.random() < 0.5 ? 'hidden' : 'blur', ms: Math.round(2000 + Math.random() * 12000) });
        if (next) a.responses[next.id] = { value: answer(next, 0.85 - next.number * 0.03), savedAt: now, by: 'sim' };
      }
    }
  });
}

function gutsSet(round: Round, attempts: Attempt[], teamId: string, source: 'online' | 'paper', skill: number, now: string) {
  let a = attempts.find((x) => x.roundId === round.id && x.entrantId === teamId);
  if (!a) {
    a = { id: `${round.id}:${teamId}`, roundId: round.id, entrantId: teamId, source, responses: {}, events: [], setsSubmitted: 0, setTimes: [], ...(source === 'online' ? { startedAt: now, deadline: new Date(roundEnds(round)!).toISOString() } : {}) };
    attempts.push(a);
  }
  const sets = Math.max(...round.problems.map((p) => p.set ?? 1));
  const done = a.setsSubmitted ?? 0;
  if (done >= sets || a.submittedAt || a.locked) return;
  const setNo = done + 1;
  for (const p of round.problems.filter((x) => x.set === setNo)) {
    const v = answer(p, skill - (setNo - 1) * 0.07);
    if (v) a.responses[p.id] = { value: v, savedAt: now, by: source === 'paper' ? 'u-grader' : 'sim' };
  }
  a.setsSubmitted = setNo;
  a.setTimes = [...(a.setTimes ?? []), now];
  if (setNo >= sets) a.submittedAt = now;
}

export function useSimulation() {
  useEffect(() => {
    const id = setInterval(() => {
      if (lead()) step();
    }, 2500);
    return () => clearInterval(id);
  }, []);
}
