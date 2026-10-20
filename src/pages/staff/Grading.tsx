import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type ReactNode } from 'react';
import { modeOf, offers, savePaperGutsSet, savePaperSheet, setRuling } from '../../lib/actions';
import { useContest, useLookups, useStandings } from '../../lib/hooks';
import type { Problem, Round } from '../../lib/model';
import { gradeAnswer, indexRulings, normalize } from '../../lib/scoring/answers';
import { distinctAnswers } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, roundState } from '../../lib/time';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import { EmptyState, MathText, Roll, Segmented, Tabs, toast, Track } from '../../components/ui';
import '../../styles/live.css';

type Tab = 'key' | 'review' | 'progress';

/** What is left to key for a round: paper sheets (or Guts sets) from in-person entrants. */
function useKeyLeft() {
  const db = useDB();
  const contest = useContest();
  return (round: Round) => {
    const here = db.teams.filter((t) => modeOf(contest, t) === 'in_person' && t.status !== 'withdrawn');
    const paper = db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper');
    if (round.kind === 'guts') {
      const sets = Math.max(1, ...round.problems.map((p) => p.set ?? 1));
      const done = here.reduce((n, t) => n + Math.min(sets, paper.find((a) => a.entrantId === t.id)?.setsSubmitted ?? 0), 0);
      return { done, total: here.length * sets };
    }
    const ids = round.kind === 'individual' ? db.competitors.filter((c) => here.some((t) => t.id === c.teamId)).map((c) => c.id) : here.map((t) => t.id);
    const keyed = new Set(paper.map((a) => a.entrantId));
    return { done: ids.filter((id) => keyed.has(id)).length, total: ids.length };
  };
}

export function Grading() {
  const contest = useContest();
  const me = useUser()!;
  const director = me.role === 'director' || me.role === 'staff';
  const rounds = contest.rounds.filter((r) => director || me.roundIds?.includes(r.id));
  if (!rounds.length) {
    return (
      <>
        <div className="page-head"><div><h1 className="page-title">Grading</h1><p className="page-sub">{director ? 'Key paper answers and rule on unusual ones.' : 'Nothing to grade for you yet.'}</p></div></div>
        <section className="card">
          <EmptyState
            icon={me.role === 'proctor' ? 'live' : 'grading'}
            title={director ? 'No rounds yet' : me.role === 'proctor' ? 'Grading is done by graders' : 'No rounds assigned to you'}
            action={director ? <Link className="btn btn-primary" to="/staff/rounds"><Icon name="plus" />Add rounds</Link> : me.role === 'proctor' ? <Link className="btn btn-primary" to="/staff/live">Go to Live<Icon name="arrow" /></Link> : undefined}
          >
            {director ? 'Add the contest’s rounds and their answer keys first; then graders key paper sheets here.' : me.role === 'proctor' ? 'As a proctor you watch your Zoom room and answer questions on the Live page.' : 'The contest director chooses which rounds each grader keys. Ask them to add you to a round.'}
          </EmptyState>
        </section>
      </>
    );
  }
  return <GradingRounds rounds={rounds} director={director} />;
}

