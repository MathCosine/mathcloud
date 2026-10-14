import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { closeRound, contestOf, newProblem, offers, openRound, saveRound } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import { applyProblems, parseProblemText, renumber } from '../../lib/importers';
import type { AnswerType, IntegrityPolicy, Problem, Round } from '../../lib/model';
import { useUser } from '../../lib/session';
import { getDB } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Icon } from '../../components/icons';
import { AnswerPreview, CloseIcon, MathText, Modal, State, Tabs, toast, useNow } from '../../components/ui';
import '../../styles/rounds.css';

// ---------------------------------------------------------------- helpers

/** The round as it is in the store now (debounced saves run after renders). */
const live = (roundId: string) => contestOf(getDB()).rounds.find((r) => r.id === roundId);

function setProblems(roundId: string, fn: (list: Problem[]) => Problem[]) {
  const r = live(roundId);
  if (r) saveRound(roundId, { problems: renumber(fn(r.problems)) });
}

function patchProblem(roundId: string, pid: string, patch: Partial<Problem>) {
  setProblems(roundId, (list) => list.map((p) => (p.id === pid ? { ...p, ...patch } : p)));
}

const isInt = (a: string) => /^-?\d+$/.test(a.trim());

function problemIssues(p: Problem): string[] {
  const out: string[] = [];
  const answers = p.answers.filter((a) => a.trim());
  if (!p.text.trim()) out.push('No text');
  if (!answers.length) out.push('No answer');
  if (p.answerType === 'integer' && answers.some((a) => !isInt(a))) out.push('Integer answer type, but a key is not a whole number');
  if ((p.text.match(/\$/g)?.length ?? 0) % 2) out.push('Odd number of $ signs');
  return out;
}

// ------------------------------------------------------------------- page

export function Rounds() {
  const contest = useContest();
  const [params, setParams] = useSearchParams();
  const id = contest.rounds.find((r) => r.id === params.get('round'))?.id ?? contest.rounds[0]?.id;
  const round = contest.rounds.find((r) => r.id === id);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rounds</h1>
          <p className="page-sub">{contest.divisions.length > 1 ? `Both divisions sit each round at the same time: on paper at ${contest.venue?.name || 'the venue'}, in the browser online.` : offers(contest, 'online') ? 'Every round is taken in the browser, with answers marked as they come in.' : `Every round is on paper at ${contest.venue?.name || 'the venue'}; graders key the sheets.`}</p>
        </div>
        {round && (
          <div className="actions">
            <Link className="btn" to={`/staff/import?type=problems&round=${round.id}`}><Icon name="upload" />Import from CSV</Link>
          </div>
        )}
      </div>
      {!round ? (
        <section className="card"><p className="soft">This contest has no rounds. Rounds are set when the contest is created.</p></section>
      ) : (
        <>
          <Tabs value={round.id} onChange={(k) => setParams({ round: k }, { replace: true })} items={contest.rounds.map((r) => ({ key: r.id, label: r.name, count: r.problems.length }))} />
          <RoundEditor key={round.id} round={round} />
        </>
      )}
    </>
  );
}

