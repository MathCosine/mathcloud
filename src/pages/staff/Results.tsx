import { useState } from 'react';
import { setPublished, updateRecipe } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { AwardRule } from '../../lib/model';
import { CloseIcon, downloadCsv, Modal, Segmented, Status, Tabs, toast } from '../../components/ui';

type View = 'teams' | 'individuals' | 'problems';

export function Results() {
  const contest = useContest();
  const standings = useStandings();
  const [view, setView] = useState<View>('teams');
  const [div, setDiv] = useState(contest.divisions[0].id);
  const [confirm, setConfirm] = useState(false);
  const teams = standings.teams[div] ?? [];
  const inds = standings.individuals[div] ?? [];
  const unreviewed = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);
  const recipe = contest.recipe;

  const exportCsv = () => {
    if (view === 'teams') {
      downloadCsv(`sfmo-2027-teams-${div}.csv`, ['place', 'team_code', 'team', ...contest.rounds.flatMap((r) => [`${r.id}_raw`, `${r.id}_weighted`]), 'total', 'award'],
        teams.map((t) => [t.place, t.team.code, t.team.name, ...t.parts.flatMap((p) => [p.raw, p.weighted]), t.total, t.award ?? '']));
    } else {
      downloadCsv(`sfmo-2027-individuals-${div}.csv`, ['place', 'id', 'name', 'team', 'score', 'award'], inds.map((r) => [r.place, r.competitor.publicId, r.competitor.name, r.team.name, r.score, r.award ?? '']));
    }
  };

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Results</span></div>
      <div className="page-head">
        <div>
          <h1>Results</h1>
          <div className="meta">
            {contest.resultsPublished ? <Status tone="green">Published</Status> : <Status tone="grey">Draft, only staff can see this</Status>}
            {unreviewed > 0 && <><span className="dot-sep" /><span className="warn-text">{unreviewed} answers still need a ruling; they count as wrong until then</span></>}
          </div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={exportCsv}>Export CSV</button>
          <button className={`btn ${contest.resultsPublished ? '' : 'btn-primary'}`} type="button" onClick={() => setConfirm(true)}>{contest.resultsPublished ? 'Unpublish' : 'Publish results'}</button>
        </div>
      </div>

      <div className="grid-main-side">
        <div className="stack">
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <Segmented label="Division" value={div} onChange={setDiv} items={contest.divisions.map((d) => ({ key: d.id, label: d.name, count: (standings.teams[d.id] ?? []).length }))} />
          </div>
          <Tabs value={view} onChange={setView} items={[{ key: 'teams', label: 'Teams', count: teams.length }, { key: 'individuals', label: 'Individuals', count: inds.length }, { key: 'problems', label: 'Problem statistics' }]} />

          {view === 'teams' && (
            <div className="panel table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Place</th><th>Team</th>
                    {contest.rounds.map((r) => <th key={r.id} className="num" title={`${r.name} × ${recipe.weights[r.id] ?? 0}`}>{r.short} ×{recipe.weights[r.id] ?? 0}</th>)}
                    <th className="num">Total</th><th>Award</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.length === 0 && <tr className="empty-row"><td colSpan={9}>No scores yet. Use the demo switch, bottom right, to jump to after the contest.</td></tr>}
                  {teams.map((t, i) => (
                    <tr key={t.team.id} className="enter" style={{ ['--i' as string]: Math.min(i, 14) }}>
                      <td className="mono">{t.tied ? '=' : ''}{ordinal(t.place)}</td>
                      <td><span className="tid">{t.team.code}</span><span className="tname">{t.team.name}</span></td>
                      {t.parts.map((p) => (
                        <td key={p.roundId} className="num mono" title={`${p.detail}${p.weight !== 1 ? ` × ${p.weight} = ${p.weighted}` : ''}`}>
                          {p.weighted}<span className="sub" style={{ fontSize: 11 }}> ({p.raw})</span>
                        </td>
                      ))}
                      <td className="num mono"><b>{t.total}</b></td>
                      <td>{t.award && <span className="tag blue">{t.award}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'individuals' && (
            <div className="panel table-wrap">
              <table className="t">
                <thead><tr><th>Place</th><th>ID</th><th>Name</th><th>Team</th><th className="num">Score</th><th>Problems</th><th>Award</th></tr></thead>
                <tbody>
                  {inds.length === 0 && <tr className="empty-row"><td colSpan={7}>No Individual round scores yet.</td></tr>}
                  {inds.map((r, i) => (
                    <tr key={r.competitor.id} className="enter" style={{ ['--i' as string]: Math.min(i, 14) }}>
                      <td className="mono" title={r.brokeTie ? 'Level on points; placed by the harder problems they solved' : undefined}>{r.tied ? '=' : ''}{ordinal(r.place)}{r.brokeTie && <span className="sub">*</span>}</td>
                      <td className="mono">{r.competitor.publicId}</td>
                      <td className="tname">{r.competitor.name}</td>
                      <td><span className="ellip" style={{ maxWidth: 160 }}>{r.team.name}</span></td>
                      <td className="num mono"><b>{r.score}</b><span className="sub"> / {r.max}</span></td>
                      <td>
                        <span className="marks" style={{ flexWrap: 'nowrap', gap: 2 }}>
                          {r.results.map((x) => <span key={x.problemId} className={`mark ${x.status}`} style={{ width: 9, height: 16, borderRadius: 2, fontSize: 0 }} title={`P${x.number}: ${x.status}`} />)}
                        </span>
                      </td>
                      <td>{r.award && <span className={`tag ${r.place <= 3 ? 'blue' : ''}`}>{r.award}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inds.some((r) => r.brokeTie) && <p className="sub" style={{ fontSize: 12, padding: '8px 12px' }}>* Level on points with someone else; placed higher by solving problems fewer people solved.</p>}
            </div>
          )}

          {view === 'problems' && (
            <div className="stack">
              {contest.rounds.map((r) => {
                const stats = standings.problemStats[div]?.[r.id] ?? [];
                return (
                  <div key={r.id} className="panel">
                    <div className="panel-head"><h3>{r.name}</h3><span className="sub" style={{ fontSize: 12.5 }}>{stats[0]?.attempted ?? 0} {r.kind === 'individual' ? 'competitors' : 'teams'}</span></div>
                    <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(stats.length, 12)}, minmax(0, 1fr))`, gap: 6 }}>
                      {stats.map((s) => (
                        <div key={s.problemId} title={`${s.correct} of ${s.attempted} correct`} style={{ textAlign: 'center' }}>
                          <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', background: 'var(--sunken)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: '100%', height: `${s.rate * 100}%`, background: s.rate < 0.2 ? 'var(--amber)' : 'var(--blue)', transition: 'height 400ms var(--ease)' }} />
                          </div>
                          <div className="mono sub" style={{ fontSize: 11, marginTop: 3 }}>{r.kind === 'guts' ? `${s.set}.${((s.number - 1) % 4) + 1}` : s.number}</div>
                          <div className="mono" style={{ fontSize: 11 }}>{Math.round(s.rate * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <RecipeEditor />
      </div>

      {confirm && (
        <Modal
          title={contest.resultsPublished ? 'Unpublish results?' : 'Publish results?'}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => { setPublished(!contest.resultsPublished); setConfirm(false); toast(contest.resultsPublished ? 'Results hidden' : 'Results published', contest.resultsPublished ? '' : 'Students and coaches can see their scores and places now.', 'g'); }}>
                {contest.resultsPublished ? 'Unpublish' : 'Publish'}
              </button>
            </>
          }
        >
          <p>
            {contest.resultsPublished
              ? 'Students and coaches will stop seeing scores until you publish again.'
              : `Every student sees their own score, place and which problems they got right, and every coach sees their teams. ${unreviewed ? `${unreviewed} answers have no ruling yet and will count as wrong.` : 'Every answer has been graded.'}`}
          </p>
        </Modal>
      )}
    </>
  );
}

function RecipeEditor() {
  const contest = useContest();
  const r = contest.recipe;
  const ind = contest.rounds.find((x) => x.kind === 'individual');
  const setAward = (id: string, patch: Partial<AwardRule>) => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.map((a) => (a.id === id ? { ...a, ...patch } : a)); });
  return (
    <div className="panel" style={{ position: 'sticky', top: 16 }}>
      <div className="panel-head"><h3>Scoring</h3><span className="sub" style={{ fontSize: 12 }}>Standings update as you change it</span></div>
      <div className="panel-body stack">
        <div className="field">
          <span>Team score from the {ind?.name} round</span>
          <div className="row">
            <select className="select" value={r.teamIndividual.method} onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.method = e.target.value as 'sum' | 'best' | 'average'; })}>
              <option value="best">Best k members</option>
              <option value="sum">Sum of all members</option>
              <option value="average">Average of members</option>
            </select>
            {r.teamIndividual.method === 'best' && <input className="input mono" type="number" min={1} max={4} value={r.teamIndividual.best} onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.best = Number(e.target.value); })} style={{ width: 64 }} aria-label="k" />}
          </div>
          <label className="check" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={r.teamIndividual.fillMissingTo > 0} onChange={(e) => updateRecipe((c) => { c.recipe.teamIndividual.fillMissingTo = e.target.checked ? 4 : 0; })} />
            Count missing members as 0 (teams of 4)
          </label>
        </div>
        <div className="field">
          <span>Weight of each round in the team total</span>
          {contest.rounds.map((round) => (
            <div key={round.id} className="row">
              <span style={{ width: 110 }}>{round.name}</span>
              <span className="sub">×</span>
              <input className="input input-sm mono" type="number" min={0} step={0.5} value={r.weights[round.id] ?? 0} onChange={(e) => updateRecipe((c) => { c.recipe.weights[round.id] = Number(e.target.value); })} style={{ width: 70 }} />
            </div>
          ))}
        </div>
        <label className="check" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={r.harderFirst} onChange={(e) => updateRecipe((c) => { c.recipe.harderFirst = e.target.checked; })} />
          Break individual ties by harder problems solved
        </label>
        <div className="field">
          <span>Awards, first rule that fits wins</span>
          {r.awards.map((a) => (
            <div key={a.id} className="row" style={{ gap: 6 }}>
              <span className="tag" style={{ margin: 0, width: 26, textAlign: 'center' }}>{a.scope === 'team' ? 'T' : 'I'}</span>
              <input className="input input-sm" value={a.label} onChange={(e) => setAward(a.id, { label: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
              <select className="select input-sm" style={{ width: 74, height: 28 }} value={a.rule} onChange={(e) => setAward(a.id, { rule: e.target.value as AwardRule['rule'] })}>
                <option value="top_n">top</option>
                <option value="top_percent">top %</option>
              </select>
              <input className="input input-sm mono" type="number" min={1} value={a.value} onChange={(e) => setAward(a.id, { value: Number(e.target.value) })} style={{ width: 54 }} />
              <button className="x" type="button" aria-label="Remove" onClick={() => updateRecipe((c) => { c.recipe.awards = c.recipe.awards.filter((x) => x.id !== a.id); })}><CloseIcon /></button>
            </div>
          ))}
          <div className="row">
            <button className="btn btn-sm" type="button" onClick={() => updateRecipe((c) => { c.recipe.awards.push({ id: `a${Date.now()}`, scope: 'individual', label: 'Top 10', rule: 'top_n', value: 10 }); })}>Add individual award</button>
            <button className="btn btn-sm" type="button" onClick={() => updateRecipe((c) => { c.recipe.awards.push({ id: `a${Date.now()}`, scope: 'team', label: 'Top 5 teams', rule: 'top_n', value: 5 }); })}>Add team award</button>
          </div>
        </div>
        <p className="sub" style={{ fontSize: 12 }}>Hover a team’s round score to see the sum behind it. Ties share a place, and the next place is skipped: 1, 1, 3.</p>
      </div>
    </div>
  );
}
