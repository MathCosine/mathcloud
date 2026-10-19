import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setPublished, updateRecipe } from '../../lib/actions';
import { useContest, useStandings } from '../../lib/hooks';
import type { AwardRule } from '../../lib/model';
import { ArtEmpty } from '../../components/art';
import { CloseIcon, downloadCsv, Drawer, Modal, Segmented, State, Tabs, toast } from '../../components/ui';
import '../../styles/people.css';
import '../../styles/dayof.css';

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
          <button className="btn" type="button" onClick={() => setScoring(true)}>Scoring</button>
          <button className="btn" type="button" onClick={() => (view === 'individuals'
            ? downloadCsv(`results-${div}-individuals.csv`, ['place', 'id', 'name', 'team', 'score', 'award'], inds.map((r) => [r.place, r.competitor.publicId, r.competitor.name, r.team.name, r.score, r.award ?? '']))
            : downloadCsv(`results-${div}-teams.csv`, ['place', 'code', 'team', ...contest.rounds.map((r) => r.short), 'total', 'award'], teams.map((t) => [t.place, t.team.code, t.team.name, ...t.parts.map((p) => p.weighted), t.total, t.award ?? ''])))}>Export CSV</button>
          <button className={`btn ${contest.resultsPublished ? '' : 'btn-primary'}`} type="button" onClick={() => setConfirm(true)}>{contest.resultsPublished ? 'Unpublish' : 'Publish'}</button>
        </div>
      </div>

      {toRule > 0 && (
        <div className="note amber rs-note">
          <span>{toRule} {toRule === 1 ? 'answer' : 'answers'} in an unusual form still {toRule === 1 ? 'needs' : 'need'} a ruling. Until then {toRule === 1 ? 'it counts' : 'they count'} as wrong.</span>
          <Link className="btn btn-sm" to="/staff/grading">Rule on {toRule === 1 ? 'it' : 'them'}</Link>
        </div>
      )}

      <div className="rs-bar">
        <Tabs value={view} onChange={setView} items={[{ key: 'teams', label: 'Teams', count: teams.length }, { key: 'individuals', label: 'Individuals', count: inds.length }, { key: 'problems', label: 'Problems' }]} />
        {contest.divisions.length > 1 && <Segmented label="Division" value={div} onChange={setDiv} items={contest.divisions.map((d) => ({ key: d.id, label: d.name }))} />}
      </div>

      {view !== 'problems' && teams.length === 0 && inds.length === 0 ? (
        <section className="card pp-empty">
          <ArtEmpty kind="results" className="pp-art" />
          <div className="stack" style={{ gap: 8 }}>
            <h2>No scores yet</h2>
            <p className="soft">Standings build themselves here as online tests are handed in and paper sheets are keyed. Nothing is public until you publish.</p>
            <div className="row" style={{ marginTop: 6 }}><Link className="btn btn-primary" to="/staff/grading">Go to Grading</Link></div>
          </div>
        </section>
      ) : view === 'teams' && (
        <div className="card flush rs-table">
          <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Place</th><th>Team</th>
                {contest.rounds.map((r) => <th key={r.id} className="num">{r.short}{(w[r.id] ?? 0) !== 1 && <span className="muted"> ×{w[r.id] ?? 0}</span>}</th>)}
                <th className="num">Total</th><th>Award</th>
              </tr>
            </thead>
            <tbody>
              {teams.length === 0 && <tr className="empty"><td colSpan={contest.rounds.length + 4}>No team scores yet.</td></tr>}
              {teams.map((t) => (
                <tr key={t.team.id}>
                  <td className="strong">{t.tied ? '=' : ''}{t.place}</td>
                  <td><span className="code">{t.team.code}</span><span className="name">{t.team.name}</span></td>
                  {t.parts.map((p) => <td key={p.roundId} className="num" title={`${p.detail}${p.weight !== 1 ? `, × ${p.weight}` : ''}`}>{p.weighted}</td>)}
                  <td className="num strong">{t.total}</td>
                  <td>{t.award && <Award label={t.award} top={t.place <= 3} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {teams.length > 0 && <div className="rs-foot">Hover a score to see how it was added up. Equal totals share a place.</div>}
        </div>
      )}

      {view === 'individuals' && (teams.length > 0 || inds.length > 0) && (
        <div className="card flush rs-table">
          <div className="table-scroll">
          <table className="t">
            <thead><tr><th style={{ width: 56 }}>Place</th><th>ID</th><th>Name</th><th>Team</th><th className="num">Score</th><th>By problem</th><th>Award</th></tr></thead>
            <tbody>
              {inds.length === 0 && <tr className="empty"><td colSpan={7}>No Individual scores yet.</td></tr>}
              {inds.map((r) => (
                <tr key={r.competitor.id}>
                  <td className="strong" title={r.brokeTie ? 'Level on points, placed by harder problems solved' : undefined}>{r.tied ? '=' : ''}{r.place}{r.brokeTie && <sup className="muted">*</sup>}</td>
                  <td className="mono soft">{r.competitor.publicId}</td>
                  <td className="name">{r.competitor.name}</td>
                  <td><span className="ellipsis soft" style={{ maxWidth: 170 }}>{r.team.name}</span></td>
                  <td className="num strong">{r.score}</td>
                  <td><span className="mini-marks">{r.results.map((x) => <i key={x.problemId} className={x.status} title={`${x.number}: ${x.status}`} />)}</span></td>
                  <td>{r.award && <Award label={r.award} top={r.place <= 3} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {inds.some((r) => r.brokeTie) && <div className="rs-foot">* Level on points with someone else, and placed higher for solving problems fewer people solved.</div>}
        </div>
      )}

      {view === 'problems' && (
        <div className="stack-lg">
          {contest.rounds.map((r) => {
            const stats = standings.problemStats[div]?.[r.id] ?? [];
            return (
              <section key={r.id}>
                <div className="section-head"><h2 style={{ fontSize: 14 }}>{r.name}</h2><span className="label">share who solved each problem · {stats[0]?.attempted ?? 0} {r.kind === 'individual' ? 'competitors' : 'teams'}</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(stats.length, 12)}, minmax(0, 1fr))`, gap: 8 }}>
                  {stats.map((s) => (
                    <div key={s.problemId} title={`${s.correct} of ${s.attempted}`}>
                      <div style={{ height: 64, display: 'flex', alignItems: 'flex-end', background: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: '100%', height: `${s.rate * 100}%`, background: s.rate < 0.2 ? 'var(--amber)' : 'var(--blue)', transition: 'height .4s var(--ease)' }} />
                      </div>
                      <div className="row tiny" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                        <span className="muted">{r.kind === 'guts' ? `${s.set}.${((s.number - 1) % 4) + 1}` : s.number}</span>
                        <span>{Math.round(s.rate * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Drawer open={scoring} onClose={() => setScoring(false)} kicker="Standings update as you change these" title="Scoring">
        <Recipe />
      </Drawer>

      {confirm && (
        <Modal
          title={contest.resultsPublished ? 'Unpublish results?' : 'Publish results?'}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => { setPublished(!contest.resultsPublished); setConfirm(false); toast(contest.resultsPublished ? 'Results hidden' : 'Results published', undefined, 'g'); }}>{contest.resultsPublished ? 'Unpublish' : 'Publish'}</button>
            </>
          }
        >
          <p>{contest.resultsPublished ? 'Students and coaches stop seeing scores until you publish again.' : `Each student sees their own score, place and which problems they got right. Coaches see their teams.${toRule ? ` ${toRule} answers without a ruling count as wrong.` : ''}`}</p>
        </Modal>
      )}
    </>
  );
}

/** An award as a quiet tag; the podium in warm gold, the rest neutral. Not a link. */
function Award({ label, top }: { label: string; top: boolean }) {
  return <span className={`rs-award ${top ? 'top' : ''}`}>{label}</span>;
}

function Recipe() {
  const contest = useContest();
  const r = contest.recipe;
  const ind = contest.rounds.find((x) => x.kind === 'individual');
  const setAward = (id: string, patch: Partial<AwardRule>) => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.map((a) => (a.id === id ? { ...a, ...patch } : a)); });
  const awards = (scope: AwardRule['scope']) => r.awards.filter((a) => a.scope === scope);
  return (
    <>
      <section>
        <h3>Team score</h3>
        <div className="stack" style={{ gap: 10 }}>
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
                <button className="close" type="button" aria-label={`Remove ${a.label}`} onClick={() => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.filter((x) => x.id !== a.id); })}><CloseIcon /></button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} type="button" onClick={() => updateRecipe((c) => { c.recipe.awards.push({ id: `a${Date.now()}`, scope, label: scope === 'team' ? 'Top 5' : 'Top 10', rule: 'top_n', value: scope === 'team' ? 5 : 10 }); })}>Add award</button>
            <p className="muted tiny">The first rule that fits a place wins. Places shared on a tie get the same award.</p>
          </div>
        </section>
      ))}
    </>
  );
}
