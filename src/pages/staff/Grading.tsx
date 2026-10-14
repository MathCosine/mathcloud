import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from 'react';
import { modeOf, offers, savePaperGutsSet, savePaperSheet, setRuling } from '../../lib/actions';
import { useContest, useLookups, useStandings } from '../../lib/hooks';
import type { Problem, Round } from '../../lib/model';
import { gradeAnswer, indexRulings, normalize } from '../../lib/scoring/answers';
import { distinctAnswers } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock } from '../../lib/time';
import { MathText, Roll, Segmented, Tabs, toast, Track } from '../../components/ui';

type Tab = 'key' | 'review' | 'progress';

export function Grading() {
  const contest = useContest();
  const me = useUser()!;
  const standings = useStandings();
  const director = me.role === 'director' || me.role === 'staff';
  const rounds = contest.rounds.filter((r) => director || me.roundIds?.includes(r.id));
  const paper = offers(contest, 'in_person');
  const [tab, setTab] = useState<Tab>(paper ? 'key' : 'review');
  const [roundId, setRoundId] = useState(rounds[rounds.length - 1].id);
  const round = contest.rounds.find((r) => r.id === roundId)!;
  const toRule = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{paper ? 'Grading' : 'Review answers'}</h1>
          <p className="page-sub">{!director ? `You key ${rounds.map((r) => r.name).join(', ')}.` : paper && offers(contest, 'online') ? 'Graders key paper sheets; online answers mark themselves. Odd answers from both wait here for a ruling.' : paper ? 'Graders key the paper sheets. Odd answers wait here for a ruling.' : 'Online answers mark themselves. Odd answers wait here for a ruling.'}</p>
        </div>
        <Segmented label="Round" value={roundId} onChange={setRoundId} items={rounds.map((r) => ({ key: r.id, label: r.short }))} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ...(paper ? [{ key: 'key' as Tab, label: round.kind === 'guts' ? 'Key sets' : 'Key sheets' }] : []),
          ...(director ? [{ key: 'review' as Tab, label: 'Review answers', count: toRule || undefined }] : []),
          { key: 'progress', label: 'Progress' },
        ]}
      />
      <section className="card" style={{ padding: 22 }}>
        {tab === 'key' && (round.kind === 'guts' ? <KeyGuts key={round.id} round={round} /> : <KeySheet key={round.id} round={round} />)}
        {tab === 'review' && <Review key={round.id} round={round} />}
        {tab === 'progress' && <Progress round={round} />}
      </section>
    </>
  );
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
        return (
          <div key={p.id} className={`kcell ${v.trim() ? gradeAnswer(p, v, rulings) : ''}`}>
            <label htmlFor={`k-${p.id}`}>{label(p)}</label>
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

function KeySheet({ round }: { round: Round }) {
  const db = useDB();
  const me = useUser()!;
  const [id, setId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
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
  const save = () => {
    if (!match) return;
    savePaperSheet(round.id, match.id, values, me.id);
    toast(`Saved ${match.code}`, `${match.name}: ${score} of ${max}`, 'g');
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

  return (
    <div className="split">
      <div className="stack-lg" style={{ gap: 20 }}>
        <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 150 }}>
            <span>{round.kind === 'individual' ? 'Competitor ID' : 'Team number'}</span>
            <input ref={idRef} className="input mono" style={{ height: 46, fontSize: 18 }} autoFocus value={id} placeholder={round.kind === 'individual' ? '05A' : '05'} onChange={(e) => setId(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && match) { e.preventDefault(); cells.current[0]?.focus(); } }} />
          </label>
          <div className="grow" style={{ paddingBottom: 12 }}>
            {match ? <b>{match.name}</b> : id ? <span className="wait">No in-person {round.kind === 'individual' ? 'competitor' : 'team'} {id}</span> : <span className="muted">Type the ID on the sheet, then Enter.</span>}
          </div>
          {match && <div style={{ fontSize: 30, fontWeight: 700, paddingBottom: 4 }}><Roll value={score} /><span className="muted" style={{ fontSize: 16 }}> / {max}</span></div>}
        </div>
        <div style={{ opacity: match ? 1 : 0.4, pointerEvents: match ? 'auto' : 'none', transition: 'opacity .2s' }}>
          <Cells problems={round.problems} values={values} set={(pid, v) => setValues((x) => ({ ...x, [pid]: v }))} rulings={rulings} cells={cells} onKey={onKey} label={(p) => `${p.number}`} cols={5} />
        </div>
        <div className="row wrap">
          <button className="btn btn-primary" type="button" disabled={!match} onClick={save}>Save sheet</button>
          <span className="muted small">Enter moves on. Enter on the last box saves. Leave a box empty for a blank.</span>
        </div>
      </div>
      <aside>
        <div className="section-head"><h2 style={{ fontSize: 14 }}>Sheets keyed</h2><span className="label">{pool.length - queue.length} of {pool.length}</span></div>
        <div className="progress green" style={{ marginBottom: 14 }}><i style={{ width: `${((pool.length - queue.length) / Math.max(1, pool.length)) * 100}%`, transition: 'width .4s' }} /></div>
        {queue.length === 0 ? <p className="ok small">Every sheet is keyed.</p> : (
          <div className="row wrap" style={{ gap: 6 }}>
            <p className="muted small" style={{ width: '100%' }}>Still to key:</p>
            {queue.slice(0, 48).map((p) => <button key={p.id} type="button" className="btn btn-sm mono" onClick={() => { setId(p.code); setTimeout(() => cells.current[0]?.focus(), 20); }}>{p.code}</button>)}
          </div>
        )}
      </aside>
    </div>
  );
}

