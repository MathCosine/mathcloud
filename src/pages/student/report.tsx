import { useMemo } from 'react';
import { resultRows } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { PublishedResult, ResultData } from '../../lib/model';
import { REMOTE, useDB } from '../../lib/store';
import { Histogram } from '../../components/charts';

/**
 * Published results as the student and coach portals see them. Connected,
 * they are the rows the organisers published (each person sees their own and
 * their team's); in the sandbox they are worked out the same way from the
 * standings, once the director has published.
 */
export function usePublished(): PublishedResult[] {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  return useMemo(() => {
    if (!contest.resultsPublished) return [];
    if (REMOTE) return db.results ?? [];
    return resultRows(contest, standings, db);
  }, [contest, standings, db]);
}

/** Every individual score in a division that this person can see, for the distribution. */
export function fieldScores(results: PublishedResult[], division: string) {
  return results.filter((r) => r.competitorId && r.data.division === division && r.data.place !== null).map((r) => r.data.score);
}

/** Horizontal bars, one per round: score out of the most it could have been. */
export function RoundBars({ rows }: { rows: { name: string; score: number; max: number; mine?: boolean }[] }) {
  return (
    <div className="pt-bars">
      {rows.map((r) => {
        const share = r.max ? Math.max(0, Math.min(1, r.score / r.max)) : 0;
        return (
          <div key={r.name} className="pt-bar-row">
            <span className="pt-bar-label">{r.name}</span>
            <svg className="pt-bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${r.name}: ${fmt(r.score)} of ${fmt(r.max)}`}>
              <rect x="0" y="0" width="100" height="10" rx="2" fill="var(--bg-3)" />
              <rect x="0" y="0" width={share * 100} height="10" rx="2" fill={r.mine ? 'var(--blue)' : 'var(--ink-3)'} />
            </svg>
            <span className="pt-bar-value"><b>{fmt(r.score)}</b><span className="muted"> / {fmt(r.max)}</span></span>
          </div>
        );
      })}
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One student's results: score, place, where it sits in the field, each problem, the team's rounds. */
export function ScoreReport({ me, team, field }: { me: ResultData; team?: ResultData; field: number[] }) {
  const hasInd = me.place !== null && me.max !== undefined;
  const max = me.max ?? Math.max(1, ...field);
  const rounds = [
    ...(hasInd ? [{ name: 'Individual (you)', score: me.score, max, mine: true }] : []),
    ...(team?.rounds ?? []).map((r) => ({ name: `${r.name} (team)`, score: r.score, max: r.max })),
  ];
  const below = field.filter((s) => s < me.score).length;
  return (
    <div className="pt-report">
      <div className="pt-report-top">
        <div>
          <span className="label">Individual score</span>
          {hasInd ? (
            <div className="pt-big">{fmt(me.score)}<span> / {fmt(max)}</span></div>
          ) : (
            <div className="pt-big muted" style={{ fontSize: 28 }}>No individual score</div>
          )}
        </div>
        <dl className="pt-facts">
          {hasInd && <><dt>Place</dt><dd>{ordinal(me.place!)} of {me.of}</dd></>}
          {me.award && <><dt>Award</dt><dd className="pt-award">{me.award}</dd></>}
          {(me.team ?? team) && (
            <>
              <dt>Team</dt>
              <dd>{me.team ? `${me.team.name}: ${me.team.place ? `${ordinal(me.team.place)} of ${me.team.of}` : 'unplaced'}, ${fmt(me.team.total)} points` : `${team!.name}: ${team!.place ? ordinal(team!.place) : 'unplaced'} of ${team!.of}`}</dd>
            </>
          )}
          <dt>Division</dt><dd>{me.division}</dd>
        </dl>
      </div>
      <div className="pt-report-grid">
        {hasInd && field.length >= 8 && (
          <figure className="pt-figure">
            <figcaption className="small soft"><b className="strong">{me.of} students</b> in the {me.division.toLowerCase()} division. You scored more than {below}. Your score is the blue bar.</figcaption>
            <Histogram scores={field} max={Math.round(max)} mark={Math.round(me.score)} height={110} label={`Individual scores; yours is ${me.score}`} />
          </figure>
        )}
        {rounds.length > 0 && (
          <div className="pt-figure">
            <figcaption className="small soft"><b className="strong">By round.</b> Team rounds count for the team total.</figcaption>
            <RoundBars rows={rounds} />
          </div>
        )}
      </div>
      {me.problems && me.problems.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span className="label">Individual round, problem by problem</span>
            <span className="pt-legend">
              <span><i className="mark correct" />Correct</span>
              <span><i className="mark incorrect" />Wrong</span>
              <span><i className="mark" />Blank</span>
            </span>
          </div>
          <div className="marks pt-marks">
            {me.problems.map((p) => <span key={p.number} className={`mark ${p.status}`} title={`Problem ${p.number}: ${p.status}`}>{p.number}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
