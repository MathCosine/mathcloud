/**
 * Scores, standings and awards. Pure functions over plain data: no DOM, no
 * network, no store. Every number the results pages show comes from here, and
 * every number carries the arithmetic that produced it.
 */
import type { Attempt, AwardRule, Competitor, Contest, Problem, Round, Ruling, Team } from '../model';
import { gradeAnswer, indexRulings, type GradeStatus, type RulingIndex } from './answers';

export type ProblemResult = { problemId: string; number: number; set?: number; status: GradeStatus; points: number; max: number };

export type RoundScore = {
  roundId: string;
  entrantId: string;
  score: number;
  max: number;
  results: ProblemResult[];
  unreviewed: number;
};

export function roundMax(round: Round): number {
  return round.problems.reduce((sum, p) => sum + p.points, 0);
}

export function scoreAttempt(round: Round, attempt: Attempt, rulings: RulingIndex): RoundScore {
  let score = 0;
  let unreviewed = 0;
  const results = round.problems.map((p: Problem): ProblemResult => {
    const status = gradeAnswer(p, attempt.responses[p.id]?.value, rulings);
    if (status === 'unreviewed') unreviewed++;
    const points = status === 'correct' ? p.points : 0;
    score += points;
    return { problemId: p.id, number: p.number, set: p.set, status, points, max: p.points };
  });
  return { roundId: round.id, entrantId: attempt.entrantId, score, max: roundMax(round), results, unreviewed };
}

// ---------------------------------------------------------------- ranking

/**
 * Standard competition ranking: equal keys share a place and the next place
 * skips (1, 1, 3). `sameKey` decides equality; rows must already be sorted.
 */
export function assignPlaces<T>(sorted: T[], sameKey: (a: T, b: T) => boolean): { row: T; place: number; tied: number }[] {
  const out: { row: T; place: number; tied: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const place = i > 0 && sameKey(sorted[i - 1], sorted[i]) ? out[i - 1].place : i + 1;
    out.push({ row: sorted[i], place, tied: 0 });
  }
  const counts = new Map<number, number>();
  for (const r of out) counts.set(r.place, (counts.get(r.place) ?? 0) + 1);
  for (const r of out) r.tied = (counts.get(r.place) ?? 1) - 1;
  return out;
}

/** Which award, if any, a place earns. Rules are tried in order; the first that fits wins. */
export function awardFor(place: number, field: number, rules: AwardRule[]): string | undefined {
  for (const r of rules) {
    const cutoff = r.rule === 'top_n' ? r.value : Math.ceil((field * r.value) / 100);
    if (place <= cutoff) return r.label;
  }
  return undefined;
}

// --------------------------------------------------------------- standings

export type IndividualRow = {
  competitor: Competitor;
  team: Team;
  divisionId: string;
  score: number;
  max: number;
  results: ProblemResult[];
  place: number;
  tied: number;
  award?: string;
  /** Solve rates of the problems they solved, hardest first; the tiebreak key. */
  tiebreak: number[];
  brokeTie: boolean;
};

export type TeamPart = { roundId: string; label: string; raw: number; max: number; weight: number; weighted: number; detail: string };

export type TeamRow = {
  team: Team;
  divisionId: string;
  parts: TeamPart[];
  total: number;
  place: number;
  tied: number;
  award?: string;
};

export type ProblemStat = { problemId: string; number: number; set?: number; attempted: number; correct: number; rate: number };

export type Standings = {
  individuals: Record<string, IndividualRow[]>;
  teams: Record<string, TeamRow[]>;
  roundScores: Map<string, RoundScore>;
  problemStats: Record<string, Record<string, ProblemStat[]>>;
  unreviewed: Record<string, number>;
};

export type StandingsInput = {
  contest: Contest;
  teams: Team[];
  competitors: Competitor[];
  attempts: Attempt[];
  rulings: Ruling[];
};

const scoreKey = (roundId: string, entrantId: string) => `${roundId}|${entrantId}`;

