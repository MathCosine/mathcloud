import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { savePaperGutsSet, savePaperSheet } from '../../../lib/actions';
import { parseCsv } from '../../../lib/csv';
import { guessSheetMap, gutsSetsOf, planSheets, sampleSheet, type Entrant, type SheetMap } from '../../../lib/importers';
import { useContest } from '../../../lib/hooks';
import type { Problem } from '../../../lib/model';
import { useUser } from '../../../lib/session';
import { useDB } from '../../../lib/store';
import { Icon } from '../../../components/icons';
import { Segmented, toast } from '../../../components/ui';
import { ColumnSelect, Done, Duplicates, Issues, missingNote, sampleOf, Source, StepFoot, Steps, Tally, type Step } from './shared';

export function SheetsImport({ initialRound }: { initialRound?: string }) {
  const contest = useContest();
  const db = useDB();
  const me = useUser()!;
  const [step, setStep] = useState<Step>(1);
  const [savedN, setSavedN] = useState(0);
  const [roundId, setRoundId] = useState(contest.rounds.find((r) => r.id === initialRound)?.id ?? contest.rounds[0]?.id);
  const round = contest.rounds.find((r) => r.id === roundId) ?? contest.rounds[0];
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [map, setMap] = useState<SheetMap | null>(null);
  const [choice, setChoice] = useState<Record<string, 'skip' | 'overwrite'>>({});
  const existingOf = (k: string) => choice[k] ?? 'skip';

  const individual = round?.kind === 'individual';
  const entrants: Entrant[] = useMemo(() => {
    const live = db.teams.filter((t) => t.status !== 'withdrawn');
    if (individual) {
      const ids = new Set(live.map((t) => t.id));
      return db.competitors.filter((c) => ids.has(c.teamId)).map((c) => ({ id: c.id, code: c.publicId, name: c.name }));
    }
    return live.map((t) => ({ id: t.id, code: t.code, name: t.name }));
  }, [db.teams, db.competitors, individual]);
  const withSheet = useMemo(() => new Set(db.attempts.filter((a) => a.roundId === round?.id && (Object.keys(a.responses).length || a.submittedAt)).map((a) => a.entrantId)), [db.attempts, round?.id]);
  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const headers = rows[0] ?? [];
  const plan = useMemo(() => (map && rows.length > 1 ? planSheets(rows, map, entrants, withSheet) : []), [rows, map, entrants, withSheet]);
  const ok = plan.filter((s) => !s.errors.length);
  const toSave = ok.filter((s) => !s.hasSheet || existingOf(s.key) === 'overwrite');
  const already = ok.filter((s) => s.hasSheet);
  const overwriting = already.filter((s) => existingOf(s.key) === 'overwrite').length;
  const mapped = round ? round.problems.filter((p) => map?.cols[p.id] !== undefined).length : 0;

  if (!round) return <section className="card"><p className="soft">This contest has no rounds yet.</p></section>;

  const label = (p: Problem) => (round.kind === 'guts' && p.set ? `${p.set}.${round.problems.filter((x) => x.set === p.set).indexOf(p) + 1}` : String(p.number));
  const load = (t: string, name: string) => {
    const r = parseCsv(t);
    if (r.length < 2) return toast('Nothing to import', 'The file needs a header row and at least one sheet.', 'r');
    setText(t);
    setSource(name);
    setMap(guessSheetMap(r[0], round));
    setStep(2);
  };
  const save = () => {
    let n = 0;
    for (const s of toSave) {
      if (!s.entrant) continue;
      if (round.kind === 'guts') {
        for (const set of gutsSetsOf(round, s.values)) {
          const vals = Object.fromEntries(round.problems.filter((p) => p.set === set).map((p) => [p.id, s.values[p.id] ?? '']));
          savePaperGutsSet(round.id, s.entrant.id, set, vals, me.name);
        }
      } else savePaperSheet(round.id, s.entrant.id, s.values, me.name);
      n++;
    }
    toast(`${n} ${n === 1 ? 'sheet' : 'sheets'} saved for ${round.name}`, undefined, 'g');
    setSavedN(n);
    setStep(4);
  };
  const reset = () => { setText(''); setMap(null); setChoice({}); setStep(1); };
  const missing = [...(map?.id === undefined ? [individual ? 'Competitor ID' : 'Team code'] : []), ...(!mapped ? ['at least one problem'] : [])];

  if (step === 4) {
    return (
      <>
        <Steps at={4} />
        <Done title={`${savedN} ${savedN === 1 ? 'sheet' : 'sheets'} saved for ${round.name}`} body="They are marked against the answers now. Rule on any new answers in Grading.">
          <Link className="btn btn-primary" to="/staff/grading">Go to Grading</Link>
          <button className="btn" type="button" onClick={reset}>Import another file</button>
        </Done>
      </>
    );
  }

  return (
    <>
      <Steps at={step} onGo={setStep} onRestart={text ? reset : undefined} />
      {step === 1 && <section className="card stack">
        <div className="row wrap" style={{ gap: 12, justifyContent: 'space-between' }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="field-label">Which round</span>
            <Segmented label="Round" value={round.id} onChange={(k) => { setRoundId(k); reset(); }} items={contest.rounds.map((r) => ({ key: r.id, label: r.name }))} />
          </div>
          <span className="small soft">{withSheet.size} {withSheet.size === 1 ? 'sheet' : 'sheets'} in already · one row per {individual ? 'student, by competitor ID (07A)' : 'team, by team code (07)'}</span>
        </div>
        {(
          <Source
            onLoad={load}
            title="Drop the keyed sheets here"
            hint={<>One row per {individual ? 'student' : 'team'}: an ID column, then one column per problem headed with its number{round.kind === 'guts' ? ' (1–24, or 2.3 for set 2, problem 3)' : ` (1–${round.problems.length})`}.</>}
            pastePlaceholder={`ID,${round.problems.slice(0, 5).map(label).join(',')},...`}
            samples={[{ label: 'Try a sample', text: sampleSheet(round, [...entrants.filter((e) => !withSheet.has(e.id)), ...entrants.filter((e) => withSheet.has(e.id))]), name: `sample ${round.short} sheets` }]}
          />
        )}
      </section>}

      {step === 2 && map && (
        <section className="card flush">
          <div className="card-head wrap">
            <h2>Which column holds what?</h2>
            <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows · {mapped} of {round.problems.length} problems found</span>
          </div>
          <div className="imp-pad stack">
            <div className="map-grid">
              <ColumnSelect label={individual ? 'Competitor ID' : 'Team code'} required value={map.id} headers={headers} sample={sampleOf(rows, map.id)} onChange={(v) => setMap((m) => m && { ...m, id: v })} />
            </div>
            <details className="imp-cols">
              <summary>Problem columns <span className="muted">· {mapped} of {round.problems.length} matched</span></summary>
              <div className="imp-colgrid">
                {round.problems.map((p) => (
                  <label key={p.id} className="row" style={{ gap: 6 }}>
                    <span className="mono small" style={{ width: 34 }}>{label(p)}</span>
                    <select className="select input-sm" value={map.cols[p.id] ?? ''} onChange={(e) => setMap((m) => {
                      if (!m) return m;
                      const cols = { ...m.cols };
                      if (e.target.value === '') delete cols[p.id];
                      else cols[p.id] = Number(e.target.value);
                      return { ...m, cols };
                    })}>
                      <option value="">Not in the file</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <StepFoot back={reset} backLabel="Choose another file" note={missingNote(missing)}>
            <button className="btn btn-primary" type="button" disabled={missing.length > 0} onClick={() => setStep(3)}>Check {plan.length} {plan.length === 1 ? 'sheet' : 'sheets'}<Icon name="arrow" /></button>
          </StepFoot>
        </section>
      )}

      {step === 3 && map && (
        <Duplicates<'skip' | 'overwrite'>
          title={already.length === 1 ? 'sheet is already in' : 'sheets are already in'}
          note={`Keyed on the Grading screen or imported before. Keep what is there, or overwrite it with the file.`}
          items={already.map((s) => ({ key: s.key, what: <><b className="mono">{s.raw}</b> {s.entrant?.name} <span className="soft small">row {s.row}</span></>, why: 'Already has a sheet for this round', value: existingOf(s.key) }))}
          options={[{ key: 'skip', label: 'Keep, skip row' }, { key: 'overwrite', label: 'Overwrite' }]}
          onChange={(k, v) => setChoice((c) => ({ ...c, [k]: v }))}
          onAll={(v) => setChoice(Object.fromEntries(already.map((s) => [s.key, v])))}
        />
      )}

      {step === 3 && map && (
        <section className="card flush">
          <div className="card-head wrap">
            <h2>What will happen in {round.name}</h2>
            <Tally items={[
              { n: ok.filter((s) => !s.hasSheet).length, label: 'new', tone: 'g' },
              { n: overwriting, label: 'to overwrite', tone: 'b' },
              { n: already.length - overwriting, label: 'already in, skipped', tone: 'a' },
              { n: plan.length - ok.length, label: 'left out', tone: 'r' },
            ]} />
          </div>
          <div className="table-scroll">
            <table className="t imp-table">
              <thead><tr><th>Row</th><th>ID</th><th>{individual ? 'Student' : 'Team'}</th><th className="num">Answered</th><th>Answers</th><th>What happens</th></tr></thead>
              <tbody>
                {plan.map((s) => {
                  const skip = s.errors.length > 0 || (s.hasSheet && existingOf(s.key) === 'skip');
                  return (
                    <tr key={s.key} className={skip ? 'dim' : ''}>
                      <td className="mono soft">{s.row}</td>
                      <td className="mono">{s.raw || '–'}</td>
                      <td className="name">{s.entrant?.name ?? <span className="muted">–</span>}</td>
                      <td className="num">{s.filled}<span className="muted">/{round.problems.length}</span></td>
                      <td><div className="imp-answers mono small">{round.problems.filter((p) => map.cols[p.id] !== undefined).slice(0, 12).map((p) => <span key={p.id} className={s.values[p.id] ? '' : 'blank'} title={`Problem ${label(p)}`}>{s.values[p.id] || '·'}</span>)}{mapped > 12 && <span className="muted">…</span>}</div></td>
                      <td className="wrap imp-notes">
                        {s.errors.length ? <Issues errors={s.errors} warnings={[]} /> : s.hasSheet ? <span className={`state ${existingOf(s.key) === 'overwrite' ? 'go' : 'wait'}`}>{existingOf(s.key) === 'overwrite' ? 'Overwrites the sheet in' : 'Already in, skipped'}</span> : <Issues errors={[]} warnings={s.warnings} ok="New sheet" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <StepFoot back={() => setStep(2)} backLabel="Back to columns" note={`Saved as keyed by ${me.name}. Blank boxes count as blank answers.`}>
            <button className="btn btn-primary" type="button" disabled={!toSave.length || !mapped} onClick={save}>Import {toSave.length} {toSave.length === 1 ? 'sheet' : 'sheets'}</button>
          </StepFoot>
        </section>
      )}
    </>
  );
}
