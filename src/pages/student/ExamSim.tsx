import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { IntegrityKind, IntegrityPolicy, Problem, Round, RoundKind, Team } from '../../lib/model';
import { gradeAnswer, type GradeStatus, type RulingIndex } from '../../lib/scoring/answers';
import type { Board } from '../../lib/scoring/board';
import { clock, clockSec, duration } from '../../lib/time';
import { ScoreList } from '../../components/Scoreboard';
import { Logo } from '../../components/art';
import { Ring } from '../../components/charts';
import { Icon, type IconName } from '../../components/icons';
import { AnswerPreview, MathText, Modal, Segmented, State, toast, useNow } from '../../components/ui';
import { Tick } from './parts';
import '../../styles/portal.css';
import '../../styles/practice.css';

/**
 * The test, without a server. It draws the same screens as the real test
 * (TestPortal) with the same classes, checks answers with the same grading
 * function, and notices the same things a browser can notice (leaving the
 * tab, leaving fullscreen, pasting). Everything lives in this component's
 * state: no attempt is created, nothing is written anywhere, and closing
 * the tab throws it all away.
 *
 * Problems with a `set` in a round that is not Guts are released after the
 * others, one set at a time, Guts style. The practice test uses that to show
 * both kinds of round in ten minutes.
 */
export type SimProps = {
  /** The round's name: "Individual", "Practice test". */
  title: string;
  /** The small line under it before the start: the contest, or "Sample problems". */
  context: string;
  minutes: number;
  kind: RoundKind;
  problems: Problem[];
  rules?: string;
  integrity?: { policy: IntegrityPolicy; lockAfter: number };
  freezeMinutes?: number;
  /** The name the honour code must match. Without one, any name of two letters or more. */
  name?: string;
  /** Under the title while the test runs ("16A Carter Hughes"). Defaults to the name typed. */
  who?: string;
  audience: 'student' | 'organiser';
  /** A strip above the test on every screen: what this is, and the way out. */
  ribbon?: ReactNode;
  /** Where "Back" goes after the end. */
  exit: { label: string; to: string };
  /** The intro's back button, when it should go somewhere else than `exit`. */
  onBack?: () => void;
  /** Inside the organiser frame: shown as a framed screen, and the running test covers the frame like it covers a student's screen. */
  inline?: boolean;
};

type Phase = 'intro' | 'running' | 'handed' | 'results';
type SimEvent = { kind: IntegrityKind; ms?: number; at: number };
type Sim = {
  honor: string;
  startedAt: number;
  deadline: number;
  stage: number;
  responses: Record<string, string>;
  events: SimEvent[];
  locked: boolean;
  handedAt?: number;
  timeUp?: boolean;
};
type Stage = { set: number | null; problems: Problem[] };

/** Leaving the tab, the window or fullscreen: what the real test counts toward warnings and locks. */
const COUNTED: IntegrityKind[] = ['hidden', 'blur', 'fullscreen_exit'];
/** No director has ruled on anything here: only the key decides. */
const NO_RULINGS: RulingIndex = new Map();

function stagesOf(kind: RoundKind, problems: Problem[]): Stage[] {
  const sorted = [...problems].sort((a, b) => (a.set ?? 0) - (b.set ?? 0) || a.number - b.number);
  const inSet = (p: Problem) => kind === 'guts' || p.set != null;
  const out: Stage[] = [];
  const loose = sorted.filter((p) => !inSet(p));
  if (loose.length) out.push({ set: null, problems: loose });
  const sets = [...new Set(sorted.filter(inSet).map((p) => p.set ?? 1))].sort((a, b) => a - b);
  for (const s of sets) out.push({ set: s, problems: sorted.filter((p) => inSet(p) && (p.set ?? 1) === s) });
  return out;
}

