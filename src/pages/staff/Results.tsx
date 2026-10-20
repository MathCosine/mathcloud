import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setPublished, updateRecipe } from '../../lib/actions';
import { useContest, useStandings } from '../../lib/hooks';
import type { AwardRule } from '../../lib/model';
import { Icon } from '../../components/icons';
import { downloadCsv, Drawer, EmptyState, Modal, Segmented, State, Tabs, toast } from '../../components/ui';
import '../../styles/live.css';

type View = 'teams' | 'individuals' | 'problems';

export function Results() {
  const contest = useContest();
  const standings = useStandings();
  const [view, setView] = useState<View>('teams');
  const [div, setDiv] = useState(contest.divisions[0]?.id ?? '');
  const [confirm, setConfirm] = useState(false);
  const [scoring, setScoring] = useState(false);
  const teams = standings.teams[div] ?? [];
  const inds = standings.individuals[div] ?? [];
  const toRule = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);
  const w = contest.recipe.weights;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Results</h1>
          <p className="page-sub">
            {contest.resultsPublished ? <State tone="ok">Published. Students and coaches can see them.</State> : <State tone="off">Draft. Only staff can see these until you publish.</State>}
          </p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setScoring(true)}><Icon name="sigma" />Scoring</button>
          <button className="btn" type="button" onClick={() => (view === 'individuals'
            ? downloadCsv(`results-${div}-individuals.csv`, ['place', 'id', 'name', 'team', 'score', 'award'], inds.map((r) => [r.place, r.competitor.publicId, r.competitor.name, r.team.name, r.score, r.award ?? '']))
            : downloadCsv(`results-${div}-teams.csv`, ['place', 'code', 'team', ...contest.rounds.map((r) => r.short), 'total', 'award'], teams.map((t) => [t.place, t.team.code, t.team.name, ...t.parts.map((p) => p.weighted), t.total, t.award ?? ''])))} title={`Download the ${view === 'individuals' ? 'Individual' : 'team'} standings as a spreadsheet`}><Icon name="download" />Export CSV</button>
          <button className={`btn ${contest.resultsPublished ? '' : 'btn-primary'}`} type="button" onClick={() => setConfirm(true)}><Icon name={contest.resultsPublished ? 'lock' : 'globe'} />{contest.resultsPublished ? 'Unpublish' : 'Publish'}</button>
        </div>
      </div>

      {toRule > 0 && (
        <div className="note amber rs-note">
          <Icon name="warning" />
          <span>{toRule} {toRule === 1 ? 'answer' : 'answers'} in an unusual form still {toRule === 1 ? 'needs' : 'need'} a ruling. Until then {toRule === 1 ? 'it counts' : 'they count'} as wrong.</span>
          <Link className="btn btn-sm" to="/staff/grading">Rule on {toRule === 1 ? 'it' : 'them'}<Icon name="arrow" size={14} /></Link>
        </div>
      )}

      <div className="rs-bar">
        <Tabs value={view} onChange={setView} items={[{ key: 'teams', label: 'Teams', count: teams.length }, { key: 'individuals', label: 'Individuals', count: inds.length }, { key: 'problems', label: 'Problems' }]} />
        {contest.divisions.length > 1 && <Segmented label="Division" value={div} onChange={setDiv} items={contest.divisions.map((d) => ({ key: d.id, label: d.name }))} />}
      </div>

      {view !== 'problems' && teams.length === 0 && inds.length === 0 ? (
        <section className="card">
          <EmptyState icon="results" title="No scores yet" action={<Link className="btn btn-primary" to="/staff/grading">Go to Grading<Icon name="arrow" /></Link>}>
            Standings build themselves here as online tests are handed in and paper sheets are keyed. Nothing is public until you publish.
          </EmptyState>
        </section>
      ) : view === 'teams' && (
        <div className="card flush rs-table">
          <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Place</th><th>Team</th>
                {contest.rounds.map((r) => <th key={r.id} className="num">{r.short}{(w[r.id] ?? 0) !== 1 && <span className="muted"> ×{w[r.id] ?? 0}</span>}</th>)}
                <th className="num">Total</th><th>Award</th>
              </tr>
            </thead>
            <tbody>
              {teams.length === 0 && <tr className="empty"><td colSpan={contest.rounds.length + 4}>No team scores yet.</td></tr>}
              {teams.map((t) => (
                <tr key={t.team.id} className={t.place <= 3 ? 'rs-top' : ''}>
                  <td className="rs-place">{t.tied ? <span className="tie">=</span> : null}{t.place}</td>
                  <td><span className="code">{t.team.code}</span><span className="name">{t.team.name}</span></td>
                  {t.parts.map((p) => <td key={p.roundId} className="num" title={`${p.detail}${p.weight !== 1 ? `, × ${p.weight}` : ''}`}>{p.weighted}</td>)}
                  <td className="num rs-total">{t.total}</td>
                  <td>{t.award && <Award label={t.award} top={t.place <= 3} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {teams.length > 0 && <div className="rs-foot"><Icon name="info" size={14} />Hover a score to see how it was added up. Equal totals share a place.</div>}
        </div>
      )}

      {view === 'individuals' && (teams.length > 0 || inds.length > 0) && (
        <div className="card flush rs-table">
          <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Place</th><th>ID</th><th>Name</th><th>Team</th><th className="num">Score</th><th>By problem</th><th>Award</th></tr></thead>
            <tbody>
              {inds.length === 0 && <tr className="empty"><td colSpan={7}>No Individual scores yet.</td></tr>}
              {inds.map((r) => (
                <tr key={r.competitor.id} className={r.place <= 3 ? 'rs-top' : ''}>
                  <td className="rs-place" title={r.brokeTie ? 'Level on points, placed by harder problems solved' : undefined}>{r.tied ? <span className="tie">=</span> : null}{r.place}{r.brokeTie ? <sup className="muted">*</sup> : null}</td>
                  <td className="mono soft">{r.competitor.publicId}</td>
                  <td className="name">{r.competitor.name}</td>
                  <td><span className="ellipsis soft" style={{ maxWidth: 170 }}>{r.team.name}</span></td>
                  <td className="num rs-total">{r.score}</td>
                  <td><span className="mini-marks">{r.results.map((x) => <i key={x.problemId} className={x.status} title={`${x.number}: ${x.status}`} />)}</span></td>
                  <td>{r.award && <Award label={r.award} top={r.place <= 3} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {inds.some((r) => r.brokeTie) && <div className="rs-foot"><Icon name="info" size={14} />* Level on points with someone else, and placed higher for solving problems fewer people solved.</div>}
        </div>
      )}

      {view === 'problems' && (
        <div className="rs-rounds">
          {contest.rounds.map((r) => {
            const stats = standings.problemStats[div]?.[r.id] ?? [];
            return (
              <section key={r.id} className="card rs-round">
                <div className="section-head"><h2>{r.name}</h2><span className="label">Share who solved each problem · {stats[0]?.attempted ?? 0} {r.kind === 'individual' ? 'competitors' : 'teams'}</span></div>
                {stats.length === 0 ? <p className="muted small">No answers in this round yet.</p> : (
                  <div className="rs-probs">
                    {stats.map((s) => (
                      <div key={s.problemId} className="rs-p" title={`${s.correct} of ${s.attempted} solved it`}>
                        <div className="rs-p-col"><i style={{ height: `${Math.max(2, s.rate * 100)}%` }} /></div>
                        <div className="rs-p-lab"><b>{Math.round(s.rate * 100)}%</b><span>{r.kind === 'guts' ? `${s.set}.${((s.number - 1) % 4) + 1}` : s.number}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Drawer open={scoring} onClose={() => setScoring(false)} kicker="Standings update as you change these" title="Scoring" foot={<button className="btn btn-primary" type="button" onClick={() => setScoring(false)}>Done</button>}>
        <Recipe />
      </Drawer>

      {confirm && (
        <Modal
          title={contest.resultsPublished ? 'Unpublish results?' : 'Publish results?'}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
              <button className={`btn btn-primary ${contest.resultsPublished ? 'btn-danger' : ''}`} type="button" onClick={() => { setPublished(!contest.resultsPublished); setConfirm(false); toast(contest.resultsPublished ? 'Results hidden' : 'Results published', undefined, 'g'); }}>{contest.resultsPublished ? 'Unpublish' : 'Publish'}</button>
            </>
          }
        >
          <p>{contest.resultsPublished ? 'Students and coaches stop seeing scores until you publish again.' : `Each student sees their own score, place and which problems they got right. Coaches see their teams.${toRule ? ` ${toRule} answers without a ruling count as wrong.` : ''}`}</p>
        </Modal>
      )}
    </>
  );
}

/** An award as a quiet tag; the podium in ink, the rest neutral. Not a link. */
function Award({ label, top }: { label: string; top: boolean }) {
  return <span className={`rs-award ${top ? 'top' : ''}`}>{top && <Icon name="certificate" size={13} />}{label}</span>;
}

function Recipe() {
  const contest = useContest();
  const r = contest.recipe;
  const ind = contest.rounds.find((x) => x.kind === 'individual');
  const setAward = (id: string, patch: Partial<AwardRule>) => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.map((a) => (a.id === id ? { ...a, ...patch } : a)); });
  const awards = (scope: AwardRule['scope']) => r.awards.filter((a) => a.scope === scope);
  return (
    <>
      <section className="rs-recipe">
        <h3>Team score</h3>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row">
            <span className="grow soft">From the {ind?.name} round</span>
            <select className="select input-sm" style={{ width: 'auto' }} value={r.teamIndividual.method} onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.method = e.target.value as 'sum' | 'best' | 'average'; })}>
              <option value="best">Best members</option>
              <option value="sum">Every member</option>
              <option value="average">Average</option>
            </select>
            {r.teamIndividual.method === 'best' && <input className="input input-sm" type="number" min={1} max={4} style={{ width: 56 }} value={r.teamIndividual.best} aria-label="How many" onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.best = Number(e.target.value); })} />}
          </div>
          {contest.rounds.map((round) => (
            <div key={round.id} className="row">
              <span className="grow soft">{round.name} counts</span>
              <span className="muted">×</span>
              <input className="input input-sm" type="number" min={0} step={0.5} style={{ width: 70 }} value={r.weights[round.id] ?? 0} aria-label={`${round.name} weight`} onChange={(e) => updateRecipe((c) => { c.recipe.weights[round.id] = Number(e.target.value); })} />
            </div>
          ))}
          <label className="check small"><input type="checkbox" checked={r.teamIndividual.fillMissingTo > 0} onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.fillMissingTo = e.target.checked ? 4 : 0; })} />Count missing members as 0</label>
        </div>
      </section>
      <section>
        <h3>Ties</h3>
        <label className="check small"><input type="checkbox" checked={r.harderFirst} onChange={(e) => updateRecipe((c) => { c.recipe.harderFirst = e.target.checked; })} />Break individual ties by harder problems solved</label>
      </section>
      {(['individual', 'team'] as const).map((scope) => (
        <section key={scope}>
          <h3>{scope === 'individual' ? 'Individual awards' : 'Team awards'}</h3>
          <div className="stack" style={{ gap: 6 }}>
            {awards(scope).map((a) => (
              <div key={a.id} className="row" style={{ gap: 6 }}>
                <input className="input input-sm grow" value={a.label} aria-label="Award" onChange={(e) => setAward(a.id, { label: e.target.value })} />
                <select className="select input-sm" style={{ width: 92 }} value={a.rule} onChange={(e) => setAward(a.id, { rule: e.target.value as AwardRule['rule'] })}>
                  <option value="top_n">top</option>
                  <option value="top_percent">top %</option>
                </select>
                <input className="input input-sm" type="number" min={1} style={{ width: 58 }} value={a.value} aria-label="Value" onChange={(e) => setAward(a.id, { value: Number(e.target.value) })} />
                <button className="icon-btn" type="button" aria-label={`Remove ${a.label}`} title="Remove" onClick={() => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.filter((x) => x.id !== a.id); })}><Icon name="trash" size={15} /></button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} type="button" onClick={() => updateRecipe((c) => { c.recipe.awards.push({ id: `a${Date.now()}`, scope, label: scope === 'team' ? 'Top 5' : 'Top 10', rule: 'top_n', value: scope === 'team' ? 5 : 10 }); })}><Icon name="plus" />Add award</button>
            <p className="muted tiny">The first rule that fits a place wins. Places shared on a tie get the same award.</p>
          </div>
        </section>
      ))}
    </>
  );
}
