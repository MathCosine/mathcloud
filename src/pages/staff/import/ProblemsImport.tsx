import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { newProblem, saveRound } from '../../../lib/actions';
import { parseCsv } from '../../../lib/csv';
import {
  applyProblems, guessProblemMap, inferType, parseProblemRows, parseProblemText, PROBLEM_FIELDS, SAMPLE_PROBLEM_TEXT, SAMPLE_PROBLEMS,
  type ProblemMap, type ProblemMode,
} from '../../../lib/importers';
import { useContest } from '../../../lib/hooks';
import { useDB } from '../../../lib/store';
import { Icon } from '../../../components/icons';
import { AnswerPreview, MathText, Modal, Segmented, toast } from '../../../components/ui';
import { ColumnSelect, Done, Issues, missingNote, sampleOf, Source, StepFoot, Steps, Tally, type Step } from './shared';

const BLOCKS = /^\s*(answers?|ans|key)\s*[:=]/im;

export function ProblemsImport({ initialRound }: { initialRound?: string }) {
  const contest = useContest();
  const db = useDB();
  const [step, setStep] = useState<Step>(1);
  const [saved, setSaved] = useState<{ total: number; detail: string } | null>(null);
  const [roundId, setRoundId] = useState(contest.rounds.find((r) => r.id === initialRound)?.id ?? contest.rounds[0]?.id);
  const round = contest.rounds.find((r) => r.id === roundId) ?? contest.rounds[0];
  const guts = round?.kind === 'guts';
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [blocks, setBlocks] = useState(false);
  const [map, setMap] = useState<ProblemMap | null>(null);
  const [mode, setMode] = useState<ProblemMode>(round?.problems.length ? 'update' : 'replace');
  const [confirm, setConfirm] = useState(false);

  const rows = useMemo(() => (text && !blocks ? parseCsv(text) : []), [text, blocks]);
  const headers = rows[0] ?? [];
  const drafts = useMemo(() => {
    if (!text) return [];
    if (blocks) return parseProblemText(text, guts);
    return map && rows.length > 1 ? parseProblemRows(rows, map, guts) : [];
  }, [text, blocks, map, rows, guts]);
  const result = useMemo(() => (round && drafts.length ? applyProblems(round, drafts, mode, () => 'preview') : null), [round, drafts, mode]);
  const answered = useMemo(() => db.attempts.filter((a) => a.roundId === round?.id && Object.keys(a.responses).length).length, [db.attempts, round?.id]);
  const usable = drafts.filter((d) => !d.errors.length);

  if (!round) return <section className="card"><p className="soft">This contest has no rounds yet.</p></section>;

  const load = (t: string, name: string) => {
    if (!t.trim()) return toast('Nothing to import', undefined, 'r');
    const isBlocks = BLOCKS.test(t) && !/^[^\n]*,[^\n]*answer/i.test(t.split('\n')[0]);
    if (!isBlocks && parseCsv(t).length < 2) return toast('Nothing to import', 'A CSV needs a header row and at least one problem. Plain text needs an "Answer:" line under each problem.', 'r');
    setText(t);
    setSource(name);
    setBlocks(isBlocks);
    setMap(isBlocks ? null : guessProblemMap(parseCsv(t)[0]));
    setStep(isBlocks ? 3 : 2);
  };

  const save = () => {
    const r = applyProblems(round, drafts, mode, () => newProblem(round).id);
    saveRound(round.id, { problems: r.problems });
    setConfirm(false);
    const detail = [r.added && `${r.added} added`, r.updated && `${r.updated} updated`, r.removed && `${r.removed} replaced`].filter(Boolean).join(', ');
    toast(`${round.name}: ${r.problems.length} problems`, detail, 'g');
    setSaved({ total: r.problems.length, detail });
    setStep(4);
  };

  const reset = () => { setText(''); setMap(null); setBlocks(false); setSaved(null); setStep(1); };
  const loaded = !!text && step > 1;
  const missing = !blocks && map ? [...(map.text === undefined ? ['Text'] : []), ...(map.answers === undefined ? ['Answer'] : [])] : [];
  const skip = blocks ? [2] : [];

  if (step === 4 && saved) {
    return (
      <>
        <Steps at={4} skip={skip} />
        <Done title={`${round.name} now has ${saved.total} problems`} body={saved.detail ? `${saved.detail[0].toUpperCase()}${saved.detail.slice(1)}. Edit any of them in Rounds.` : 'Edit any of them in Rounds.'}>
          <Link className="btn btn-primary" to={`/staff/rounds?round=${round.id}`}>Open {round.name} in Rounds</Link>
          <button className="btn" type="button" onClick={reset}>Import another file</button>
        </Done>
      </>
    );
  }

  return (
    <>
      <Steps at={step} skip={skip} onGo={setStep} onRestart={loaded ? reset : undefined} />
      {step === 1 && <section className="card stack">
        <div className="row wrap" style={{ gap: 12, justifyContent: 'space-between' }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="field-label">Into which round</span>
            <Segmented label="Round" value={round.id} onChange={(k) => { setRoundId(k); setMode(contest.rounds.find((r) => r.id === k)!.problems.length ? 'update' : 'replace'); }}
              items={contest.rounds.map((r) => ({ key: r.id, label: r.name, count: r.problems.length }))} />
          </div>
          <span className="small soft">{round.problems.length} problems now · {round.kind === 'guts' ? 'Guts, in sets' : round.kind === 'team' ? 'team round' : 'individual round'}</span>
        </div>
        {(
          <>
            <Source
              onLoad={load}
              title="Drop a CSV of problems here"
              hint={<>Columns: number{guts ? ', set' : ''}, text (maths in $…$), answer (several separated by |), points, type. Or paste plain text: one problem per block, each with an “Answer:” line.</>}
              pasteLabel="Paste a CSV, or problems as plain text"
              pastePlaceholder={'1. What is $2 + 2$?\nAnswer: 4\n\n2. Simplify $\\frac{6}{8}$.\nAnswer: 3/4 | 0.75\nPoints: 2'}
              samples={[
                { label: 'Try a CSV sample', text: SAMPLE_PROBLEMS, name: 'sample problems' },
                { label: 'Try pasted text', text: SAMPLE_PROBLEM_TEXT, name: 'pasted text' },
              ]}
            />
          </>
        )}
      </section>}

      {step === 2 && !blocks && map && (
        <section className="card flush">
          <div className="card-head">
            <h2>Which column holds what?</h2>
            <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows · into {round.name}</span>
          </div>
          <div className="imp-pad">
            <div className="map-grid">
              {PROBLEM_FIELDS.filter((f) => f.key !== 'set' || guts).map((f) => (
                <ColumnSelect key={f.key} label={f.label} required={f.required} value={map[f.key]} headers={headers} sample={sampleOf(rows, map[f.key])} onChange={(v) => setMap((m) => m && { ...m, [f.key]: v })} />
              ))}
            </div>
          </div>
          <StepFoot back={reset} backLabel="Choose another file" note={missingNote(missing)}>
            <button className="btn btn-primary" type="button" disabled={missing.length > 0} onClick={() => setStep(3)}>Check {drafts.length} {drafts.length === 1 ? 'problem' : 'problems'}<Icon name="arrow" /></button>
          </StepFoot>
        </section>
      )}

      {step === 3 && (
        <section className="card flush">
          <div className="card-head wrap">
            <h2>What will happen in {round.name}</h2>
            <Tally items={[
              { n: usable.length, label: usable.length === 1 ? 'problem read' : 'problems read', tone: '' },
              { n: drafts.filter((d) => !d.answers.length && !d.errors.length).length, label: 'without an answer', tone: 'a' },
              { n: drafts.length - usable.length, label: 'left out', tone: 'r' },
            ]} />
          </div>
          <div className="imp-pad stack">
            <div className="row wrap" style={{ gap: 12 }}>
              <span className="field-label">Problems already in the round</span>
              <Segmented label="How to import" value={mode} onChange={setMode} items={[
                { key: 'replace', label: 'Replace the round’s problems' },
                { key: 'append', label: 'Add at the end' },
                { key: 'update', label: 'Update by number' },
              ] as { key: ProblemMode; label: string }[]} />
            </div>
            <p className="small soft">
              {mode === 'replace' ? `The ${round.problems.length} problems in ${round.name} are removed and these take their place, numbered from 1.`
                : mode === 'append' ? `These come after problem ${round.problems.length}, numbered from ${round.problems.length + 1}.`
                  : 'A problem whose number is already in the round has its text, answers and anything else given replaced; other numbers are added at the end.'}
              {result && <> After saving: <b>{result.problems.length}</b> problems ({[result.added && `${result.added} new`, result.updated && `${result.updated} changed`, result.removed && `${result.removed} removed`].filter(Boolean).join(', ') || 'no change'}).</>}
            </p>
            {mode === 'replace' && answered > 0 && (
              <p className="imp-warn small"><b>{answered} answer sheets already have answers for {round.name}.</b> Replacing the problems gives them new IDs, so those answers no longer count. Use “Update by number” to fix text or keys and keep them.</p>
            )}
          </div>
          <ol className="imp-probs">
            {drafts.map((d) => {
              const target = mode === 'update' && d.number !== null ? round.problems.find((p) => p.number === d.number) : undefined;
              return (
                <li key={d.row} className={d.errors.length ? 'dim' : ''}>
                  <span className="imp-pn mono">{d.number ?? '–'}{guts && d.set !== null && <small>set {d.set}</small>}</span>
                  <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                    <div className="imp-ptext">{d.text ? <MathText text={d.text} /> : <span className="muted">No text</span>}</div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {d.answers.map((a) => <span key={a} className="chip mono">{a}<AnswerPreview value={a} /></span>)}
                      <span className="tiny muted">{d.answerType ?? inferType(d.answers)}{d.points !== null ? ` · ${d.points} ${d.points === 1 ? 'point' : 'points'}` : ''}</span>
                    </div>
                    <Issues errors={d.errors} warnings={d.warnings} notes={target ? [`Replaces problem ${target.number}`] : []} ok="" />
                  </div>
                  <span className="mono tiny muted">{blocks ? `block ${d.row}` : `row ${d.row}`}</span>
                </li>
              );
            })}
          </ol>
          <StepFoot back={() => setStep(blocks ? 1 : 2)} backLabel={blocks ? 'Choose another file' : 'Back to columns'}>
            <button className="btn btn-primary" type="button" disabled={!usable.length} onClick={() => (mode === 'replace' && round.problems.length ? setConfirm(true) : save())}>
              Import {usable.length} {usable.length === 1 ? 'problem' : 'problems'} into {round.name}
            </button>
          </StepFoot>
        </section>
      )}

      {confirm && (
        <Modal title={`Replace ${round.problems.length} problems in ${round.name}?`} onClose={() => setConfirm(false)} actions={
          <>
            <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={save}>Replace them</button>
          </>
        }>
          <p>The round’s current problems and their keys are removed{answered ? `, and the answers already on ${answered} sheets stop counting` : ''}.</p>
        </Modal>
      )}
    </>
  );
}
