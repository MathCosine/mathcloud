import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from 'react';
import { savePaperSheet, setRuling } from '../../lib/actions';
import { useContest, useLookups, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { gradeAnswer, indexRulings, normalize } from '../../lib/scoring/answers';
import { distinctAnswers } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock } from '../../lib/time';
import { AnswerPreview, MathText, Roll, Segmented, Tabs, Tick, toast } from '../../components/ui';

type Tab = 'key' | 'review' | 'progress';

export function Grading() {
  const contest = useContest();
  const me = useUser()!;
  const standings = useStandings();
  const isDirector = me.role === 'director' || me.role === 'staff';
  const [tab, setTab] = useState<Tab>('key');
  const rounds = contest.rounds.filter((r) => isDirector || me.roundIds?.includes(r.id));
  const [roundId, setRoundId] = useState(rounds[0].id);
  const round = contest.rounds.find((r) => r.id === roundId)!;
  const unreviewed = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Grading</span></div>
      <div className="page-head">
        <div>
          <h1>Grading</h1>
          <div className="meta">{isDirector ? 'Paper sheets are keyed in by graders; online answers grade themselves. Odd forms come to you once each.' : `Signed in as ${me.name}. You can key ${rounds.map((r) => r.name).join(', ')}.`}</div>
        </div>
        <Segmented label="Round" value={roundId} onChange={setRoundId} items={rounds.map((r) => ({ key: r.id, label: r.short }))} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'key', label: 'Key paper sheets' },
          ...(isDirector ? [{ key: 'review' as Tab, label: 'Review answers', count: unreviewed }] : []),
          { key: 'progress', label: 'Progress' },
        ]}
      />
      {tab === 'key' && <KeySheets key={round.id} round={round} />}
      {tab === 'review' && <Review key={round.id} round={round} />}
      {tab === 'progress' && <Progress round={round} />}
    </>
  );
}

// ------------------------------------------------------------ key sheets

