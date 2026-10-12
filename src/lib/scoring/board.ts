/**
 * The live Guts board: what the projector and the test portal show while the
 * round runs. Pure, like the rest of scoring.
 *
 * A set counts once it is handed in (online) or keyed (paper). In the last
 * minutes the board freezes: it keeps showing only sets handed in before the
 * freeze, so the finish is a reveal at the awards, until the director reveals.
 */
import type { Attempt, Contest, Round, Ruling, Team } from '../model';
import { gradeAnswer, indexRulings } from './answers';

export type BoardRow = {
  team: Team;
  score: number;
  /** Sets counted on the board. */
  sets: number;
  /** The set they are working on now, or null when finished or not started. */
  current: number | null;
  started: boolean;
  place: number | null;
  tied: boolean;
  lastSetAt: string | null;
};

export type Board = {
  round: Round;
  rows: BoardRow[];
  totalSets: number;
  frozen: boolean;
  freezeAt: number | null;
  endsAt: number | null;
};

export function gutsRound(contest: Contest): Round | undefined {
  return contest.rounds.find((r) => r.kind === 'guts');
}

export function buildBoard(input: {
  contest: Contest;
  teams: Team[];
  attempts: Attempt[];
  rulings: Ruling[];
  divisionId: string | 'all';
  now: number;
}): Board | null {
  const { contest, teams, attempts, rulings, divisionId, now } = input;
  const round = gutsRound(contest);
  if (!round) return null;
  const ri = indexRulings(rulings);
  const totalSets = Math.max(1, ...round.problems.map((p) => p.set ?? 1));
  const opened = round.openedAt ? new Date(round.openedAt).getTime() : null;
  const endsAt = opened !== null ? opened + round.minutes * 60000 : null;
  const freezeAt = endsAt !== null && contest.board.freezeMinutes > 0 ? endsAt - contest.board.freezeMinutes * 60000 : null;
  const frozen = !contest.board.revealed && freezeAt !== null && now >= freezeAt;
  const cutoff = frozen ? freezeAt! : now;

  const rows: BoardRow[] = teams
    .filter((t) => t.contestId === contest.id && t.status !== 'withdrawn' && !t.disqualified && (divisionId === 'all' || t.divisionId === divisionId))
    .map((team) => {
      const a = attempts.find((x) => x.roundId === round.id && x.entrantId === team.id);
      const times = a?.setTimes ?? [];
      let sets = 0;
      while (sets < times.length && new Date(times[sets]).getTime() <= cutoff) sets++;
      let score = 0;
      if (a) {
        for (const p of round.problems) {
          if ((p.set ?? 1) > sets) continue;
          if (gradeAnswer(p, a.responses[p.id]?.value, ri) === 'correct') score += p.points;
        }
      }
      const started = !!a && (a.source === 'paper' || !!a.startedAt);
      return {
        team,
        score,
        sets,
        current: started && sets < totalSets ? sets + 1 : null,
        started,
        place: null,
        tied: false,
        lastSetAt: sets ? times[sets - 1] : null,
      };
    });

  // Highest score first; on equal scores, more sets handed in, then whoever got there first.
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.sets - a.sets ||
      (a.lastSetAt ?? '~').localeCompare(b.lastSetAt ?? '~') ||
      a.team.code.localeCompare(b.team.code),
  );
  // Places on score alone, shared on ties. A team still on 0 has no place yet.
  rows.forEach((r, i) => {
    if (r.score === 0) return;
    const prev = rows[i - 1];
    r.place = prev && prev.score === r.score ? prev.place : i + 1;
  });
  rows.forEach((r) => {
    r.tied = r.place !== null && rows.filter((x) => x.place === r.place).length > 1;
  });
  return { round, rows, totalSets, frozen, freezeAt, endsAt };
}