function KeyGuts({ round }: { round: Round }) {
  const db = useDB();
  const me = useUser()!;
  const [code, setCode] = useState('');
  const [setNo, setSetNo] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const codeRef = useRef<HTMLInputElement>(null);
  const rulings = useMemo(() => indexRulings(db.rulings), [db.rulings]);
  const contest = useContest();
  const teams = db.teams.filter((t) => modeOf(contest, t) === 'in_person' && t.status !== 'withdrawn');
  const team = teams.find((t) => t.code === code.trim().padStart(2, '0') && code.trim());
  const attempt = team && db.attempts.find((a) => a.roundId === round.id && a.entrantId === team.id);
  const problems = round.problems.filter((p) => p.set === setNo);
  const totalSets = Math.max(...round.problems.map((p) => p.set ?? 1));

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
    toast(`Set ${setNo} for ${team.code} ${team.name}`, `${pts} points, on the board now.`, 'g');
    setCode('');
    setValues({});
    codeRef.current?.focus();
  };
  const { cells, onKey } = useKeypad(4, 4, save);

  return (
    <div className="split">
      <div className="stack-lg" style={{ gap: 20 }}>
        <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 120 }}>
            <span>Team</span>
            <input ref={codeRef} className="input mono" style={{ height: 46, fontSize: 18 }} autoFocus value={code} placeholder="05" onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={(e) => { if (e.key === 'Enter' && team) { e.preventDefault(); cells.current[0]?.focus(); } }} />
          </label>
          <div className="field">
            <span>Set</span>
            <Segmented label="Set" value={String(setNo)} onChange={(s) => setSetNo(Number(s))} items={Array.from({ length: totalSets }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }))} />
          </div>
          <div className="grow" style={{ paddingBottom: 10 }}>
            {team ? <b>{team.name}</b> : code ? <span className="wait">No in-person team {code}</span> : <span className="muted">Type the team number on the set, then Enter.</span>}
          </div>
        </div>
        <div style={{ opacity: team ? 1 : 0.4, pointerEvents: team ? 'auto' : 'none', transition: 'opacity .2s' }}>
          <Cells problems={problems} values={values} set={(pid, v) => setValues((x) => ({ ...x, [pid]: v }))} rulings={rulings} cells={cells} onKey={onKey} label={(p) => `${p.set}.${((p.number - 1) % 4) + 1} · ${p.points} pts`} cols={4} />
        </div>
        <div className="row wrap">
          <button className="btn btn-primary" type="button" disabled={!team} onClick={save}>Save set {setNo}</button>
          <span className="muted small">A saved set goes straight onto the scoreboard.</span>
        </div>
      </div>
      <aside>
        <div className="section-head"><h2 style={{ fontSize: 14 }}>Sets keyed</h2></div>
        {teams.map((t) => {
          const a = db.attempts.find((x) => x.roundId === round.id && x.entrantId === t.id);
          const done = a?.setsSubmitted ?? 0;
          return (
            <button key={t.id} type="button" className="list-btn" onClick={() => { setCode(t.code); setTimeout(() => cells.current[0]?.focus(), 30); }}>
              <span className="row" style={{ gap: 10 }}><span className="mono muted">{t.code}</span><span className="ellipsis" style={{ maxWidth: 130 }}>{t.name}</span></span>
              <Track done={done} total={totalSets} current={done < totalSets ? done + 1 : null} />
            </button>
          );
        })}
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
  const firstOpen = round.problems.find((p) => groupsBy[p.id].some((g) => g.status === 'unreviewed'));
  const [pid, setPid] = useState((firstOpen ?? round.problems[0]).id);
  const problem = round.problems.find((p) => p.id === pid)!;
  const groups = groupsBy[pid];
  const ruled = new Map(db.rulings.filter((r) => r.problemId === pid).map((r) => [r.normalized, r.correct]));
  const name = (p: Problem) => (round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : `Problem ${p.number}`);

  return (
    <div className="split" style={{ gridTemplateColumns: '200px minmax(0, 1fr)' }}>
      <aside className="stack" style={{ gap: 2 }}>
        {round.problems.map((p) => {
          const open = groupsBy[p.id].filter((g) => g.status === 'unreviewed').length;
          return (
            <button key={p.id} type="button" className={`list-btn ${p.id === pid ? 'on' : ''}`} onClick={() => setPid(p.id)}>
              <span>{name(p)}</span>
              {open ? <span className="badge">{open}</span> : <span className="muted tiny">{groupsBy[p.id].length}</span>}
            </button>
          );
        })}
      </aside>
      <div className="stack-lg" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">{name(problem)} · key <b className="mono" style={{ color: 'var(--ink)' }}>{problem.answers.map(plainAnswer).join(' or ')}</b></span>
          <MathText text={problem.text} className="q-text" />
        </div>
        <div>
          <div className="section-head">
            <h2 style={{ fontSize: 14 }}>Every different answer given</h2>
            <button className="btn btn-sm" type="button" disabled={!groups.some((g) => g.status === 'unreviewed')} onClick={() => { groups.filter((g) => g.status === 'unreviewed').forEach((g) => setRuling(round.id, pid, g.normalized, false, me.id)); toast('Marked the rest wrong'); }}>Mark the rest wrong</button>
          </div>
          {groups.length === 0 && <p className="muted">No answers yet.</p>}
          {groups.map((g) => {
            const r = ruled.get(g.normalized);
            return (
              <div key={g.normalized} className={`answer-row ${g.status === 'unreviewed' ? 'open' : ''}`}>
                <div>{g.samples.map((s) => <code key={s}>{s}</code>)}</div>
                <span className="num soft">{g.count}×</span>
                {g.status === 'correct' && r === undefined ? (
                  <span className="ok small">Matches the key</span>
                ) : g.status === 'incorrect' && r === undefined ? (
                  <span className="muted small">Different value, wrong</span>
                ) : (
                  <div className="verdict" role="group" aria-label={`Ruling on ${g.samples[0]}`}>
                    <button type="button" className={r === true ? 'yes' : ''} onClick={() => setRuling(round.id, pid, g.normalized, r === true ? null : true, me.id)}>Correct</button>
                    <button type="button" className={r === false ? 'no' : ''} onClick={() => setRuling(round.id, pid, g.normalized, r === false ? null : false, me.id)}>Wrong</button>
                  </div>
                )}
              </div>
            );
          })}
          <p className="muted small" style={{ marginTop: 14 }}>A ruling applies to everyone who gave that answer, online and on paper.</p>
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
  return (
    <div className="table-scroll">
      <table className="t">
        <thead><tr><th>Grader</th><th className="num">{round.kind === 'guts' ? 'Sets keyed' : 'Sheets keyed'}</th><th className="num">Last</th></tr></thead>
        <tbody>
          {[...by.entries()].map(([id, v]) => (
            <tr key={id}><td className="name">{user.get(id)?.name ?? 'Grader'}</td><td className="num">{v.n}</td><td className="num muted">{v.last ? clock(v.last) : '–'}</td></tr>
          ))}
          {by.size === 0 && <tr className="empty"><td colSpan={3}>Nothing keyed for {round.name} yet.</td></tr>}
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