export function ExamSim(props: SimProps) {
  const { kind, problems, inline, ribbon } = props;
  const stages = useMemo(() => stagesOf(kind, problems), [kind, problems]);
  const [phase, setPhase] = useState<Phase>('intro');
  const [sim, setSim] = useState<Sim | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const top = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (el.classList.contains('ex-takeover')) el.scrollTo({ top: 0 });
    else if (inline) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y) });
    } else window.scrollTo({ top: 0 });
  }, [inline]);

  // The real test leaves fullscreen when it is over; so does this, and so does leaving the page.
  useEffect(() => {
    if (phase !== 'running' && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    top();
  }, [phase, top]);
  useEffect(() => () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  const start = async (honor: string) => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* Some browsers and phones refuse fullscreen. The test still runs and still notices leaving the tab. */
    }
    const t = Date.now();
    setSim({ honor, startedAt: t, deadline: t + props.minutes * 60000, stage: 0, responses: {}, events: [], locked: false });
    setPhase('running');
  };
  const finish = useCallback((timeUp: boolean) => {
    setSim((s) => (s && !s.handedAt ? { ...s, handedAt: Date.now(), timeUp } : s));
    setPhase('handed');
  }, []);
  const again = () => {
    setSim(null);
    setPhase('intro');
  };

  const takeover = inline && phase === 'running';
  return (
    <div ref={root} className={`ex ex-sim ${ribbon ? 'has-ribbon' : ''} ${inline ? 'inline' : ''} ${takeover ? 'ex-takeover' : ''}`}>
      {ribbon && <div className="ps-ribbon">{ribbon}</div>}
      {phase === 'intro' && <Intro p={props} stages={stages} onStart={start} />}
      {phase === 'running' && sim && <Running p={props} stages={stages} sim={sim} setSim={setSim} onFinish={finish} onTop={top} />}
      {phase === 'handed' && sim && <Handed p={props} stages={stages} sim={sim} onResults={() => setPhase('results')} />}
      {phase === 'results' && sim && <Results p={props} stages={stages} sim={sim} onAgain={again} />}
    </div>
  );
}

// ------------------------------------------------------------------ intro