function GradingRounds({ rounds, director }: { rounds: Round[]; director: boolean }) {
  const contest = useContest();
  const standings = useStandings();
  const keyLeft = useKeyLeft();
  const paper = offers(contest, 'in_person');
  const now = Date.now();
  const work = (r: Round) => {
    if (roundState(r, now) === 'scheduled') return 0;
    const k = paper ? keyLeft(r) : { done: 0, total: 0 };
    return k.total - k.done + (director ? standings.unreviewed[r.id] ?? 0 : 0);
  };
  const best = (r: Round): Tab => {
    const k = keyLeft(r);
    if (paper && k.done < k.total && roundState(r, now) !== 'scheduled') return 'key';
    if (director && (standings.unreviewed[r.id] ?? 0) > 0) return 'review';
    return paper ? 'key' : director ? 'review' : 'progress';
  };
  const [roundId, setRoundId] = useState(() =>
    (rounds.find((r) => roundState(r, now) === 'open') ?? rounds.find((r) => work(r) > 0) ?? rounds[rounds.length - 1]).id);
  const round = rounds.find((r) => r.id === roundId) ?? rounds[0];
  const [tab, setTab] = useState<Tab>(() => best(round));
  const pick = (id: string) => { setRoundId(id); setTab(best(rounds.find((r) => r.id === id)!)); };
  const toRule = standings.unreviewed[round.id] ?? 0;
  const k = keyLeft(round);
  const unit = round.kind === 'guts' ? 'sets' : 'sheets';
  const sub = [
    paper && (k.total - k.done > 0 ? `${k.total - k.done} ${unit} left to key` : k.total ? `every ${round.kind === 'guts' ? 'set' : 'sheet'} keyed` : ''),
    director && (toRule ? `${toRule} ${toRule === 1 ? 'answer needs' : 'answers need'} a ruling` : 'nothing to rule on'),
  ].filter(Boolean).join(' · ');
  const elsewhere = director ? rounds.filter((r) => r.id !== round.id && (standings.unreviewed[r.id] ?? 0) > 0) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Grading</h1>
          <p className="page-sub">{round.name}: {sub || 'nothing waiting'}.{elsewhere.length > 0 && <> Also {elsewhere.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<button type="button" className="linkbtn" style={{ fontWeight: 500 }} onClick={() => { setRoundId(r.id); setTab('review'); }}>{standings.unreviewed[r.id]} to rule on in {r.short}</button></span>)}.</>}{!director && rounds.length > 1 ? ` You key ${rounds.map((r) => r.short).join(', ')}.` : ''}</p>
        </div>
        {rounds.length > 1 && <Segmented label="Round" value={round.id} onChange={pick} items={rounds.map((r) => ({ key: r.id, label: r.short, count: work(r) || undefined }))} />}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ...(paper ? [{ key: 'key' as Tab, label: round.kind === 'guts' ? 'Key sets' : 'Key sheets', count: k.total - k.done || undefined }] : []),
          ...(director ? [{ key: 'review' as Tab, label: 'Review answers', count: toRule || undefined }] : []),
          { key: 'progress', label: 'Progress' },
        ]}
      />
      <section className="card gr">
        {tab === 'key' && (round.kind === 'guts' ? <KeyGuts key={round.id} round={round} onReview={director && toRule ? () => setTab('review') : undefined} /> : <KeySheet key={round.id} round={round} onReview={director && toRule ? () => setTab('review') : undefined} />)}
        {tab === 'review' && <Review key={round.id} round={round} />}
        {tab === 'progress' && <Progress round={round} />}
      </section>
    </>
  );
}

/** How to key, shown until an ID is typed. */
function Steps({ items }: { items: string[] }) {
  return (
    <ol className="gr-steps">
      {items.map((t, i) => <li key={t}><span className="gr-step-n">{i + 1}</span><span>{t}</span></li>)}
    </ol>
  );
}

/** A tick that pops in and draws itself. */
function Tick() {
  return (
    <span className="gr-tick" aria-hidden="true">
      <svg viewBox="0 0 16 16"><path d="M4 8.4l2.6 2.6L12.2 5.4" /></svg>
    </span>
  );
}

function Done({ text, onReview, n }: { text: string; onReview?: () => void; n?: number }) {
  return (
    <div className="gr-done">
      <Tick />
      <span className="grow">{text}</span>
      {onReview && <button className="btn btn-sm btn-primary" type="button" onClick={onReview}>Review {n ? `${n} ` : ''}answers<Icon name="arrow" size={14} /></button>}
    </div>
  );
}

/** The sheet just saved, so the grader can look up from the paper and see it went in. */
function Saved({ text }: { text: ReactNode }) {
  return <div className="gr-saved" role="status"><Tick /><span>{text}</span></div>;
}

