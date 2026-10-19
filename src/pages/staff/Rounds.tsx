import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { closeRound, contestOf, newProblem, offers, openRound, saveRound } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import { applyProblems, parseProblemText, renumber } from '../../lib/importers';
import type { AnswerType, IntegrityPolicy, Problem, Round } from '../../lib/model';
import { useUser } from '../../lib/session';
import { getDB } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Icon } from '../../components/icons';
import { ArtEmpty } from '../../components/art';
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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function problemIssues(p: Problem): string[] {
  const out: string[] = [];
  const answers = p.answers.filter((a) => a.trim());
  if (!p.text.trim()) out.push('No text');
  if (!answers.length) out.push('No answer');
  if (p.answerType === 'integer' && answers.some((a) => !isInt(a))) out.push('Answer type is integer, but an answer is not a whole number');
  if ((p.text.match(/\$/g)?.length ?? 0) % 2) out.push('Odd number of $ signs');
  return out;
}

const INTEGRITY: Record<IntegrityPolicy, string> = { log: 'leaving the test is logged', warn: 'leaving the test is logged and warned', lock: 'leaving the test locks it' };

/** A small "⋯" menu (same look as the user menu). */
function RowMenu({ label, text, children }: { label: string; text?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`menu-wrap rd-menu ${open ? 'is-open' : ''}`} ref={ref}>
      {text ? (
        <button type="button" className="btn btn-sm" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{text}<Icon name="chevron" /></button>
      ) : (
        <button type="button" className="btn btn-sm btn-quiet rd-dots" aria-label={label} title={label} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
        </button>
      )}
      {open && <div className="menu down" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- page

export function Rounds() {
  const contest = useContest();
  const [params, setParams] = useSearchParams();
  const id = contest.rounds.find((r) => r.id === params.get('round'))?.id ?? contest.rounds[0]?.id;
  const round = contest.rounds.find((r) => r.id === id);
  const total = contest.rounds.reduce((n, r) => n + r.problems.length, 0);
  const missing = contest.rounds.reduce((n, r) => n + r.problems.filter((p) => !p.answers.some((a) => a.trim())).length, 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rounds</h1>
          <p className="page-sub">
            {!contest.rounds.length ? 'No rounds yet.'
              : missing ? <>{plural(missing, 'problem')} still {missing === 1 ? 'has' : 'have'} no answer. Add {missing === 1 ? 'it' : 'them'} before the round opens.</>
                : total ? `${plural(total, 'problem')} in ${plural(contest.rounds.length, 'round')}, every one with an answer.`
                  : 'Add each round’s problems and answers before the day.'}
          </p>
        </div>
      </div>
      {!round ? (
        <section className="card rd-empty">
          <ArtEmpty kind="problems" />
          <p className="soft">This contest has no rounds. Rounds are set when the contest is created.</p>
          <div><Link className="btn btn-primary" to="/staff/new">Create a contest</Link></div>
        </section>
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
  const navigate = useNavigate();
  const now = useNow(1000);
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Problem | null>(null);
  const [pasting, setPasting] = useState(false);
  const [settings, setSettings] = useState(false);
  const director = me.role === 'director';
  const guts = round.kind === 'guts';
  const online = offers(contest, 'online');
  const sets = useMemo(() => [...new Set(round.problems.map((p) => p.set ?? 1))].sort((a, b) => a - b), [round.problems]);
  const label = (p: Problem) => (guts ? `${p.set}.${round.problems.filter((x) => x.set === p.set).indexOf(p) + 1}` : String(p.number));
  const noAnswer = round.problems.filter((p) => !p.answers.some((a) => a.trim()));
  const pointsAll = [...new Set(round.problems.map((p) => p.points))];

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
    toast(`Problem ${label(p)} duplicated`, 'The copy is right below it.');
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
    if (editing === p.id) setEditing(null);
    toast(`Problem ${label(p)} removed`, 'The ones after it moved up a number.');
  };
  const jump = (p: Problem) => {
    setEditing(p.id);
    requestAnimationFrame(() => document.getElementById(`p-${p.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const summary = [
    `${round.minutes} minutes`,
    guts ? `${plural(sets.length, 'set')}` : round.kind === 'individual' ? 'individual' : 'team',
    pointsAll.length === 1 ? `${plural(pointsAll[0], 'point')} each` : pointsAll.length ? `${Math.min(...pointsAll)}–${Math.max(...pointsAll)} points each` : '',
    round.graceSeconds ? `${round.graceSeconds} s grace` : 'no grace period',
    online ? INTEGRITY[round.integrity.policy] : '',
    round.mystery ? 'format secret until it starts' : '',
  ].filter(Boolean);

  const roundButton = !director ? null : state === 'open' ? (
    <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>
  ) : state === 'closed' ? (
    <button className="btn" type="button" onClick={() => setConfirm('open')}>Reopen round</button>
  ) : (
    <button className="btn btn-primary" type="button" onClick={() => setConfirm('open')}><Icon name="clock" />Open round</button>
  );

  return (
    <div className="stack-lg rd">
      <section className={`card rd-status ${settings ? 'open' : ''}`}>
        <div className="rd-status-row">
          <div className="rd-status-main">
            {state === 'open' && ends ? <State tone="go">Open · {duration(ends - now)} left</State>
              : state === 'closed' ? <State tone="ok">Finished</State>
                : <State tone="wait">Starts {clockIn(round.startsAt, contest.timeZone)}, {contest.dateLabel.replace(/^\w+day /, '')}</State>}
            <span className="soft small rd-summary">{summary.join(' · ')}</span>
          </div>
          <div className="rd-status-actions">
            <button className="btn btn-quiet" type="button" aria-expanded={settings} onClick={() => setSettings((s) => !s)}>
              <Icon name="setup" />{settings ? 'Hide settings' : 'Edit settings'}
            </button>
            {roundButton}
          </div>
        </div>
        {settings && <RoundSettings round={round} online={online} />}
      </section>

      <section className="section rd-probs">
        <div className="section-head wrap">
          <h2>Problems and answers <span className="muted rd-count">{round.problems.length}</span></h2>
          <div className="actions row">
            {!guts && round.problems.length > 0 && <button className="btn btn-sm" type="button" onClick={() => add()}><Icon name="plus" />Add problem</button>}
            <RowMenu label="More ways to add problems" text="More">
              {(close) => (
                <>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setPasting(true); }}>Paste problems as text</button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); navigate(`/staff/import?type=problems&round=${round.id}`); }}>Import from a CSV</button>
                </>
              )}
            </RowMenu>
          </div>
        </div>

        {noAnswer.length > 0 && round.problems.length > 0 && (
          <div className="rd-warn small">
            <b>{noAnswer.length === 1 ? '1 problem has' : `${noAnswer.length} problems have`} no answer:</b>{' '}
            {noAnswer.map((p, i) => (
              <span key={p.id}>{i > 0 && ', '}<button type="button" className="linkbtn" onClick={() => jump(p)}>{label(p)}</button></span>
            ))}
            . Answers to {noAnswer.length === 1 ? 'it' : 'them'} cannot be marked until there is one.
          </div>
        )}

        {round.problems.length === 0 ? (
          <div className="rd-empty">
            <ArtEmpty kind="problems" />
            <div>
              <b>No problems in {round.name} yet</b>
              <p className="soft small">Students see these problems in this order; the answers mark them. Add them one at a time, or paste a whole block of text.</p>
            </div>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" type="button" onClick={() => add(guts ? 1 : undefined)}><Icon name="plus" />Add the first problem</button>
              <button className="btn" type="button" onClick={() => setPasting(true)}>Paste problems</button>
              <Link className="btn btn-quiet" to={`/staff/import?type=problems&round=${round.id}`}>Import a CSV</Link>
            </div>
          </div>
        ) : (
          <div className="rd-list">
            {round.problems.map((p, i) => {
              const firstOfSet = guts && (i === 0 || round.problems[i - 1].set !== p.set);
              const lastOfSet = guts && (i === round.problems.length - 1 || round.problems[i + 1].set !== p.set);
              return (
                <div key={p.id} className="rd-item">
                  {firstOfSet && (
                    <div className="rd-set">
                      <b>Set {p.set}</b>
                      <span className="soft small">{plural(round.problems.filter((x) => x.set === p.set).length, 'problem')} · {plural(p.points, 'point')} each</span>
                    </div>
                  )}
                  <ProblemRow
                    round={round} p={p} label={label(p)} first={i === 0} last={i === round.problems.length - 1} sets={sets}
                    open={editing === p.id} showPoints={pointsAll.length > 1 && !guts} onToggle={() => setEditing(editing === p.id ? null : p.id)}
                    onMove={(d) => move(p, d)} onDuplicate={() => duplicate(p)} onDelete={() => setDeleting(p)}
                  />
                  {lastOfSet && (
                    <div className="rd-set-foot"><button className="btn btn-sm btn-quiet" type="button" onClick={() => add(p.set)}><Icon name="plus" />Add to set {p.set}</button></div>
                  )}
                </div>
              );
            })}
            {guts && (
              <div className="rd-set-foot rd-new-set"><button className="btn btn-sm" type="button" onClick={() => add(Math.max(...sets) + 1)}><Icon name="plus" />Start set {Math.max(...sets) + 1}</button></div>
            )}
          </div>
        )}
        {round.problems.length > 0 && <p className="muted small rd-foot-note">Click a problem to edit it. Changes save as you type.</p>}
      </section>

      {pasting && <PasteProblems round={round} onClose={() => setPasting(false)} />}

      {deleting && (
        <Modal title={`Remove problem ${label(deleting)}?`} onClose={() => setDeleting(null)} actions={
          <>
            <button className="btn" type="button" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => remove(deleting)}>Remove problem</button>
          </>
        }>
          <p className="soft">{deleting.text ? <MathText text={deleting.text.length > 160 ? `${deleting.text.slice(0, 160)}…` : deleting.text} /> : 'An empty problem.'}</p>
          <p>Its answers go too, and any answers students already gave to it stop counting. The problems after it move up a number.</p>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm === 'open' ? `${state === 'closed' ? 'Reopen' : 'Open'} ${round.name}?` : `Close ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' && state !== 'closed' ? 'btn-primary' : 'btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') { openRound(round.id); toast(`${round.name} is open`, `${round.minutes} minutes from now.`, 'g'); }
                else { closeRound(round.id); toast(`${round.name} is closed`, 'Every online test was handed in.'); }
                setConfirm(null);
              }}>{confirm === 'open' ? (state === 'closed' ? 'Reopen and clear answers' : 'Open now') : 'Close and hand in'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `The ${round.minutes}-minute clock starts now for everyone${contest.divisions.length > 1 ? ', in both divisions' : ''}.${state === 'closed' ? ' Online answers from the last run are cleared.' : ''}` : 'Every online test still open is handed in as it is.'}</p>
          {confirm === 'open' && noAnswer.length > 0 && <p className="rd-warn small">{noAnswer.length} {noAnswer.length === 1 ? 'problem has' : 'problems have'} no answer yet.</p>}
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------- round settings

function RoundSettings({ round, online }: { round: Round; online: boolean }) {
  const [name, setName, flushName] = useDraft(round.name, (v) => v.trim() && saveRound(round.id, { name: v.trim() }));
  const [minutes, setMinutes, flushMinutes] = useDraft(String(round.minutes), (v) => Number(v) > 0 && saveRound(round.id, { minutes: Number(v) }));
  const [grace, setGrace, flushGrace] = useDraft(String(round.graceSeconds), (v) => Number(v) >= 0 && v !== '' && saveRound(round.id, { graceSeconds: Number(v) }));
  const [rules, setRules, flushRules] = useDraft(round.rules, (v) => saveRound(round.id, { rules: v }));
  return (
    <div className="rd-settings">
      <div className="rd-settings-grid">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={flushName} />
        </label>
        <label className="field">
          <span>Length</span>
          <span className="rd-unit"><input className="input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={flushMinutes} /><em>minutes</em></span>
        </label>
        <label className="field">
          <span>Grace period</span>
          <span className="rd-unit"><input className="input" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} onBlur={flushGrace} /><em>seconds</em></span>
          <small>Late answers accepted after time.</small>
        </label>
        {online && (
          <label className="field">
            <span>When a student leaves the test</span>
            <select className="select" value={round.integrity.policy} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, policy: e.target.value as IntegrityPolicy } })}>
              <option value="log">Log it</option>
              <option value="warn">Log it and warn</option>
              <option value="lock">Lock after {round.integrity.lockAfter} times</option>
            </select>
          </label>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={!!round.mystery} onChange={(e) => saveRound(round.id, { mystery: e.target.checked })} />
        Keep the format secret until it starts
      </label>
      <label className="field">
        <span>Rules shown before the start</span>
        <textarea className="textarea rd-rules" value={rules} onChange={(e) => setRules(e.target.value)} onBlur={flushRules} placeholder="Work alone. No calculators. Exact answers only." />
      </label>
    </div>
  );
}

// ------------------------------------------------------------ one problem

function ProblemRow({ round, p, label, first, last, sets, open, showPoints, onToggle, onMove, onDuplicate, onDelete }: {
  round: Round; p: Problem; label: string; first: boolean; last: boolean; sets: number[]; open: boolean; showPoints: boolean;
  onToggle: () => void; onMove: (d: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const [text, setText, flushText] = useDraft(p.text, (v) => patchProblem(round.id, p.id, { text: v }));
  const [points, setPoints, flushPoints] = useDraft(String(p.points), (v) => v !== '' && Number(v) >= 0 && patchProblem(round.id, p.id, { points: Number(v) }));
  const [answer, setAnswer] = useState('');
  const answers = p.answers.filter((a) => a.trim());
  const issues = problemIssues(p);
  const guts = round.kind === 'guts';

  const addAnswer = () => {
    const v = answer.trim();
    if (!v) return;
    if (answers.includes(v)) return setAnswer('');
    patchProblem(round.id, p.id, { answers: [...answers, v], answerType: answers.length === 0 && !isInt(v) ? 'expression' : p.answerType });
    setAnswer('');
  };
  const removeAnswer = (a: string) => patchProblem(round.id, p.id, { answers: answers.filter((x) => x !== a) });
  const close = () => { flushText(); flushPoints(); addAnswer(); onToggle(); };

  const menu = (
    <RowMenu label={`More for problem ${label}`}>
      {(shut) => (
        <>
          <button type="button" role="menuitem" className="menu-item" disabled={first} onClick={() => { shut(); onMove(-1); }}>Move up</button>
          <button type="button" role="menuitem" className="menu-item" disabled={last} onClick={() => { shut(); onMove(1); }}>Move down</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { shut(); onDuplicate(); }}>Duplicate</button>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item rd-danger" onClick={() => { shut(); onDelete(); }}>Remove</button>
        </>
      )}
    </RowMenu>
  );

  if (!open) {
    return (
      <div className={`rd-prob ${issues.length ? 'warn' : ''}`} id={`p-${p.id}`}>
        <button type="button" className={`rd-main ${showPoints ? '' : 'no-pts'}`} onClick={onToggle} aria-label={`Edit problem ${label}`}>
          <span className="rd-num mono">{label}</span>
          <span className="rd-text">
            {p.text.trim() ? <MathText text={p.text} /> : <span className="muted">No text yet</span>}
            {issues.filter((x) => x !== 'No answer' && x !== 'No text').map((x) => <span key={x} className="rd-issue">{x}</span>)}
          </span>
          <span className="rd-key">
            {answers.map((a) => <span key={a} className="rd-chip" title={a}>{a.includes('\\') ? <AnswerPreview value={a} /> : <span className="mono">{a}</span>}</span>)}
            {!answers.length && <span className="rd-none">No answer</span>}
          </span>
          {showPoints && <span className="rd-pts" title={plural(p.points, 'point')}>{p.points} pt{p.points === 1 ? '' : 's'}</span>}
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div className="rd-prob open" id={`p-${p.id}`} onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.menu-wrap')) close(); }}>
      <div className="rd-edit-head">
        <span className="rd-num mono">{label}</span>
        <b>Problem {label}</b>
        <span className="grow" />
        {menu}
        <button className="btn btn-sm" type="button" onClick={close} title="Esc"><Icon name="check" />Done</button>
      </div>
      <div className="rd-edit">
        <label className="field">
          <span>Text <small>maths between $…$</small></span>
          <textarea className="textarea mono" value={text} autoFocus onChange={(e) => setText(e.target.value)} onBlur={flushText} placeholder="Find the remainder when $7^{2027}$ is divided by $10$." />
        </label>
        <div className="field">
          <span>As students see it</span>
          <div className="rd-preview">{text.trim() ? <MathText text={text} /> : <span className="muted">The problem as students will see it.</span>}</div>
        </div>
      </div>
      <div className="field">
        <span>Accepted answers <small>any one of these is marked correct</small></span>
        <div className="rd-answers">
          {answers.map((a) => (
            <span key={a} className="rd-chip">
              <span className="mono">{a}</span>
              <AnswerPreview value={a} />
              <button type="button" className="x" aria-label={`Remove answer ${a}`} title="Remove" onClick={() => removeAnswer(a)}><CloseIcon /></button>
            </span>
          ))}
          <span className="rd-add">
            <input className="input input-sm mono" value={answer} placeholder={answers.length ? 'Another form' : 'Answer'} aria-label={`Add an answer to ${label}`}
              onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAnswer(); } }} onBlur={addAnswer} />
            <button className="btn btn-sm" type="button" disabled={!answer.trim()} onMouseDown={(e) => e.preventDefault()} onClick={addAnswer}><Icon name="plus" />Add</button>
          </span>
        </div>
      </div>
      <div className="rd-meta">
        <label className="field">
          <span>Answer type</span>
          <select className="select input-sm" value={p.answerType} onChange={(e) => patchProblem(round.id, p.id, { answerType: e.target.value as AnswerType })}>
            <option value="integer">Whole number</option>
            <option value="expression">Expression or fraction</option>
          </select>
        </label>
        <label className="field">
          <span>Points</span>
          <input className="input input-sm rd-pts-in" type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} onBlur={flushPoints} />
        </label>
        {guts && (
          <label className="field">
            <span>Set</span>
            <select className="select input-sm" value={p.set ?? 1} onChange={(e) => {
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
          </label>
        )}
        {issues.length > 0 && (
          <ul className="rd-issues">{issues.map((x) => <li key={x}>{x}</li>)}</ul>
        )}
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