function Intro({ p, stages, onStart }: { p: SimProps; stages: Stage[]; onStart: (honor: string) => void }) {
  const [honor, setHonor] = useState('');
  const typed = honor.trim().toLowerCase().replace(/\s+/g, ' ');
  const ok = p.name ? typed === p.name.toLowerCase().replace(/\s+/g, ' ') : typed.replace(/[^a-z]/g, '').length >= 2;
  const policy = p.integrity ?? { policy: 'warn', lockAfter: 4 };
  const hasGuts = stages.some((s) => s.set !== null);
  const practice = p.audience === 'student';
  const kindChip: [IconName, string] = p.kind === 'individual' ? ['user', 'On your own'] : p.kind === 'guts' ? ['roster', 'With your team, one set at a time'] : ['roster', 'With your team, one shared sheet'];
  const back = p.onBack ? (
    <button className="btn btn-sm btn-quiet" type="button" onClick={p.onBack}><Icon name="back" />Back</button>
  ) : (
    <Link className="btn btn-sm btn-quiet" to={p.exit.to}><Icon name="back" />Back</Link>
  );
  return (
    <>
      <div className="ex-bar intro">
        <div className="ex-l"><Logo size={24} /><span><b>{p.title}</b><small>{p.context}</small></span></div>
        <div className="ex-clock idle" role="timer">{duration(p.minutes * 60000)}</div>
        <div className="ex-r">{back}</div>
      </div>
      <div className="ex-intro">
        <div>
          <div className="ex-chips">
            <span className="ex-chip"><Icon name={kindChip[0]} size={14} />{kindChip[1]}</span>
            <span className="ex-chip"><Icon name="timer" size={14} />{p.minutes} minutes</span>
            <span className="ex-chip"><Icon name="sigma" size={14} />{p.problems.length} {p.problems.length === 1 ? 'problem' : 'problems'}</span>
          </div>
          <h1>{p.title}</h1>
          {p.rules && <p className="lede">{p.rules}</p>}
        </div>
        <ul className="ex-rules">
          <li><span className="ex-ic"><Icon name="video" /></span>{practice ? 'On the day, stay in your Zoom room with your camera on.' : 'Stay in your Zoom room with your camera on.'}</li>
          <li><span className="ex-ic"><Icon name="screen" /></span><span>The test goes fullscreen. Leaving it is recorded for your proctor{policy.policy === 'warn' ? ', and you will see a warning' : policy.policy === 'lock' ? `, and the test locks after ${policy.lockAfter} times` : ''}.</span></li>
          <li><span className="ex-ic"><Icon name="check-circle" /></span>Answers save as you type.</li>
          {hasGuts && <li><span className="ex-ic"><Icon name="board" /></span>{practice && p.kind !== 'guts' ? 'In Guts, a live scoreboard sits beside the problems.' : `A live scoreboard sits beside the problems. It freezes ${p.freezeMinutes ?? 10} minutes before the end.`}</li>}
        </ul>
        <div className="stack" style={{ gap: 16 }}>
          <label className="field">
            <span>Type your full name to promise the work is {p.kind === 'individual' ? 'your own' : 'your team’s own'}</span>
            <span className="ex-honor">
              <input className="input" value={honor} onChange={(e) => setHonor(e.target.value)} placeholder={p.name ?? 'Your full name'} autoComplete="off" spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && ok && onStart(honor.trim())} />
              <Tick on={ok} label={ok ? (p.name ? 'Name matches' : 'Name typed') : undefined} />
            </span>
          </label>
          <div className="ex-start">
            <button className="btn btn-primary btn-lg pt-start" type="button" disabled={!ok} onClick={() => onStart(honor.trim())}>Start {p.title}<Icon name="arrow" /></button>
            {p.name && !ok && <span className="muted">{p.audience === 'organiser' ? `Students type their own name; here, type ${p.name}.` : `Type ${p.name}.`}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- running

function Running({ p, stages, sim, setSim, onFinish, onTop }: {
  p: SimProps;
  stages: Stage[];
  sim: Sim;
  setSim: React.Dispatch<React.SetStateAction<Sim | null>>;
  onFinish: (timeUp: boolean) => void;
  onTop: () => void;
}) {
  const now = useNow(500);
  const total = p.minutes * 60000;
  const left = sim.deadline - now;
  const out = left <= 0;
  const index = Math.min(sim.stage, stages.length - 1);
  const stage = stages[index];
  const sets = stages.filter((s) => s.set !== null);
  const setNo = stage.set !== null ? sets.indexOf(stage) + 1 : 0;
  const last = index === stages.length - 1;
  const mixed = p.kind !== 'guts' && stages.length > 1;
  const policy = p.integrity ?? { policy: 'warn' as IntegrityPolicy, lockAfter: 4 };
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notFull, setNotFull] = useState(false);
  const [panel, setPanel] = useState<'board' | 'questions'>(stage.set !== null ? 'board' : 'questions');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const counted = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    if (out && !finished.current) {
      finished.current = true;
      onFinish(true);
    }
  }, [out, onFinish]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (stage.set !== null) setPanel('board');
  }, [stage.set]);

  const record = useCallback(
    (kind: IntegrityKind, ms?: number) => {
      setSim((s) => (s ? { ...s, events: [...s.events, { kind, ms, at: Date.now() }] } : s));
      // As in the real test: pastes and dropped connections are logged quietly.
      if (!COUNTED.includes(kind)) return;
      counted.current += 1;
      if (policy.policy === 'lock' && counted.current >= policy.lockAfter) {
        setSim((s) => (s ? { ...s, locked: true } : s));
        return;
      }
      if (policy.policy !== 'log') return setWarn(`You left the test${ms ? ` for ${duration(ms)}` : ''}. Your proctor can see this.`);
      toast('Recorded for the proctor', p.audience === 'organiser' ? 'This round only logs it: students see no message.' : 'In the real test your proctor sees it.');
    },
    [policy.policy, policy.lockAfter, p.audience, setSim],
  );
  useSimIntegrity(record, !sim.locked, setNotFull);

  const type = (q: Problem, value: string) => {
    setSim((s) => (s ? { ...s, responses: { ...s.responses, [q.id]: value } } : s));
    clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(() => {
      setSaving(false);
      setSavedAt(Date.now());
      setPulse((n) => n + 1);
    }, 400);
  };

  const valueOf = (q: Problem) => sim.responses[q.id] ?? '';
  const answered = p.problems.filter((q) => valueOf(q).trim()).length;
  const blanks = stage.problems.filter((q) => !valueOf(q).trim()).length;
  const low = left < 5 * 60000;
  const label = (q: Problem, i: number) => (stage.set !== null ? `${setNo}.${i + 1}` : String(q.number));
  const handLabel = stage.set !== null ? `Hand in set ${setNo}` : mixed && !last ? 'Hand in part 1' : 'Hand in';
  const title = stage.set !== null
    ? `${p.title}, ${mixed ? 'Guts-style set' : 'set'} ${setNo} of ${sets.length}`
    : mixed ? `${p.title}, part 1 of 2` : p.title;
  const real = p.audience === 'organiser' ? 'In the real test this is logged for the student’s proctor.' : 'In the real test this is logged for your proctor.';

  // The scoreboard during a Guts set: just you, scored by the key the moment a set is handed in.
  const handed = sets.filter((s) => stages.indexOf(s) < index);
  const score = handed.flatMap((s) => s.problems).reduce((sum, q) => sum + (gradeAnswer(q, valueOf(q), NO_RULINGS) === 'correct' ? q.points : 0), 0);
  const board = simBoard(p, sets.length, handed.length, stage.set !== null ? setNo : null, score);

  const handIn = () => {
    clearTimeout(timer.current);
    setSaving(false);
    setConfirm(false);
    if (last) {
      finished.current = true;
      return onFinish(false);
    }
    setSim((s) => (s ? { ...s, stage: s.stage + 1 } : s));
    if (stage.set !== null) toast(`Set ${setNo} handed in`, 'It is on the scoreboard now.', 'g');
    else toast('Part 1 handed in', 'Next: a Guts-style set. You get one set at a time.', 'g');
    requestAnimationFrame(onTop);
  };

  return (
    <>
      <div className="ex-bar">
        <div className="ex-l">
          <span>
            <b>{title}</b>
            <small>{p.who ?? sim.honor}</small>
          </span>
        </div>
        <div className={`ex-clock ${low ? 'low' : ''} ${out ? 'out' : ''}`} role="timer">{duration(Math.max(0, left))}</div>
        <div className="ex-r">
          <span key={pulse} className={`ex-saved ${saving ? 'busy' : pulse ? 'pulse' : ''}`} title={p.audience === 'organiser' ? 'Preview: kept in this tab only' : 'Practice: kept in this tab only'}><i />{saving ? 'Saving' : savedAt ? `Saved ${clockSec(new Date(savedAt))}` : 'Saves as you type'}</span>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setConfirm(true)}>{handLabel}</button>
        </div>
        <div className={`ex-track ${low ? 'low' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></div>
      </div>

      {notFull && (
        <div className="ex-banner amber" role="status">
          <Icon name="screen" />
          <span>You left fullscreen. <span className="ps-real-inline">{real}</span></span>
          <button className="btn btn-sm" type="button" onClick={() => document.documentElement.requestFullscreen?.().then(() => setNotFull(false)).catch(() => setNotFull(false))}>Go back to fullscreen</button>
        </div>
      )}

      <div className="ex-body">
        <div>
          {stage.set !== null && (
            <>
              <div className="ex-sets" aria-label={`Set ${setNo} of ${sets.length}`}>
                {sets.map((s, i) => <span key={s.set} className={i + 1 < setNo ? 'done' : i + 1 === setNo ? 'now' : ''} />)}
              </div>
              <div className="ex-setline">
                <span className="label">Set {setNo} · {stage.problems[0]?.points} {stage.problems[0]?.points === 1 ? 'point' : 'points'} each · you cannot come back to it</span>
                <span className="label">{p.audience === 'organiser' ? 'This preview' : 'You'}: {score} points</span>
              </div>
            </>
          )}
          {mixed && stage.set === null && (
            <div className="ex-setline">
              <span className="label">Part 1 · answer in any order · then a Guts-style set</span>
            </div>
          )}
          <div key={index}>
            {stage.problems.map((q, i) => {
              const v = valueOf(q);
              return (
                <div key={q.id} className={`ex-q ${v.trim() ? 'answered' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="ex-num">{label(q, i)}</span>
                  <div>
                    <MathText text={q.text} className="ex-text" />
                  </div>
                  <div className="ex-answer">
                    <input
                      aria-label={`Answer to problem ${label(q, i)}`}
                      value={v}
                      placeholder="Answer"
                      inputMode={q.answerType === 'integer' ? 'numeric' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={sim.locked}
                      onChange={(e) => type(q, e.target.value)}
                    />
                    <span className="ex-preview"><AnswerPreview value={v} /></span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="ex-foot">
            <span className="ex-progress"><i><em style={{ width: `${(answered / Math.max(1, p.problems.length)) * 100}%` }} /></i>{answered} of {p.problems.length} answered</span>
            <button className="btn btn-primary" type="button" onClick={() => setConfirm(true)}>{handLabel}</button>
          </div>
        </div>

        <aside className="ex-aside">
          {stage.set !== null && (
            <Segmented label="Side panel" value={panel} onChange={setPanel} items={[{ key: 'board', label: 'Scoreboard' }, { key: 'questions', label: 'Questions' }]} />
          )}
          {stage.set !== null && panel === 'board' ? (
            <div>
              <div className="ex-panel-head">
                <span className="label">{p.audience === 'organiser' ? 'Your division' : 'Practice'}</span>
                <span className="label"><span className="state go">Live</span></span>
              </div>
              <ScoreList board={board} mine="sim" limit={10} />
              <p className="muted tiny ps-board-note">{p.audience === 'organiser' ? 'Students see every team in their division here, live.' : 'On the day: every team in your division, live.'} It freezes {p.freezeMinutes ?? 10} minutes before the end.</p>
            </div>
          ) : (
            <SimQuestions audience={p.audience} />
          )}
        </aside>
      </div>

      {warn && (
        <Modal title="That was recorded" onClose={() => setWarn(null)} actions={<button className="btn btn-primary" type="button" onClick={() => setWarn(null)}>Back to the test</button>}>
          <p>{warn} Stay in this window until you hand in.</p>
          <p className="ps-real"><Icon name="info" size={14} /><span>{p.audience === 'organiser' ? 'Preview: nothing was logged.' : 'Practice: nothing was sent.'} {real}</span></p>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={stage.set !== null ? `Hand in set ${setNo}?` : mixed && !last ? 'Hand in part 1?' : `Hand in ${p.title}?`}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Keep working</button>
              <button className="btn btn-primary" type="button" onClick={handIn}>{last ? 'Hand in' : stage.set !== null ? 'Hand in, next set' : 'Hand in, next part'}</button>
            </>
          }
        >
          <p>
            {stage.set !== null
              ? `You cannot come back to set ${setNo}.${blanks ? ` ${blanks} of its answers ${blanks === 1 ? 'is' : 'are'} blank.` : ''}`
              : `${blanks ? `${blanks} ${blanks === 1 ? 'answer is' : 'answers are'} blank. ` : ''}You cannot change anything afterwards.`}
          </p>
        </Modal>
      )}
      {sim.locked && (
        <div className="ex-lock" role="alertdialog" aria-label="Test locked">
          <div>
            <span className="ex-lock-ic"><Icon name="lock" size={22} /></span>
            <h2>Your test is locked</h2>
            <p className="soft">You left the test too many times. Tell your proctor on Zoom; they can unlock it. Your answers are safe and the clock keeps running.</p>
            <p className="ex-clock" style={{ marginTop: 8 }}>{duration(Math.max(0, left))}</p>
            <p className="ps-real"><Icon name="info" size={14} /><span>{p.audience === 'organiser' ? 'Preview: in the real test a proctor unlocks it from the Live page.' : 'Practice: in the real test your proctor unlocks it.'}</span></p>
            <button className="btn" type="button" onClick={() => { counted.current = 0; setSim((s) => (s ? { ...s, locked: false } : s)); }}><Icon name="unlock" />Unlock and carry on</button>
          </div>
        </div>
      )}
    </>
  );
}