function KeySheets({ round }: { round: Round }) {
  const db = useDB();
  const me = useUser()!;
  const { user } = useLookups();
  const [entrant, setEntrant] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const idRef = useRef<HTMLInputElement>(null);
  const rulings = useMemo(() => indexRulings(db.rulings), [db.rulings]);

  const inPersonTeams = db.teams.filter((t) => t.divisionId === 'in_person' && t.status !== 'withdrawn');
  const pool = round.kind === 'individual'
    ? db.competitors.filter((c) => inPersonTeams.some((t) => t.id === c.teamId)).map((c) => ({ id: c.id, code: c.publicId, name: c.name }))
    : inPersonTeams.map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const match = pool.find((p) => p.code.toLowerCase() === entrant.trim().toLowerCase());
  const existing = match && db.attempts.find((a) => a.roundId === round.id && a.entrantId === match.id);
  const keyed = new Set(db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper').map((a) => a.entrantId));
  const queue = pool.filter((p) => !keyed.has(p.id));

  useEffect(() => {
    if (!match) return setValues({});
    const a = db.attempts.find((x) => x.roundId === round.id && x.entrantId === match.id);
    setValues(Object.fromEntries(round.problems.map((p) => [p.id, a?.responses[p.id]?.value ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, round.id]);

  const score = round.problems.reduce((n, p) => n + (gradeAnswer(p, values[p.id], rulings) === 'correct' ? p.points : 0), 0);
  const max = round.problems.reduce((n, p) => n + p.points, 0);

  const save = () => {
    if (!match) return;
    savePaperSheet(round.id, match.id, values, me.id);
    toast(`Saved ${match.code}`, `${match.name}: ${score} of ${max}. Next sheet.`, 'g');
    setEntrant('');
    setValues({});
    idRef.current?.focus();
  };

  const onCellKey = (i: number) => (e: RKE<HTMLInputElement>) => {
    const move = (to: number) => {
      e.preventDefault();
      cells.current[Math.max(0, Math.min(round.problems.length - 1, to))]?.focus();
    };
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey || i === round.problems.length - 1) { e.preventDefault(); save(); }
      else move(i + 1);
    } else if (e.key === 'ArrowRight' && (e.currentTarget.selectionStart ?? 0) >= e.currentTarget.value.length) move(i + 1);
    else if (e.key === 'ArrowLeft' && (e.currentTarget.selectionStart ?? 0) === 0) move(i - 1);
    else if (e.key === 'ArrowDown') move(i + (round.kind === 'guts' ? 4 : 5));
    else if (e.key === 'ArrowUp') move(i - (round.kind === 'guts' ? 4 : 5));
    else if (e.key === 'Backspace' && !e.currentTarget.value) move(i - 1);
  };

  const onPaste = (i: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const parts = e.clipboardData.getData('text').trim().split(/[\s,;]+/);
    if (parts.length < 2) return;
    e.preventDefault();
    setValues((v) => {
      const n = { ...v };
      parts.forEach((p, k) => { const prob = round.problems[i + k]; if (prob) n[prob.id] = p; });
      return n;
    });
  };

  return (
    <div className="grid-main-side">
      <div className="panel panel-pad stack">
        <div className="sheet-head">
          <label className="field" style={{ width: 160 }}>
            <span>{round.kind === 'individual' ? 'Competitor ID' : 'Team number'}</span>
            <input
              ref={idRef}
              className="input mono"
              style={{ fontSize: 16, height: 40 }}
              autoFocus
              value={entrant}
              placeholder={round.kind === 'individual' ? '05A' : '05'}
              onChange={(e) => setEntrant(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter' && match) { e.preventDefault(); cells.current[0]?.focus(); } }}
            />
          </label>
          <div style={{ paddingBottom: 9 }}>
            {match ? (
              <span><b>{match.name}</b>{existing && <span className="sub"> · keyed by {user.get(Object.values(existing.responses)[0]?.by ?? '')?.name ?? 'a grader'} at {existing.submittedAt ? clock(existing.submittedAt) : '—'}; saving replaces it</span>}</span>
            ) : entrant ? (
              <span className="warn-text">No in-person {round.kind === 'individual' ? 'competitor' : 'team'} with that ID. Check the sheet.</span>
            ) : (
              <span className="sub">Type the ID written on the sheet, then Enter.</span>
            )}
          </div>
          <span className="spacer" />
          {match && <div className="score-big mono" style={{ fontSize: 28 }}><Roll value={score} /><span className="sub" style={{ fontSize: 15 }}> / {max}</span></div>}
        </div>

        <div className="keypad" style={{ ['--cols' as string]: round.kind === 'guts' ? 4 : 5, opacity: match ? 1 : 0.45, pointerEvents: match ? 'auto' : 'none' }}>
          {round.problems.map((p, i) => {
            const v = values[p.id] ?? '';
            const status = v.trim() ? gradeAnswer(p, v, rulings) : '';
            return (
              <div key={p.id} style={{ display: 'contents' }}>
                {round.kind === 'guts' && i % 4 === 0 && <div className="set-label">Set {p.set} · {p.points} points each</div>}
                <div className={`kcell ${status}`}>
                  <label htmlFor={`k-${p.id}`}>{round.kind === 'guts' ? `${p.set}.${(i % 4) + 1}` : `P${p.number}`}</label>
                  <input
                    id={`k-${p.id}`}
                    ref={(el) => { cells.current[i] = el; }}
                    value={v}
                    inputMode={p.answerType === 'integer' ? 'numeric' : 'text'}
                    autoComplete="off"
                    onChange={(e) => setValues((x) => ({ ...x, [p.id]: e.target.value }))}
                    onKeyDown={onCellKey(i)}
                    onPaste={onPaste(i)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="row-wrap">
          <button className="btn btn-primary" type="button" disabled={!match} onClick={save}>Save sheet</button>
          <span className="sub" style={{ fontSize: 12.5 }}>Enter moves on · arrows move around · paste a row of answers to fill across · Enter on the last box saves. Leave a box empty for a blank.</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Not keyed yet</h3><span className="sub mono" style={{ fontSize: 12.5 }}>{pool.length - queue.length} / {pool.length}</span></div>
        <div className="panel-body">
          <div className="bar blue" style={{ marginTop: 0, marginBottom: 12 }}><i style={{ width: `${((pool.length - queue.length) / Math.max(1, pool.length)) * 100}%` }} /></div>
          {queue.length === 0 && <p className="ok-text row"><Tick /> Every in-person sheet for {round.name} is keyed.</p>}
          <div className="row-wrap" style={{ gap: 6 }}>
            {queue.slice(0, 40).map((p) => (
              <button key={p.id} className="btn btn-sm mono" type="button" onClick={() => { setEntrant(p.code); setTimeout(() => cells.current[0]?.focus(), 30); }}>{p.code}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review

function Review({ round }: { round: Round }) {
  const db = useDB();
  const me = useUser()!;
  const attempts = db.attempts.filter((a) => a.roundId === round.id && (a.source === 'paper' || a.startedAt));
  const groupsBy = useMemo(
    () => Object.fromEntries(round.problems.map((p) => [p.id, distinctAnswers(p, attempts, db.rulings, (raw) => normalize(raw, p.answerType))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.attempts, db.rulings, round],
  );
  const first = round.problems.find((p) => groupsBy[p.id].some((g) => g.status === 'unreviewed')) ?? round.problems[0];
  const [pid, setPid] = useState(first.id);
  const problem = round.problems.find((p) => p.id === pid)!;
  const groups = groupsBy[pid];
  const ruled = new Map(db.rulings.filter((r) => r.problemId === pid).map((r) => [r.normalized, r.correct]));

  return (
    <div className="grid-main-side" style={{ gridTemplateColumns: '220px minmax(0, 1fr)' }}>
      <div className="panel" style={{ alignSelf: 'start' }}>
        <div className="panel-head"><h3>Problems</h3></div>
        <div style={{ padding: 6 }}>
          {round.problems.map((p) => {
            const open = groupsBy[p.id].filter((g) => g.status === 'unreviewed').length;
            return (
              <button key={p.id} type="button" className={`pop-item ${p.id === pid ? 'on' : ''}`} onClick={() => setPid(p.id)}>
                <span className="mono">{round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : `P${p.number}`}</span>
                {open ? <span className="tag amber">{open} to rule</span> : <small>{groupsBy[p.id].length} answers</small>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="stack">
        <div className="panel panel-pad">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
            <MathText text={problem.text} className="ptext" />
            <span className="tag green" style={{ flex: 'none', fontSize: 13 }}>key {problem.answers.map((a) => <span key={a} style={{ marginLeft: 4 }}>{/^-?\d+$/.test(a) ? <span className="mono">{a}</span> : <AnswerPreview value={a} />}</span>)}</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Every distinct answer</h3>
            <button className="btn btn-sm" type="button" disabled={!groups.some((g) => g.status === 'unreviewed')} onClick={() => {
              groups.filter((g) => g.status === 'unreviewed').forEach((g) => setRuling(round.id, pid, g.normalized, false, me.id));
              toast('Marked the rest wrong');
            }}>Mark the rest wrong</button>
          </div>
          {groups.length === 0 && <p className="panel-body sub">No answers yet.</p>}
          {groups.map((g) => {
            const r = ruled.get(g.normalized);
            const fromKey = g.status === 'correct' && r === undefined;
            return (
              <div className="ans-row" key={g.normalized} style={{ background: g.status === 'unreviewed' ? 'var(--amber-wash)' : undefined }}>
                <div className="forms">
                  {g.samples.map((s) => <code key={s}>{s}</code>)}
                  {g.status === 'unreviewed' && <span className="tag amber">needs a ruling</span>}
                </div>
                <span className="mono" title="How many gave this answer"><b>{g.count}</b> <span className="sub">×</span></span>
                {fromKey ? (
                  <span className="ok-text row" style={{ fontSize: 12.5 }}><Tick /> matches the key</span>
                ) : g.status === 'incorrect' && r === undefined ? (
                  <span className="sub" style={{ fontSize: 12.5 }}>a different number: wrong</span>
                ) : (
                  <div className="verdict" role="group" aria-label="Ruling">
                    <button type="button" className={r === true ? 'on-ok' : ''} onClick={() => setRuling(round.id, pid, g.normalized, r === true ? null : true, me.id)}>Correct</button>
                    <button type="button" className={r === false ? 'on-no' : ''} onClick={() => setRuling(round.id, pid, g.normalized, r === false ? null : false, me.id)}>Wrong</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="sub" style={{ fontSize: 12.5 }}>A ruling applies to everyone who gave that answer, online and on paper, and every score updates at once.</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- progress

function Progress({ round }: { round: Round }) {
  const db = useDB();
  const { user } = useLookups();
  const paper = db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper');
  const byGrader = new Map<string, number>();
  for (const a of paper) {
    const by = Object.values(a.responses)[0]?.by ?? 'u-grader';
    byGrader.set(by, (byGrader.get(by) ?? 0) + 1);
  }
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Grader</th><th className="num">Sheets keyed</th><th>Last sheet</th></tr></thead>
        <tbody>
          {[...byGrader.entries()].map(([id, n]) => {
            const last = paper.filter((a) => (Object.values(a.responses)[0]?.by ?? 'u-grader') === id).reduce((m, a) => ((a.submittedAt ?? '') > m ? a.submittedAt! : m), '');
            return (
              <tr key={id}><td className="tname">{user.get(id)?.name ?? id}</td><td className="num mono">{n}</td><td className="mono sub">{last ? clock(last) : '—'}</td></tr>
            );
          })}
          {byGrader.size === 0 && <tr className="empty-row"><td colSpan={3}>No paper sheets keyed for {round.name} yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