function RoundEditor({ round }: { round: Round }) {
  const contest = useContest();
  const me = useUser()!;
  const now = useNow(1000);
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Problem | null>(null);
  const [pasting, setPasting] = useState(false);
  const director = me.role === 'director';
  const guts = round.kind === 'guts';
  const sets = useMemo(() => [...new Set(round.problems.map((p) => p.set ?? 1))].sort((a, b) => a - b), [round.problems]);
  const label = (p: Problem) => (guts ? `${p.set}.${round.problems.filter((x) => x.set === p.set).indexOf(p) + 1}` : String(p.number));
  const issues = round.problems.map((p) => ({ p, list: problemIssues(p) })).filter((x) => x.list.length);
  const noAnswer = issues.filter((x) => x.list.includes('No answer'));

  const [name, setName] = useDraft(round.name, (v) => v.trim() && saveRound(round.id, { name: v.trim() }));
  const [minutes, setMinutes] = useDraft(String(round.minutes), (v) => Number(v) > 0 && saveRound(round.id, { minutes: Number(v) }));
  const [grace, setGrace] = useDraft(String(round.graceSeconds), (v) => Number(v) >= 0 && v !== '' && saveRound(round.id, { graceSeconds: Number(v) }));
  const [rules, setRules, flushRules] = useDraft(round.rules, (v) => saveRound(round.id, { rules: v }));

  const add = (set?: number) => {
    const p = newProblem(live(round.id)!, set);
    setProblems(round.id, (list) => {
      if (!guts) return [...list, p];
      const at = list.map((x) => x.set).lastIndexOf(p.set);
      const next = [...list];
      next.splice(at < 0 ? list.length : at + 1, 0, { ...p, points: list.find((x) => x.set === p.set)?.points ?? p.points });
      return next;
    });
    setEditing(p.id);
  };
  const duplicate = (p: Problem) => {
    const copy = { ...p, id: newProblem(round).id, answers: [...p.answers] };
    setProblems(round.id, (list) => {
      const i = list.findIndex((x) => x.id === p.id);
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
    setEditing(copy.id);
    toast(`Problem ${label(p)} duplicated`, 'The copy is below it.');
  };
  const move = (p: Problem, dir: -1 | 1) => setProblems(round.id, (list) => {
    const i = list.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    // In Guts, crossing into the next set moves the problem into that set.
    if (guts && next[j].set !== p.set) {
      next[i] = { ...p, set: next[j].set };
      return next;
    }
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (p: Problem) => {
    setProblems(round.id, (list) => list.filter((x) => x.id !== p.id));
    setDeleting(null);
    toast(`Problem ${label(p)} deleted`, 'The ones after it moved up a number.');
  };

  return (
    <div className="stack-lg rd">
      <section className="card stack" style={{ gap: 18 }}>
        <div className="row wrap" style={{ gap: 24, justifyContent: 'space-between' }}>
          <div className="row wrap" style={{ gap: 12 }}>
            {state === 'open' && ends ? <State tone="go">Open · {duration(ends - now)} left</State> : state === 'closed' ? <State tone="ok">Finished</State> : <State tone="off">Starts {clockIn(round.startsAt, contest.timeZone)}, {contest.dateLabel.replace(/^\w+day /, '')}</State>}
            <span className="soft">{round.minutes} minutes · {round.problems.length} problems{guts ? `, ${sets.length} sets` : ''} · {round.kind === 'individual' ? 'individual' : 'team'}</span>
          </div>
          {director && (state === 'open' ? (
            <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setConfirm('open')}>{state === 'closed' ? 'Reopen round' : 'Open round'}</button>
          ))}
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Length (minutes)</span>
            <input className="input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          {offers(contest, 'online') && <label className="field">
            <span>Leaving the test</span>
            <select className="select" value={round.integrity.policy} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, policy: e.target.value as IntegrityPolicy } })}>
              <option value="log">Log it</option>
              <option value="warn">Log it and warn</option>
              <option value="lock">Lock after {round.integrity.lockAfter} times</option>
            </select>
          </label>}
          <label className="field">
            <span>Grace period (seconds)</span>
            <input className="input" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} />
          </label>
          <label className="check" style={{ alignSelf: 'end', minHeight: 38 }}>
            <input type="checkbox" checked={!!round.mystery} onChange={(e) => saveRound(round.id, { mystery: e.target.checked })} />
            Keep the format secret until it starts
          </label>
        </div>
      </section>

      <section className="section">
        <div className="section-head wrap">
          <h2>Problems and key</h2>
          <div className="actions row wrap">
            <button className="btn btn-sm" type="button" onClick={() => setPasting(true)}><Icon name="file" />Paste problems</button>
            <Link className="btn btn-sm btn-quiet" to={`/staff/import?type=problems&round=${round.id}`}>Import from CSV</Link>
            {!guts && <button className="btn btn-sm btn-primary" type="button" onClick={() => add()}><Icon name="plus" />Add problem</button>}
          </div>
        </div>

        {noAnswer.length > 0 && (
          <div className="rd-warn small">
            <b>{noAnswer.length === 1 ? '1 problem has' : `${noAnswer.length} problems have`} no answer:</b>{' '}
            {noAnswer.map((x, i) => (
              <span key={x.p.id}>{i > 0 && ', '}<button type="button" className="linkbtn" onClick={() => { setEditing(x.p.id); document.getElementById(`p-${x.p.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>{label(x.p)}</button></span>
            ))}
            . Answers to it cannot be marked until there is one.
          </div>
        )}

        {round.problems.length === 0 && (
          <div className="card rd-empty">
            <p className="soft">No problems yet. Add them one at a time, paste a block of text, or import a CSV.</p>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" type="button" onClick={() => add(guts ? 1 : undefined)}><Icon name="plus" />Add the first problem</button>
              <button className="btn" type="button" onClick={() => setPasting(true)}>Paste problems</button>
            </div>
          </div>
        )}

        <div className="card flush rd-list">
          {round.problems.map((p, i) => {
            const firstOfSet = guts && (i === 0 || round.problems[i - 1].set !== p.set);
            const lastOfSet = guts && (i === round.problems.length - 1 || round.problems[i + 1].set !== p.set);
            return (
              <div key={p.id}>
                {firstOfSet && (
                  <div className="rd-set">
                    <b>Set {p.set}</b>
                    <span className="soft small">{round.problems.filter((x) => x.set === p.set).length} problems · {p.points} points each</span>
                  </div>
                )}
                <ProblemRow
                  round={round} p={p} label={label(p)} first={i === 0} last={i === round.problems.length - 1} sets={sets}
                  open={editing === p.id} onOpen={() => setEditing(editing === p.id ? null : p.id)}
                  onMove={(d) => move(p, d)} onDuplicate={() => duplicate(p)} onDelete={() => setDeleting(p)}
                />
                {lastOfSet && (
                  <div className="rd-set-foot"><button className="btn btn-sm btn-quiet" type="button" onClick={() => add(p.set)}><Icon name="plus" />Add to set {p.set}</button></div>
                )}
              </div>
            );
          })}
          {guts && round.problems.length > 0 && (
            <div className="rd-set-foot"><button className="btn btn-sm" type="button" onClick={() => add(Math.max(...sets) + 1)}><Icon name="plus" />Start set {Math.max(...sets) + 1}</button></div>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Changes save as you type. A problem can accept several answers: 3/8 and 0.375, say. Problems are numbered in the order shown.</p>
      </section>

      <section className="section">
        <div className="section-head"><h2>Rules shown before the start</h2></div>
        <textarea className="textarea" value={rules} onChange={(e) => setRules(e.target.value)} onBlur={flushRules} />
      </section>

      {pasting && <PasteProblems round={round} onClose={() => setPasting(false)} />}

      {deleting && (
        <Modal title={`Delete problem ${label(deleting)}?`} onClose={() => setDeleting(null)} actions={
          <>
            <button className="btn" type="button" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => remove(deleting)}>Delete it</button>
          </>
        }>
          <p className="soft">{deleting.text ? <MathText text={deleting.text.length > 160 ? `${deleting.text.slice(0, 160)}…` : deleting.text} /> : 'An empty problem.'}</p>
          <p>Its key goes too, and any answers already given to it stop counting. The problems after it move up a number.</p>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm === 'open' ? `Open ${round.name}?` : `Close ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' ? 'btn-primary' : 'btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') { openRound(round.id); toast(`${round.name} is open`, `${round.minutes} minutes from now.`, 'g'); }
                else { closeRound(round.id); toast(`${round.name} is closed`, 'Every online test was handed in.'); }
                setConfirm(null);
              }}>{confirm === 'open' ? 'Open now' : 'Close and hand in'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `The ${round.minutes}-minute clock starts now for everyone, in both divisions.${state === 'closed' ? ' Online answers from the last run are cleared.' : ''}` : 'Every online test still open is handed in as it is.'}</p>
          {confirm === 'open' && noAnswer.length > 0 && <p className="rd-warn small">{noAnswer.length} {noAnswer.length === 1 ? 'problem has' : 'problems have'} no answer in the key yet.</p>}
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------ one problem

function ProblemRow({ round, p, label, first, last, sets, open, onOpen, onMove, onDuplicate, onDelete }: {
  round: Round; p: Problem; label: string; first: boolean; last: boolean; sets: number[]; open: boolean;
  onOpen: () => void; onMove: (d: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const [text, setText, flushText] = useDraft(p.text, (v) => patchProblem(round.id, p.id, { text: v }));
  const [points, setPoints] = useDraft(String(p.points), (v) => v !== '' && Number(v) >= 0 && patchProblem(round.id, p.id, { points: Number(v) }));
  const [answer, setAnswer] = useState('');
  const answers = p.answers.filter((a) => a.trim());
  const issues = problemIssues(p);
  const guts = round.kind === 'guts';

  const addAnswer = () => {
    const v = answer.trim();
    if (!v) return;
    if (answers.includes(v)) return setAnswer('');
    const next = [...answers, v];
    patchProblem(round.id, p.id, { answers: next, answerType: answers.length === 0 && !isInt(v) ? 'expression' : p.answerType });
    setAnswer('');
  };
  const removeAnswer = (a: string) => patchProblem(round.id, p.id, { answers: answers.filter((x) => x !== a) });

  return (
    <div className={`rd-prob ${open ? 'open' : ''} ${issues.length ? 'warn' : ''}`} id={`p-${p.id}`}>
      <span className="rd-num mono">{label}</span>
      <div className="rd-body">
        {open ? (
          <div className="rd-edit">
            <label className="field">
              <span>Text <small>maths between $…$</small></span>
              <textarea className="textarea mono" value={text} autoFocus={!p.text} onChange={(e) => setText(e.target.value)} onBlur={flushText} placeholder="Find the remainder when $7^{2027}$ is divided by $10$." />
            </label>
            <div className="field">
              <span>Preview</span>
              <div className="rd-preview">{text.trim() ? <MathText text={text} /> : <span className="muted">The problem as students will see it.</span>}</div>
            </div>
          </div>
        ) : (
          <button type="button" className="rd-text" onClick={onOpen} aria-label={`Edit problem ${label}`}>
            {p.text.trim() ? <MathText text={p.text} /> : <span className="muted">No text yet. Click to write it.</span>}
          </button>
        )}
        <div className="rd-meta row wrap">
          <select className="select input-sm" aria-label="Answer type" value={p.answerType} onChange={(e) => patchProblem(round.id, p.id, { answerType: e.target.value as AnswerType })}>
            <option value="integer">Integer</option>
            <option value="expression">Expression</option>
          </select>
          <label className="row rd-pts">
            <input className="input input-sm" type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} aria-label="Points" />
            <span className="muted small">{Number(points) === 1 ? 'point' : 'points'}</span>
          </label>
          {guts && (
            <select className="select input-sm" aria-label="Set" value={p.set ?? 1} onChange={(e) => {
              const set = Number(e.target.value);
              // Move it to the end of its new set, so sets stay together.
              setProblems(round.id, (list) => {
                const rest = list.filter((x) => x.id !== p.id);
                const at = rest.map((x) => x.set).lastIndexOf(set);
                const next = [...rest];
                next.splice(at < 0 ? rest.length : at + 1, 0, { ...p, set });
                return next;
              });
            }}>
              {[...sets, Math.max(...sets) + 1].map((s) => <option key={s} value={s}>Set {s}</option>)}
            </select>
          )}
          {issues.filter((x) => x !== 'No answer').map((x) => <span key={x} className="tiny amber-ink">{x}</span>)}
          <span className="grow" />
          <span className="rd-tools">
            <button className="btn btn-sm btn-quiet" type="button" onClick={onOpen}>{open ? 'Done' : 'Edit'}</button>
            <button className="btn btn-sm btn-quiet rd-ic" type="button" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${label} up`} title="Move up"><Icon name="chevron" className="up" /></button>
            <button className="btn btn-sm btn-quiet rd-ic" type="button" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${label} down`} title="Move down"><Icon name="chevron" /></button>
            <button className="btn btn-sm btn-quiet" type="button" onClick={onDuplicate}>Duplicate</button>
            <button className="btn btn-sm btn-quiet rd-del" type="button" onClick={onDelete}>Delete</button>
          </span>
        </div>
      </div>
      <div className="rd-answers">
        <div className="rd-chips">
          {answers.map((a) => (
            <span key={a} className="rd-chip">
              <span className="mono">{a}</span>
              <AnswerPreview value={a} />
              <button type="button" className="x" aria-label={`Remove answer ${a}`} onClick={() => removeAnswer(a)}><CloseIcon /></button>
            </span>
          ))}
          {!answers.length && <span className="rd-none">No answer</span>}
        </div>
        <div className="rd-add">
          <input className="input input-sm mono" value={answer} placeholder={answers.length ? 'Another accepted form' : 'Answer'} aria-label={`Add an answer to ${label}`}
            onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAnswer(); } }} onBlur={addAnswer} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ bulk paste

function PasteProblems({ round, onClose }: { round: Round; onClose: () => void }) {
  const [text, setText] = useState('');
  const drafts = useMemo(() => parseProblemText(text, round.kind === 'guts'), [text, round.kind]);
  const usable = drafts.filter((d) => !d.errors.length);
  const go = () => {
    const r = applyProblems(live(round.id)!, drafts, 'append', () => newProblem(round).id);
    saveRound(round.id, { problems: r.problems });
    toast(`${r.added} ${r.added === 1 ? 'problem' : 'problems'} added to ${round.name}`, undefined, 'g');
    onClose();
  };
  return (
    <Modal title={`Paste problems into ${round.name}`} onClose={onClose} actions={
      <>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" disabled={!usable.length} onClick={go}>Add {usable.length || ''} {usable.length === 1 ? 'problem' : 'problems'} at the end</button>
      </>
    }>
      <p className="soft small">One problem per block, blocks separated by a blank line. Put each answer on an “Answer:” line; separate accepted forms with |. Optional: “Points: 2”{round.kind === 'guts' ? ', “Set: 3”' : ''}.</p>
      <textarea className="textarea mono rd-paste" autoFocus value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'1. What is $2 + 2$?\nAnswer: 4\n\n2. Simplify $\\frac{6}{8}$.\nAnswer: 3/4 | 0.75'} />
      {text.trim() && (
        <p className="small soft">
          {usable.length} {usable.length === 1 ? 'problem' : 'problems'} read
          {drafts.some((d) => !d.answers.length) ? `, ${drafts.filter((d) => !d.answers.length).length} without an answer` : ''}.
          {usable[0] && <> First: <MathText text={usable[0].text.slice(0, 90)} /></>}
        </p>
      )}
    </Modal>
  );
}