function simBoard(p: SimProps, totalSets: number, sets: number, current: number | null, score: number): Board {
  const round: Round = {
    id: 'sim', name: p.title, short: p.title, kind: p.kind, minutes: p.minutes, startsAt: new Date().toISOString(), status: 'open',
    graceSeconds: 0, integrity: p.integrity ?? { policy: 'warn', lockAfter: 4 }, problems: p.problems, rules: p.rules ?? '',
  };
  const team = { id: 'sim', name: p.audience === 'organiser' ? 'This preview' : 'You' } as Team;
  return {
    round,
    rows: [{ team, score, sets, current, started: true, place: 1, tied: false, lastSetAt: null }],
    totalSets,
    frozen: false,
    freezeAt: null,
    endsAt: null,
  };
}

/** The side panel's questions box. Nothing is sent; a note comes back saying who answers on the day. */
function SimQuestions({ audience }: { audience: SimProps['audience'] }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: number; question: string; at: number; answer?: string }[]>([]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    const id = Date.now();
    setItems((l) => [{ id, question, at: id }, ...l]);
    setQ('');
    setTimeout(() => {
      setItems((l) => l.map((x) => (x.id === id ? { ...x, answer: audience === 'organiser' ? 'Preview: not sent. On the day, questions arrive on the Live page and a proctor answers here.' : 'Practice: not sent. On the day a proctor answers here, and answers that help everyone are shown to everyone.' } : x)));
    }, 1800);
  };
  return (
    <div>
      <div className="ex-panel-head"><b>Questions</b>{items.length > 0 && <span className="label">{items.length}</span>}</div>
      {items.length === 0 && <p className="muted small">Ask if a problem is unclear. Answers that help everyone are shown to everyone.</p>}
      {items.map((c) => (
        <div key={c.id} className="ex-qa new">
          <small>{clock(new Date(c.at))} · to you</small>
          <div className="soft">{c.question}</div>
          {c.answer ? <div>{c.answer}</div> : <div className="muted">Waiting for a proctor</div>}
        </div>
      ))}
      <form className="ex-ask" onSubmit={send}>
        <textarea className="textarea" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a problem" />
        <button className="btn btn-sm" type="submit" disabled={!q.trim()}><Icon name="send" size={14} />Send</button>
      </form>
    </div>
  );
}

