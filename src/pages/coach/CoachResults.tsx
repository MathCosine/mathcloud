import { useState } from 'react';
import { modeOf } from '../../lib/actions';
import { ordinal, useContest } from '../../lib/hooks';
import type { PublishedResult, Team } from '../../lib/model';
import { useDB } from '../../lib/store';
import { Icon } from '../../components/icons';
import { ModeChip } from '../../components/ui';
import { SheetView } from '../student/parts';
import { fieldScores, ScoreReport } from '../student/report';

/** After the contest: each team's place, each student's score, and a report per student to print. */
export function CoachResults({ teams, results }: { teams: Team[]; results: PublishedResult[] }) {
  const db = useDB();
  const contest = useContest();
  const [printing, setPrinting] = useState<{ teams: Team[]; only?: string } | null>(null);
  const forTeam = (t: Team) => db.competitors.filter((c) => c.teamId === t.id).sort((a, b) => a.slot.localeCompare(b.slot));

  return (
    <section className="card pt-card pt-results reveal">
      <div className="pt-h">
        <h2><Icon name="results" size={16} />Results</h2>
        <button className="btn btn-sm btn-primary" type="button" onClick={() => setPrinting({ teams })}><Icon name="file" />Score reports</button>
      </div>
      <div className="stack-lg">
        {teams.map((t) => {
          const tr = results.find((r) => r.teamId === t.id)?.data;
          return (
            <div key={t.id} className="stack" style={{ gap: 8 }}>
              <div className="row wrap pt-res-team" style={{ justifyContent: 'space-between' }}>
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="pt-team-code">{t.code}</span>
                  <b>{t.name}</b>
                  <ModeChip mode={modeOf(contest, t)} />
                </span>
                <span className="soft small">
                  {tr ? <>{tr.place ? <b className="strong">{ordinal(tr.place)} of {tr.of}</b> : 'Unplaced'} in the {tr.division.toLowerCase()} division, {tr.score} points{tr.award ? <span className="pt-award">, {tr.award}</span> : ''}</> : 'No team result'}
                </span>
              </div>
              <div className="table-scroll">
                <table className="t">
                  <thead><tr><th>ID</th><th>Student</th><th className="num">Individual</th><th className="num">Place</th><th>Award</th><th /></tr></thead>
                  <tbody>
                    {forTeam(t).map((c) => {
                      const r = results.find((x) => x.competitorId === c.id)?.data;
                      return (
                        <tr key={c.id} className="pt-row">
                          <td className="mono soft">{c.publicId}</td>
                          <td className="name">{c.name}</td>
                          <td className="num">{r && r.place !== null ? <><b>{r.score}</b><span className="muted"> / {r.max}</span></> : <span className="muted">–</span>}</td>
                          <td className="num">{r?.place ? `${ordinal(r.place)} of ${r.of}` : <span className="muted">–</span>}</td>
                          <td>{r?.award ? <span className="pt-award">{r.award}</span> : <span className="muted">–</span>}</td>
                          <td className="num"><button className="btn btn-sm btn-quiet pt-row-act" type="button" disabled={!r} onClick={() => setPrinting({ teams: [t], only: c.id })}><Icon name="file" size={14} />Report</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      {printing && <Reports teams={printing.teams} only={printing.only} results={results} onClose={() => setPrinting(null)} />}
    </section>
  );
}

function Reports({ teams, only, results, onClose }: { teams: Team[]; only?: string; results: PublishedResult[]; onClose: () => void }) {
  const db = useDB();
  const contest = useContest();
  const pages = teams.flatMap((t) =>
    db.competitors
      .filter((c) => c.teamId === t.id && (!only || c.id === only))
      .sort((a, b) => a.slot.localeCompare(b.slot))
      .map((c) => ({ c, t, r: results.find((x) => x.competitorId === c.id)?.data, tr: results.find((x) => x.teamId === t.id)?.data }))
      .filter((p) => p.r),
  );
  return (
    <SheetView title="Score reports" sub={`${pages.length} ${pages.length === 1 ? 'student' : 'students'}, one page each`} onClose={onClose}>
      {pages.map(({ c, t, r, tr }) => (
        <article key={c.id} className="pt-page">
          <header className="pt-page-head">
            <div>
              <span className="label">{contest.name} · {contest.dateLabel}</span>
              <h2>{c.name}</h2>
              <p className="soft small"><span className="mono">{c.publicId}</span> · {t.name} · grade {c.grade || '–'}</p>
            </div>
            <ModeChip mode={modeOf(contest, t)} />
          </header>
          <ScoreReport me={r!} team={tr} field={fieldScores(results, r!.division)} />
        </article>
      ))}
    </SheetView>
  );
}