/** Enter moves on, arrows move around, Backspace on an empty box steps back, a pasted row fills across. */
function useKeypad(count: number, cols: number, onDone: () => void) {
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const onKey = (i: number) => (e: RKE<HTMLInputElement>) => {
    const go = (to: number) => {
      e.preventDefault();
      cells.current[Math.max(0, Math.min(count - 1, to))]?.focus();
    };
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      if (i === count - 1 || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        onDone();
      } else go(i + 1);
    } else if (e.key === 'ArrowRight' && (el.selectionStart ?? 0) >= el.value.length) go(i + 1);
    else if (e.key === 'ArrowLeft' && (el.selectionStart ?? 0) === 0) go(i - 1);
    else if (e.key === 'ArrowDown') go(i + cols);
    else if (e.key === 'ArrowUp') go(i - cols);
    else if (e.key === 'Backspace' && !el.value) go(i - 1);
  };
  return { cells, onKey };
}

function Cells({ problems, values, set, rulings, cells, onKey, label, cols }: {
  problems: Problem[];
  values: Record<string, string>;
  set: (pid: string, v: string) => void;
  rulings: ReturnType<typeof indexRulings>;
  cells: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onKey: (i: number) => (e: RKE<HTMLInputElement>) => void;
  label: (p: Problem) => string;
  cols: number;
}) {
  return (
    <div className="keypad" style={{ ['--cols' as string]: cols }}>
      {problems.map((p, i) => {
        const v = values[p.id] ?? '';
        const g = v.trim() ? gradeAnswer(p, v, rulings) : '';
        return (
          <div key={p.id} className={`kcell ${g}`}>
            <label htmlFor={`k-${p.id}`}>
              {label(p)}
              {g && <Icon name={g === 'correct' ? 'check' : g === 'incorrect' ? 'close' : 'help'} size={12} />}
              {g && <span className="sr">{g === 'correct' ? 'right' : g === 'incorrect' ? 'wrong' : 'needs a ruling'}</span>}
            </label>
            <input
              id={`k-${p.id}`}
              ref={(el) => { cells.current[i] = el; }}
              value={v}
              inputMode={p.answerType === 'integer' ? 'numeric' : 'text'}
              autoComplete="off"
              onChange={(e) => set(p.id, e.target.value)}
              onKeyDown={onKey(i)}
              onPaste={(e) => {
                const parts = e.clipboardData.getData('text').trim().split(/[\s,;]+/);
                if (parts.length < 2) return;
                e.preventDefault();
                parts.forEach((part, k) => problems[i + k] && set(problems[i + k].id, part));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function KeySheet({ round, onReview }: { round: Round; onReview?: () => void }) {
  const db = useDB();
  const me = useUser()!;
  const standings = useStandings();
  const [id, setId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<{ n: number; text: ReactNode } | null>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const rulings = useMemo(() => indexRulings(db.rulings), [db.rulings]);
  const contest = useContest();
  const inPerson = db.teams.filter((t) => modeOf(contest, t) === 'in_person' && t.status !== 'withdrawn');
  const pool = round.kind === 'individual'
    ? db.competitors.filter((c) => inPerson.some((t) => t.id === c.teamId)).map((c) => ({ id: c.id, code: c.publicId, name: c.name }))
    : inPerson.map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const match = pool.find((p) => p.code.toLowerCase() === id.trim().toLowerCase());
  const keyed = new Set(db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper').map((a) => a.entrantId));
  const queue = pool.filter((p) => !keyed.has(p.id));
  const what = round.kind === 'individual' ? 'competitor ID' : 'team number';
  const save = () => {
    if (!match) return;
    savePaperSheet(round.id, match.id, values, me.id);
    setSaved((x) => ({ n: (x?.n ?? 0) + 1, text: <>Saved <b className="mono">{match.code}</b> {match.name} · {score} of {max}</> }));
    setId('');
    setValues({});
    idRef.current?.focus();
  };
  const { cells, onKey } = useKeypad(round.problems.length, 5, save);
  useEffect(() => {
    const a = match && db.attempts.find((x) => x.roundId === round.id && x.entrantId === match.id);
    setValues(match ? Object.fromEntries(round.problems.map((p) => [p.id, a?.responses[p.id]?.value ?? ''])) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, round.id]);
  const score = round.problems.reduce((n, p) => n + (gradeAnswer(p, values[p.id], rulings) === 'correct' ? p.points : 0), 0);
  const max = round.problems.reduce((n, p) => n + p.points, 0);
  const jump = (code: string) => { setId(code); setTimeout(() => cells.current[0]?.focus(), 20); };

  return (
    <div className="split">
      <div className="stack-lg" style={{ gap: 24 }}>
        <div className="gr-entry">
          <label className="field" style={{ width: 160 }}>
            <span>{round.kind === 'individual' ? 'Competitor ID' : 'Team number'}</span>
            <input ref={idRef} className="input mono gr-id" autoFocus value={id} onChange={(e) => setId(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && match) { e.preventDefault(); cells.current[0]?.focus(); } }} />
          </label>
          <div className="grow" style={{ paddingBottom: 8, minWidth: 160 }}>
            {match
              ? <div className="gr-who" key={match.id}>{match.name}<small>{keyed.has(match.id) ? 'Keyed before. Saving replaces it.' : 'Not keyed yet'}</small></div>
              : id
                ? <span className="gr-miss"><Icon name="alert" size={15} />No in-person {round.kind === 'individual' ? 'competitor' : 'team'} {id}</span>
                : saved && <Saved key={saved.n} text={saved.text} />}
          </div>
          {match && <div className="gr-score" style={{ paddingBottom: 6 }}><Roll value={score} /><span className="muted"> / {max}</span></div>}
        </div>
        {match ? (
          <>
            <Cells problems={round.problems} values={values} set={(pid, v) => setValues((x) => ({ ...x, [pid]: v }))} rulings={rulings} cells={cells} onKey={onKey} label={(p) => `${p.number}`} cols={5} />
            <div className="gr-save">
              <button className="btn btn-primary btn-lg" type="button" onClick={save} title="Enter on the last box also saves"><Icon name="check" />Save {match.code}</button>
              <button className="btn btn-quiet" type="button" onClick={() => { setId(''); idRef.current?.focus(); }}>Cancel</button>
              <span className="gr-hint">Leave a box empty for a blank. Green is right, red wrong, amber needs a ruling.</span>
            </div>
          </>
        ) : (
          <Steps items={[`Type the ${what} printed on the sheet, then Enter.`, 'Type each answer. Enter moves to the next box.', 'Enter on the last box saves, and the next sheet is ready.']} />
        )}
      </div>
      <aside className="gr-aside">
        <div className="gr-queue-head"><h2>Still to key</h2><span className="label">{pool.length - queue.length} of {pool.length} keyed</span></div>
        <div className="progress green ease"><i style={{ width: `${((pool.length - queue.length) / Math.max(1, pool.length)) * 100}%` }} /></div>
        {queue.length === 0 ? <Done text={pool.length ? 'Every sheet is keyed.' : 'No in-person sheets for this round.'} onReview={onReview} n={standings.unreviewed[round.id]} /> : (
          <div className="gr-chips">
            {queue.slice(0, 60).map((p) => <button key={p.id} type="button" className="gr-chip" title={p.name} onClick={() => jump(p.code)}>{p.code}</button>)}
            {queue.length > 60 && <span className="muted small">and {queue.length - 60} more</span>}
          </div>
        )}
      </aside>
    </div>
  );
}

function KeyGuts({ round, onReview }: { round: Round; onReview?: () => void }) {
  const db = useDB();
  const me = useUser()!;
  const standings = useStandings();
  const [code, setCode] = useState('');
  const [setNo, setSetNo] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<{ n: number; text: ReactNode } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const rulings = useMemo(() => indexRulings(db.rulings), [db.rulings]);
  const contest = useContest();
  const teams = db.teams.filter((t) => modeOf(contest, t) === 'in_person' && t.status !== 'withdrawn');
  const team = teams.find((t) => t.code === code.trim().padStart(2, '0') && code.trim());
  const attempt = team && db.attempts.find((a) => a.roundId === round.id && a.entrantId === team.id);
  const problems = round.problems.filter((p) => p.set === setNo);
  const totalSets = Math.max(...round.problems.map((p) => p.set ?? 1));
  const doneOf = (id: string) => db.attempts.find((x) => x.roundId === round.id && x.entrantId === id)?.setsSubmitted ?? 0;
  const keyedSets = teams.reduce((n, t) => n + Math.min(totalSets, doneOf(t.id)), 0);
  const allSets = teams.length * totalSets;

  // Typing a team number jumps to its next set.
  useEffect(() => {
    if (team) setSetNo(Math.min(totalSets, (attempt?.setsSubmitted ?? 0) + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id]);
  useEffect(() => {
    setValues(Object.fromEntries(problems.map((p) => [p.id, attempt?.responses[p.id]?.value ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, setNo]);

  const save = () => {
    if (!team) return;
    savePaperGutsSet(round.id, team.id, setNo, values, me.id);
    const pts = problems.reduce((n, p) => n + (gradeAnswer(p, values[p.id], rulings) === 'correct' ? p.points : 0), 0);
    setSaved((x) => ({ n: (x?.n ?? 0) + 1, text: <>Set {setNo} for <b className="mono">{team.code}</b> {team.name} · {pts} {pts === 1 ? 'point' : 'points'}, on the board now</> }));
    setCode('');
    setValues({});
    codeRef.current?.focus();
  };
  const { cells, onKey } = useKeypad(4, 4, save);
  const pts = problems.reduce((n, p) => n + (gradeAnswer(p, values[p.id], rulings) === 'correct' ? p.points : 0), 0);
  const rekey = !!team && (attempt?.setsSubmitted ?? 0) >= setNo;

  return (
    <div className="split">
      <div className="stack-lg" style={{ gap: 24 }}>
        <div className="gr-entry">
          <label className="field" style={{ width: 120 }}>
            <span>Team number</span>
            <input ref={codeRef} className="input mono gr-id" autoFocus value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={(e) => { if (e.key === 'Enter' && team) { e.preventDefault(); cells.current[0]?.focus(); } }} />
          </label>
          <div className="grow" style={{ paddingBottom: 8, minWidth: 160 }}>
            {team
              ? <div className="gr-who" key={team.id}>{team.name}<small>{rekey ? `Set ${setNo} was keyed before. Saving replaces it.` : `Set ${setNo} is next to key`}</small></div>
              : code
                ? <span className="gr-miss"><Icon name="alert" size={15} />No in-person team {code}</span>
                : saved && <Saved key={saved.n} text={saved.text} />}
          </div>
          {team && <div className="gr-score" style={{ paddingBottom: 6 }}><Roll value={pts} /><span className="muted"> pts</span></div>}
        </div>
        {team ? (
          <>
            <div className="field" style={{ alignSelf: 'flex-start' }}>
              <span>Set</span>
              <Segmented label="Set" value={String(setNo)} onChange={(x) => setSetNo(Number(x))} items={Array.from({ length: totalSets }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }))} />
            </div>
            <Cells problems={problems} values={values} set={(pid, v) => setValues((x) => ({ ...x, [pid]: v }))} rulings={rulings} cells={cells} onKey={onKey} label={(p) => `${p.set}.${((p.number - 1) % 4) + 1} · ${p.points} pts`} cols={4} />
            <div className="gr-save">
              <button className="btn btn-primary btn-lg" type="button" onClick={save} title="Enter on the last box also saves"><Icon name="check" />Save set {setNo}</button>
              <button className="btn btn-quiet" type="button" onClick={() => { setCode(''); codeRef.current?.focus(); }}>Cancel</button>
              <span className="gr-hint">A saved set goes straight onto the scoreboard.</span>
            </div>
          </>
        ) : (
          <Steps items={['Type the team number written on the set, then Enter.', 'The set number picks itself: the team’s next set. Change it if the sheet says otherwise.', 'Type the four answers. Enter on the last box saves it onto the board.']} />
        )}
      </div>
      <aside className="gr-aside">
        <div className="gr-queue-head"><h2>Sets keyed</h2><span className="label">{keyedSets} of {allSets}</span></div>
        <div className="progress green ease"><i style={{ width: `${(keyedSets / Math.max(1, allSets)) * 100}%` }} /></div>
        {keyedSets >= allSets && <div style={{ marginBottom: 12 }}><Done text={teams.length ? 'Every set is keyed.' : 'No in-person teams.'} onReview={onReview} n={standings.unreviewed[round.id]} /></div>}
        <div className="gr-list">
          {teams.map((t) => {
            const done = doneOf(t.id);
            return (
              <button key={t.id} type="button" className={`list-btn ${team?.id === t.id ? 'on' : ''} ${done >= totalSets ? 'done' : ''}`} onClick={() => { setCode(t.code); setTimeout(() => cells.current[0]?.focus(), 30); }}>
                <span className="row" style={{ gap: 10, minWidth: 0 }}><span className="mono">{t.code}</span><span className="ellipsis">{t.name}</span></span>
                {done >= totalSets ? <Icon name="check" size={15} className="done-ic" /> : <Track done={done} total={totalSets} current={done < totalSets ? done + 1 : null} />}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function Review({ round }: { round: Round }) {
  const db = useDB();
  const me = useUser()!;
  const attempts = db.attempts.filter((a) => a.roundId === round.id && (a.source === 'paper' || a.startedAt));
  const groupsBy = useMemo(
    () => Object.fromEntries(round.problems.map((p) => [p.id, distinctAnswers(p, attempts, db.rulings, (raw) => normalize(raw, p.answerType))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.attempts, db.rulings, round],
  );
  const openOf = (id: string) => groupsBy[id].filter((g) => g.status === 'unreviewed').length;
  const firstOpen = round.problems.find((p) => openOf(p.id) > 0);
  const [pid, setPid] = useState((firstOpen ?? round.problems[0]).id);
  const problem = round.problems.find((p) => p.id === pid) ?? round.problems[0];
  // Answers waiting for a ruling first; the rest keep their order (most common first).
  const groups = groupsBy[problem.id].slice().sort((a, b) => Number(b.status === 'unreviewed') - Number(a.status === 'unreviewed'));
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.list-btn.on');
    if (list && el && list.scrollHeight > list.clientHeight) list.scrollTop = el.offsetTop - list.clientHeight / 2;
  }, [problem.id]);
  const ruled = new Map(db.rulings.filter((r) => r.problemId === problem.id).map((r) => [r.normalized, r.correct]));
  const name = (p: Problem) => (round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : `Problem ${p.number}`);
  const idx = round.problems.findIndex((p) => p.id === problem.id);
  const next = [...round.problems.slice(idx + 1), ...round.problems.slice(0, idx)].find((p) => openOf(p.id) > 0);
  const here = openOf(problem.id);
  const left = round.problems.reduce((n, p) => n + openOf(p.id), 0);

  return (
    <div className="gr-rv">
      <aside className="gr-probs" aria-label="Problems" ref={listRef}>
        {round.problems.map((p) => {
          const open = openOf(p.id);
          return (
            <button key={p.id} type="button" className={`list-btn ${p.id === problem.id ? 'on' : ''}`} onClick={() => setPid(p.id)}>
              <span>{name(p)}</span>
              {open ? <span className="badge">{open}</span> : <span className="muted tiny" title={`${groupsBy[p.id].length} different answers`}>{groupsBy[p.id].length}</span>}
            </button>
          );
        })}
      </aside>
      <div className="stack-lg" style={{ gap: 24, minWidth: 0 }}>
        {left === 0 && <Done text={`Every unusual answer in ${round.name} has a ruling.`} />}
        <div className="stack" style={{ gap: 10 }}>
          <div className="gr-prob-head">
            <h2>{name(problem)}</h2>
            <span className="gr-key">Key <b>{problem.answers.map(plainAnswer).join(' or ')}</b></span>
            <span className="grow" />
            {here > 0 && <span className="state wait">{here} to rule on</span>}
          </div>
          <MathText text={problem.text} className="q-text" />
        </div>
        <div>
          <div className="gr-answers-head">
            <h3>Every different answer given <span className="muted" style={{ fontWeight: 450 }}>{groups.length}</span></h3>
            {here > 0 && <button className="btn btn-sm" type="button" onClick={() => { groups.filter((g) => g.status === 'unreviewed').forEach((g) => setRuling(round.id, problem.id, g.normalized, false, me.id)); toast(`Marked ${here} ${here === 1 ? 'answer' : 'answers'} wrong`, 'You can still change each one.'); }}>Mark the other {here} wrong</button>}
          </div>
          {groups.length === 0 && <p className="muted small" style={{ padding: '12px 0' }}>No answers yet.</p>}
          {groups.map((g) => {
            const r = ruled.get(g.normalized);
            return (
              <div key={g.normalized} className={`answer-row ${g.status === 'unreviewed' ? 'open' : ''}`}>
                <div>{g.samples.map((x) => <code key={x}>{x}</code>)}</div>
                <span className="num soft" title={`${g.count} gave this answer`}>{g.count}×</span>
                {g.status === 'correct' && r === undefined ? (
                  <span className="gr-match ok"><Icon name="check" size={15} />Matches the key</span>
                ) : g.status === 'incorrect' && r === undefined ? (
                  <span className="gr-match no">Different value, wrong</span>
                ) : (
                  <div className="verdict" role="group" aria-label={`Ruling on ${g.samples[0]}`}>
                    <button type="button" className={r === true ? 'yes' : ''} aria-pressed={r === true} onClick={() => setRuling(round.id, problem.id, g.normalized, r === true ? null : true, me.id)}><Icon name="check" size={14} />Correct</button>
                    <button type="button" className={r === false ? 'no' : ''} aria-pressed={r === false} onClick={() => setRuling(round.id, problem.id, g.normalized, r === false ? null : false, me.id)}><Icon name="close" size={14} />Wrong</button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="gr-next">
            <span className="muted small grow">A ruling applies to everyone who gave that answer, online and on paper. Click a ruling again to undo it.</span>
            {here === 0 && next && <button className="btn btn-primary" type="button" onClick={() => setPid(next.id)}>Next: {name(next)} · {openOf(next.id)} to rule<Icon name="arrow" size={14} /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Progress({ round }: { round: Round }) {
  const db = useDB();
  const { user } = useLookups();
  const paper = db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper');
  const by = new Map<string, { n: number; last: string }>();
  for (const a of paper) {
    const r = Object.values(a.responses)[0];
    const who = r?.by ?? 'u-grader';
    const cur = by.get(who) ?? { n: 0, last: '' };
    by.set(who, { n: cur.n + (round.kind === 'guts' ? a.setsSubmitted ?? 0 : 1), last: (r?.savedAt ?? '') > cur.last ? r!.savedAt : cur.last });
  }
  if (by.size === 0) return <EmptyState icon="grading" title={`Nothing keyed for ${round.name} yet`}>Each grader’s count shows here as paper {round.kind === 'guts' ? 'sets' : 'sheets'} are keyed.</EmptyState>;
  const top = Math.max(1, ...[...by.values()].map((v) => v.n));
  return (
    <div className="table-scroll">
      <table className="t">
        <thead><tr><th>Grader</th><th className="num">{round.kind === 'guts' ? 'Sets keyed' : 'Sheets keyed'}</th><th className="num">Last</th></tr></thead>
        <tbody>
          {[...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, v]) => (
            <tr key={id}>
              <td className="name">{user.get(id)?.name ?? 'Grader'}</td>
              <td className="num"><span className="lv-share"><span>{v.n}</span><i aria-hidden="true"><i className="full" style={{ width: `${(v.n / top) * 100}%` }} /></i></span></td>
              <td className="num muted">{v.last ? clock(v.last) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A key written in TeX, shown the way a competitor would type it. */
function plainAnswer(tex: string) {
  return tex
    .replace(/\\[dt]?frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')
    .replace(/\\pi/g, 'π')
    .replace(/[{}\\]/g, '');
}