/**
 * What the real test notices, minus anything that needs a server: the tab
 * hidden, the window losing focus, fullscreen ending, a paste into an answer,
 * a dropped connection.
 */
function useSimIntegrity(record: (kind: IntegrityKind, ms?: number) => void, active: boolean, setNotFull: (v: boolean) => void) {
  const recordRef = useRef(record);
  recordRef.current = record;
  useEffect(() => {
    if (!active) return;
    let away: { start: number; kind: IntegrityKind } | null = null;
    const leave = (kind: IntegrityKind) => {
      if (!away) away = { start: Date.now(), kind };
      else if (kind === 'hidden') away.kind = 'hidden';
    };
    const back = () => {
      if (!away) return;
      const ms = Date.now() - away.start;
      const kind = away.kind;
      away = null;
      if (ms > 400) recordRef.current(kind, ms);
    };
    const onVis = () => (document.hidden ? leave('hidden') : back());
    const onBlur = () => leave('blur');
    const onFocus = () => back();
    let wasFull = !!document.fullscreenElement;
    const onFs = () => {
      const full = !!document.fullscreenElement;
      if (wasFull && !full) recordRef.current('fullscreen_exit');
      setNotFull(wasFull && !full);
      wasFull = full;
    };
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.ex-answer')) recordRef.current('paste');
    };
    let offlineAt = 0;
    const onOffline = () => (offlineAt = Date.now());
    const onOnline = () => offlineAt && recordRef.current('offline', Date.now() - offlineAt);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('paste', onPaste);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [active, setNotFull]);
}

