/**
 * Simulated competitors, so the proctor dashboard and live boards move while
 * you watch. Runs only in staff tabs, only while a round is open, and never
 * touches the demo accounts' own team.
 */
import { useEffect } from 'react';
import { contestOf } from '../actions';
import type { Attempt, Round } from '../model';
import { getDB, update } from '../store';
import { roundEnds, roundState } from '../time';
import { DEMO_TEAM } from './seed';

function step() {
  const contest = contestOf(getDB());
  const open = contest.rounds.filter((r) => roundState(r) === 'open');
  if (!open.length) return;
  update((db) => {
    for (const round of open) {
      const onlineTeams = db.teams.filter((t) => t.divisionId === 'online' && t.status !== 'withdrawn' && t.id !== DEMO_TEAM);
      const entrants =
        round.kind === 'individual'
          ? db.competitors.filter((c) => onlineTeams.some((t) => t.id === c.teamId)).map((c) => c.id)
          : onlineTeams.map((t) => t.id);
      for (let k = 0; k < 3; k++) {
        const id = entrants[Math.floor(Math.random() * entrants.length)];
        if (!id) continue;
        let a = db.attempts.find((x) => x.roundId === round.id && x.entrantId === id);
        if (!a) {
          a = {
            id: `${round.id}:${id}`, roundId: round.id, entrantId: id, source: 'online', startedAt: new Date().toISOString(),
            deadline: new Date(roundEnds(round)!).toISOString(), responses: {}, events: [], honorName: 'simulated',
            ...(round.kind === 'guts' ? { setsSubmitted: 0 } : {}),
          };
          db.attempts.push(a);
          continue;
        }
        if (a.submittedAt || a.locked) continue;
        advance(round, a);
      }
    }
  });
}

function advance(round: Round, a: Attempt) {
  const now = new Date().toISOString();
  const available = round.kind === 'guts' ? round.problems.filter((p) => p.set === (a.setsSubmitted ?? 0) + 1) : round.problems;
  const next = available.find((p) => !(p.id in a.responses));
  if (Math.random() < 0.05) a.events.push({ at: now, kind: Math.random() < 0.5 ? 'hidden' : 'blur', ms: Math.round(2000 + Math.random() * 12000) });
  if (!next) {
    if (round.kind === 'guts') {
      a.setsSubmitted = (a.setsSubmitted ?? 0) + 1;
      if (a.setsSubmitted >= 6) a.submittedAt = now;
    }
    return;
  }
  const difficulty = round.kind === 'guts' ? (next.set! - 1) * 0.11 : round.kind === 'team' ? next.number * 0.08 : next.number * 0.035;
  const correct = Math.random() < 0.88 - difficulty;
  const key = next.answers[0].replace(/^\\frac\{(\d+)\}\{(\d+)\}$/, '$1/$2');
  const wrong = /^-?\d+$/.test(key) ? String(Number(key) + (Math.random() < 0.5 ? 1 : -1)) : '1/2';
  if (Math.random() < 0.1) a.responses[next.id] = { value: '', savedAt: now, by: 'sim' };
  else a.responses[next.id] = { value: correct ? key : wrong, savedAt: now, by: 'sim' };
}

export function useSimulation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(step, 3000);
    return () => clearInterval(id);
  }, [enabled]);
}
