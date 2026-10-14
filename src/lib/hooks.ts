import { useEffect, useMemo, useRef, useState } from 'react';
import { contestOf } from './actions';
import * as W from './remote/write';
import { boardFromServer, buildBoard, gutsRound, type ServerBoardRow } from './scoring/board';
import { computeStandings, type Standings } from './scoring/engine';
import { useUser } from './session';
import { REMOTE, useDB, useVersion } from './store';
import { roundState } from './time';

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

/**
 * The live Guts board for a division ('all' for both), recomputed as data and the clock move.
 *
 * Connected, a student or coach cannot see other teams' answers, so their
 * board comes from the database (guts_board()), asked every 15 seconds while
 * the Guts round is open and the tab is in view. Organisers, and the sandbox,
 * compute it here from the answers they already have.
 */
export function useBoard(divisionId: string | 'all', now: number) {
  const db = useDB();
  const v = useVersion();
  const user = useUser();
  const second = Math.floor(now / 1000);
  const contest = contestOf(db);
  const staff = !!user && ['director', 'staff', 'grader', 'proctor'].includes(user.role);
  const fromServer = REMOTE && !staff;
  const round = contest ? gutsRound(contest) : undefined;
  const state = round ? roundState(round, now) : 'scheduled';
  const roundId = fromServer && round && state !== 'scheduled' ? round.id : null;
  const live = state === 'open';
  const [served, setServed] = useState<{ roundId: string; rows: ServerBoardRow[] } | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!roundId) return;
    let alive = true;
    const fetchBoard = async (force = false) => {
      if (document.visibilityState !== 'visible') return;
      if (!force && Date.now() - last.current < 14500) return;
      last.current = Date.now();
      const r = await W.gutsBoard(roundId);
      if (alive && !r.error && r.data) setServed({ roundId, rows: r.data as unknown as ServerBoardRow[] });
    };
    // Once on arrival (a closed round still shows its last board), then every 15 s while it runs.
    void fetchBoard(true);
    if (!live) return () => void (alive = false);
    const timer = setInterval(() => void fetchBoard(), 15000);
    const onVisible = () => void fetchBoard();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [roundId, live]);

  return useMemo(
    () => {
      if (!fromServer) return buildBoard({ contest, teams: db.teams, attempts: db.attempts, rulings: db.rulings, divisionId, now });
      if (!served || served.roundId !== round?.id) return null;
      return boardFromServer(contest, served.rows, divisionId, now);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, divisionId, second, fromServer, served],
  );
}
