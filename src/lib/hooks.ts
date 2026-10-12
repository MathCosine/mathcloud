import { useMemo } from 'react';
import { contestOf } from './actions';
import { buildBoard } from './scoring/board';
import { computeStandings, type Standings } from './scoring/engine';
import { useDB, useVersion } from './store';

export function useContest() {
  return contestOf(useDB());
}

/** Standings recomputed whenever anything changes. Cheap at contest scale. */
export function useStandings(): Standings {
  const db = useDB();
  const v = useVersion();
  return useMemo(
    () => computeStandings({ contest: contestOf(db), teams: db.teams, competitors: db.competitors, attempts: db.attempts, rulings: db.rulings }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v],
  );
}

export function useLookups() {
  const db = useDB();
  const v = useVersion();
  return useMemo(() => {
    const team = new Map(db.teams.map((t) => [t.id, t]));
    const competitor = new Map(db.competitors.map((c) => [c.id, c]));
    const user = new Map(db.users.map((u) => [u.id, u]));
    return { team, competitor, user };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** The live Guts board for a division ('all' for both), recomputed as data and the clock move. */
export function useBoard(divisionId: string | 'all', now: number) {
  const db = useDB();
  const v = useVersion();
  const second = Math.floor(now / 1000);
  return useMemo(
    () => buildBoard({ contest: contestOf(db), teams: db.teams, attempts: db.attempts, rulings: db.rulings, divisionId, now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, divisionId, second],
  );
}