// --------------------------------------------------------------- handed in

function Handed({ p, stages, sim, onResults }: { p: SimProps; stages: Stage[]; sim: Sim; onResults: () => void }) {
  const answered = p.problems.filter((q) => (sim.responses[q.id] ?? '').trim()).length;
  const sets = stages.filter((s) => s.set !== null);
  const score = sets.flatMap((s) => s.problems).reduce((sum, q) => sum + (gradeAnswer(q, sim.responses[q.id], NO_RULINGS) === 'correct' ? q.points : 0), 0);
  const timeUp = !!sim.timeUp;
  return (
    <>
      <div className="ex-bar"><div className="ex-l"><Logo size={24} /><span><b>{p.title}</b><small>{p.context}</small></span></div><div /><div className="ex-r" /></div>
      <div className="ex-done">
        <div>
          <svg className="ex-mark" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="32" fill={timeUp ? 'var(--amber)' : 'var(--green)'} />
            <path d="M20 33.5l8 8 16-17" />
          </svg>
          <h1>{timeUp ? 'Time’s up' : 'Handed in'}</h1>
          <p className="lede">{answered} of {p.problems.length} answered{sim.handedAt ? `, handed in at ${clock(new Date(sim.handedAt))}` : ''}. {p.audience === 'organiser' ? 'Students see their results when you publish them.' : 'On the day, your results appear on your page when the organisers publish them.'}</p>
        </div>
        {sets.length > 0 && (
          <div className="card pt-card ex-done-board">
            <div className="ex-panel-head"><b>Scoreboard</b><span className="label">{p.audience === 'organiser' ? 'This preview only' : 'Practice'}</span></div>
            <ScoreList board={simBoard(p, sets.length, sets.length, null, score)} mine="sim" limit={8} />
          </div>
        )}
        <div className="ex-start">
          <button className="btn btn-primary btn-lg" type="button" onClick={onResults}>{p.audience === 'organiser' ? 'See the marking' : 'Check your answers'}<Icon name="arrow" /></button>
          <Link className="btn btn-lg btn-quiet" to={p.exit.to}>{p.exit.label}</Link>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- results

const STATUS: Record<GradeStatus, { tone: 'ok' | 'bad' | 'off' | 'wait'; word: string }> = {
  correct: { tone: 'ok', word: 'Correct' },
  incorrect: { tone: 'bad', word: 'Incorrect' },
  blank: { tone: 'off', word: 'No answer' },
  unreviewed: { tone: 'wait', word: 'A grader decides' },
};

function Key({ answers }: { answers: string[] }) {
  const list = answers.filter((a) => a.trim());
  if (!list.length) return <span className="muted">No key yet</span>;
  return (
    <>
      {list.map((a, i) => (
        <span key={i} className="ps-key-one">
          {i > 0 && <span className="muted"> or </span>}
          {/^-?[\d,.]+$/.test(a.trim()) ? <span className="mono">{a}</span> : <MathText text={`$${a.trim().replace(/^\$+|\$+$/g, '')}$`} />}
        </span>
      ))}
    </>
  );
}

function describe(e: SimEvent): string {
  const t = e.ms ? ` for ${duration(e.ms)}` : '';
  switch (e.kind) {
    case 'hidden': return `Switched to another tab or app${t}`;
    case 'blur': return `Clicked outside the test window${t}`;
    case 'fullscreen_exit': return 'Left fullscreen';
    case 'paste': return 'Pasted into an answer';
    case 'offline': return `Lost the connection${t}`;
    default: return e.kind;
  }
}

function Results({ p, stages, sim, onAgain }: { p: SimProps; stages: Stage[]; sim: Sim; onAgain: () => void }) {
  const graded = p.problems.map((q) => ({ q, status: gradeAnswer(q, sim.responses[q.id], NO_RULINGS) }));
  const correct = graded.filter((g) => g.status === 'correct').length;
  const unreviewed = graded.filter((g) => g.status === 'unreviewed').length;
  const points = graded.reduce((s, g) => s + (g.status === 'correct' ? g.q.points : 0), 0);
  const max = p.problems.reduce((s, q) => s + q.points, 0);
  const used = Math.min(p.minutes * 60000, (sim.handedAt ?? Date.now()) - sim.startedAt);
  const sets = stages.filter((s) => s.set !== null);
  const mixed = p.kind !== 'guts' && stages.length > 1;
  const stageTitle = (s: Stage) => (s.set === null ? (mixed ? 'Part 1' : '') : `${mixed ? 'Guts-style set' : 'Set'} ${sets.indexOf(s) + 1}`);
  const organiser = p.audience === 'organiser';
  let n = 0;
  return (
    <>
      <div className="ex-bar">
        <div className="ex-l"><Logo size={24} /><span><b>{p.title}</b><small>{organiser ? 'Marked against the key' : 'Your answers, marked'}</small></span></div>
        <div />
        <div className="ex-r"><Link className="btn btn-sm btn-quiet" to={p.exit.to}><Icon name="back" />Back</Link></div>
      </div>
      <div className="ps-results">
        <header className="ps-score">
          <Ring value={correct} total={p.problems.length} size={76} tone={correct === p.problems.length ? 'green' : 'ink'} label={`${correct} of ${p.problems.length} correct`} />
          <div className="ps-score-text">
            <h1>{correct} of {p.problems.length} correct</h1>
            <p className="lede">
              {points} of {max} points{unreviewed ? `, and ${unreviewed} for a grader to decide` : ''}. {sim.timeUp ? 'The clock ran out' : `Handed in after ${duration(used)}`} of {p.minutes} minutes.
            </p>
          </div>
          <div className="ps-score-act">
            <button className="btn" type="button" onClick={onAgain}><Icon name="refresh" />{organiser ? 'Preview again' : 'Try again'}</button>
            <Link className="btn btn-primary" to={p.exit.to}>{p.exit.label}<Icon name="arrow" /></Link>
          </div>
        </header>

        {stages.map((s) => (
          <section key={s.set ?? 'all'} className="ps-stage">
            {stageTitle(s) && <h2 className="ps-h">{stageTitle(s)}{s.set !== null && <span className="label">{s.problems[0]?.points} points each</span>}</h2>}
            <ol className="ps-list">
              {s.problems.map((q, i) => {
                const v = (sim.responses[q.id] ?? '').trim();
                const status = gradeAnswer(q, v, NO_RULINGS);
                const st = STATUS[status];
                const label = s.set !== null ? `${sets.indexOf(s) + 1}.${i + 1}` : String(q.number);
                return (
                  <li key={q.id} className={`ps-row ${status}`} style={{ animationDelay: `${Math.min(n++, 12) * 35}ms` }}>
                    <span className="ex-num">{label}</span>
                    <div className="ps-q">
                      <MathText text={q.text} className="ps-text" />
                      <div className="ps-pair">
                        <span className="ps-cell"><span className="label">{organiser ? 'Typed' : 'You'}</span>{v ? <span className="ps-yours"><span className="mono">{v}</span>{/[\\/^]|sqrt/.test(v) && <span className="ps-render"><AnswerPreview value={v} /></span>}</span> : <span className="muted">Blank</span>}</span>
                        <span className="ps-cell"><span className="label">Key</span><span className="ps-key"><Key answers={q.answers} /></span></span>
                      </div>
                      {status === 'unreviewed' && <p className="ps-why">Not an exact match for the key. On the day a grader decides whether this form counts; write answers exactly, like fractions in lowest terms.</p>}
                    </div>
                    <span className="ps-status"><State tone={st.tone}>{st.word}</State>{status === 'correct' && q.points > 1 && <small>+{q.points}</small>}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        <section className="ps-stage ps-log">
          <h2 className="ps-h"><span className="row" style={{ gap: 8 }}><Icon name="eye" size={16} />What {organiser ? 'a' : 'your'} proctor would have seen</span></h2>
          {sim.events.length === 0 ? (
            <p className="ps-clean"><Tick on /><span>Nothing. You stayed in the test the whole time.</span></p>
          ) : (
            <ul className="ps-events">
              {sim.events.map((e, i) => (
                <li key={i}><span className="mono muted">{clockSec(new Date(e.at))}</span><span>{describe(e)}</span>{COUNTED.includes(e.kind) && <State tone="wait">Counted</State>}</li>
              ))}
            </ul>
          )}
          <p className="muted small">{organiser ? 'In a real round these appear on the Live page beside the student’s name.' : 'In the real test this list goes to your proctor. Nothing from this practice was sent.'}</p>
        </section>
      </div>
    </>
  );
}