export function computeStandings({ contest, teams, competitors, attempts, rulings }: StandingsInput): Standings {
  const ri = indexRulings(rulings);
  const rounds = new Map(contest.rounds.map((r) => [r.id, r]));
  const liveTeams = teams.filter((t) => t.contestId === contest.id && t.status !== 'withdrawn');
  const teamById = new Map(liveTeams.map((t) => [t.id, t]));

  const roundScores = new Map<string, RoundScore>();
  const unreviewed: Record<string, number> = {};
  for (const a of attempts) {
    const round = rounds.get(a.roundId);
    if (!round) continue;
    if (a.source === 'online' && !a.startedAt) continue;
    const s = scoreAttempt(round, a, ri);
    roundScores.set(scoreKey(a.roundId, a.entrantId), s);
    unreviewed[a.roundId] = (unreviewed[a.roundId] ?? 0) + s.unreviewed;
  }

  const individualRound = contest.rounds.find((r) => r.kind === 'individual');
  const individuals: Record<string, IndividualRow[]> = {};
  const teamsOut: Record<string, TeamRow[]> = {};
  const problemStats: Record<string, Record<string, ProblemStat[]>> = {};

  for (const division of contest.divisions) {
    const divTeams = liveTeams.filter((t) => t.divisionId === division.id);
    const divTeamIds = new Set(divTeams.map((t) => t.id));

    // Problem statistics per round, from everyone in the division who sat it.
    problemStats[division.id] = {};
    for (const round of contest.rounds) {
      const entrantIds =
        round.kind === 'individual'
          ? competitors.filter((c) => divTeamIds.has(c.teamId) && !c.disqualified).map((c) => c.id)
          : divTeams.filter((t) => !t.disqualified).map((t) => t.id);
      const scores = entrantIds.map((id) => roundScores.get(scoreKey(round.id, id))).filter((s): s is RoundScore => !!s);
      problemStats[division.id][round.id] = round.problems.map((p, i) => {
        const correct = scores.filter((s) => s.results[i].status === 'correct').length;
        return { problemId: p.id, number: p.number, set: p.set, attempted: scores.length, correct, rate: scores.length ? correct / scores.length : 0 };
      });
    }

    // Individuals.
    const rows: IndividualRow[] = [];
    if (individualRound) {
      const rate = new Map(problemStats[division.id][individualRound.id].map((s) => [s.problemId, s.rate]));
      for (const c of competitors) {
        const team = teamById.get(c.teamId);
        if (!team || team.divisionId !== division.id || c.disqualified || team.disqualified) continue;
        const s = roundScores.get(scoreKey(individualRound.id, c.id));
        if (!s) continue;
        const tiebreak = s.results.filter((r) => r.status === 'correct').map((r) => rate.get(r.problemId) ?? 1).sort((a, b) => a - b);
        rows.push({ competitor: c, team, divisionId: division.id, score: s.score, max: s.max, results: s.results, place: 0, tied: 0, tiebreak, brokeTie: false });
      }
    }
    const useTb = contest.recipe.harderFirst;
    const cmpTb = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    rows.sort((a, b) => b.score - a.score || (useTb ? cmpTb(a.tiebreak, b.tiebreak) : 0) || a.competitor.publicId.localeCompare(b.competitor.publicId));
    const placed = assignPlaces(rows, (a, b) => a.score === b.score && (!useTb || cmpTb(a.tiebreak, b.tiebreak) === 0));
    const indAwards = contest.recipe.awards.filter((r) => r.scope === 'individual');
    individuals[division.id] = placed.map(({ row, place, tied }, _i, all) => {
      const sameScore = all.filter((x) => x.row.score === row.score).length > 1;
      // Level on points but placed apart: the harder-problems rule decided it.
      return { ...row, place, tied, award: awardFor(place, all.length, indAwards), brokeTie: useTb && sameScore && tied === 0 };
    });

    // Teams.
    const teamRows: TeamRow[] = [];
    for (const team of divTeams) {
      if (team.disqualified) continue;
      const members = competitors.filter((c) => c.teamId === team.id);
      const parts: TeamPart[] = [];
      let took = false;
      for (const round of contest.rounds) {
        const weight = contest.recipe.weights[round.id] ?? 0;
        if (round.kind === 'individual') {
          const scored = members
            .filter((m) => !m.disqualified)
            .map((m) => ({ m, s: roundScores.get(scoreKey(round.id, m.id)) }))
            .filter((x): x is { m: Competitor; s: RoundScore } => !!x.s);
          if (scored.length) took = true;
          const part = teamIndividual(scored.map((x) => ({ id: x.m.publicId, score: x.s.score })), contest.recipe.teamIndividual, roundMax(round));
          parts.push({ roundId: round.id, label: round.short, raw: part.raw, max: part.max, weight, weighted: part.raw * weight, detail: part.detail });
        } else {
          const s = roundScores.get(scoreKey(round.id, team.id));
          if (s) took = true;
          const raw = s?.score ?? 0;
          parts.push({ roundId: round.id, label: round.short, raw, max: roundMax(round), weight, weighted: raw * weight, detail: s ? `${raw} of ${s.max}` : 'not taken' });
        }
      }
      if (!took) continue;
      teamRows.push({ team, divisionId: division.id, parts, total: round2(parts.reduce((n, p) => n + p.weighted, 0)), place: 0, tied: 0 });
    }
    teamRows.sort((a, b) => b.total - a.total || a.team.code.localeCompare(b.team.code));
    const teamAwards = contest.recipe.awards.filter((r) => r.scope === 'team');
    teamsOut[division.id] = assignPlaces(teamRows, (a, b) => a.total === b.total).map(({ row, place, tied }, _i, all) => ({
      ...row,
      place,
      tied,
      award: awardFor(place, all.length, teamAwards),
    }));
  }

  return { individuals, teams: teamsOut, roundScores, problemStats, unreviewed };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * A team's individual-round score from its members' scores, with the sum
 * written out: "15 + 14 + 12 = 41 (best 3 of 4)".
 */
export function teamIndividual(
  scores: { id: string; score: number }[],
  rule: Contest['recipe']['teamIndividual'],
  perPaperMax: number,
): { raw: number; max: number; counted: string[]; detail: string } {
  const filled = scores.slice();
  while (filled.length < rule.fillMissingTo) filled.push({ id: '—', score: 0 });
  const sorted = filled.sort((a, b) => b.score - a.score);
  if (rule.method === 'best') {
    const k = Math.min(rule.best, sorted.length);
    const top = sorted.slice(0, k);
    const raw = top.reduce((n, x) => n + x.score, 0);
    return { raw, max: perPaperMax * rule.best, counted: top.map((x) => x.id), detail: `${top.map((x) => x.score).join(' + ') || '0'} = ${raw} (best ${rule.best} of ${scores.length})` };
  }
  const sum = sorted.reduce((n, x) => n + x.score, 0);
  if (rule.method === 'average') {
    const raw = sorted.length ? round2(sum / sorted.length) : 0;
    return { raw, max: perPaperMax, counted: sorted.map((x) => x.id), detail: `(${sorted.map((x) => x.score).join(' + ')}) / ${sorted.length} = ${raw}` };
  }
  const n = Math.max(rule.fillMissingTo, sorted.length);
  return { raw: sum, max: perPaperMax * n, counted: sorted.map((x) => x.id), detail: `${sorted.map((x) => x.score).join(' + ') || '0'} = ${sum}` };
}

export type Distinct = { normalized: string; samples: string[]; count: number; status: GradeStatus; entrantIds: string[] };

/**
 * Every distinct answer to one problem, with how many gave it: the grading
 * screen rules on each once instead of on every paper.
 */
export function distinctAnswers(problem: Problem, attempts: Attempt[], rulings: Ruling[], normalizeFn: (raw: string) => string): Distinct[] {
  const ri = indexRulings(rulings);
  const groups = new Map<string, Distinct>();
  for (const a of attempts) {
    const raw = a.responses[problem.id]?.value;
    const n = normalizeFn(raw ?? '');
    if (!n) continue;
    let g = groups.get(n);
    if (!g) {
      g = { normalized: n, samples: [], count: 0, status: gradeAnswer(problem, raw, ri), entrantIds: [] };
      groups.set(n, g);
    }
    g.count++;
    g.entrantIds.push(a.entrantId);
    if (raw && !g.samples.includes(raw.trim()) && g.samples.length < 4) g.samples.push(raw.trim());
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Pairs of entrants sharing at least `min` wrong answers that few others gave.
 * Browser events miss a phone; identical rare mistakes do not.
 */
export function rareWrongCollisions(round: Round, attempts: Attempt[], rulings: Ruling[], min = 2, rareShare = 0.1) {
  const ri = indexRulings(rulings);
  const wrongBy = new Map<string, string[]>();
  for (const p of round.problems) {
    for (const a of attempts) {
      const raw = a.responses[p.id]?.value;
      if (gradeAnswer(p, raw, ri) !== 'incorrect') continue;
      const k = `${p.number}:${raw!.trim()}`;
      wrongBy.set(k, [...(wrongBy.get(k) ?? []), a.entrantId]);
    }
  }
  const limit = Math.max(2, Math.floor(attempts.length * rareShare));
  const pairs = new Map<string, string[]>();
  for (const [k, ids] of wrongBy) {
    if (ids.length < 2 || ids.length > limit) continue;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('|');
        pairs.set(key, [...(pairs.get(key) ?? []), k]);
      }
  }
  return [...pairs.entries()].filter(([, ks]) => ks.length >= min).map(([key, ks]) => ({ a: key.split('|')[0], b: key.split('|')[1], shared: ks }));
}
