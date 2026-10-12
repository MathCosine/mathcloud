import { useState } from 'react';
import { closeRound, openRound, saveRound } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { IntegrityPolicy, Problem, Round } from '../../lib/model';
import { useUser } from '../../lib/session';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { AnswerPreview, MathText, Modal, State, Tabs, toast, useNow } from '../../components/ui';

export function Rounds() {
  const contest = useContest();
  const [id, setId] = useState(contest.rounds[0].id);
  const round = contest.rounds.find((r) => r.id === id)!;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rounds</h1>
          <p className="page-sub">Both divisions sit each round at the same time: on paper in San Francisco, in the browser online.</p>
        </div>
      </div>
      <Tabs value={id} onChange={setId} items={contest.rounds.map((r) => ({ key: r.id, label: r.name }))} />
      <RoundEditor key={round.id} round={round} />
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
  const setProblem = (pid: string, patch: Partial<Problem>) => saveRound(round.id, { problems: round.problems.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });
  const director = me.role === 'director';
  const label = (p: Problem) => (round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : String(p.number));

  return (
    <div className="stack-lg">
      <div className="row wrap" style={{ gap: 24, justifyContent: 'space-between' }}>
        <div className="row wrap" style={{ gap: 24 }}>
          {state === 'open' && ends ? <State tone="go">Open · {duration(ends - now)} left</State> : state === 'closed' ? <State tone="ok">Finished</State> : <State tone="off">Starts {clockIn(round.startsAt, contest.timeZone)}, 23 January</State>}
          <span className="soft">{round.minutes} minutes · {round.problems.length} problems{round.kind === 'guts' ? ', 6 sets' : ''} · {round.kind === 'individual' ? 'individual' : 'team'}</span>
        </div>
        {director && (state === 'open' ? (
          <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>
        ) : (
          <button className="btn btn-primary" type="button" onClick={() => setConfirm('open')}>{state === 'closed' ? 'Reopen round' : 'Open round'}</button>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Length (minutes)</span>
          <input className="input" type="number" min={1} value={round.minutes} onChange={(e) => saveRound(round.id, { minutes: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Leaving the test</span>
          <select className="select" value={round.integrity.policy} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, policy: e.target.value as IntegrityPolicy } })}>
            <option value="log">Log it</option>
            <option value="warn">Log it and warn</option>
            <option value="lock">Lock after {round.integrity.lockAfter} times</option>
          </select>
        </label>
        <label className="field">
          <span>Grace period (seconds)</span>
          <input className="input" type="number" min={0} value={round.graceSeconds} onChange={(e) => saveRound(round.id, { graceSeconds: Number(e.target.value) })} />
        </label>
        <label className="check" style={{ alignSelf: 'end', height: 38 }}>
          <input type="checkbox" checked={!!round.mystery} onChange={(e) => saveRound(round.id, { mystery: e.target.checked })} />
          Keep the format secret until it starts
        </label>
      </div>

      <section className="section">
        <div className="section-head"><h2>Problems and key</h2><span className="label">Changes save as you type</span></div>
        {round.problems.map((p, i) => (
          <div key={p.id}>
            {round.kind === 'guts' && i % 4 === 0 && <div className="label" style={{ padding: '14px 0 4px' }}>Set {p.set} · {p.points} points each</div>}
            <div className="q" style={{ gridTemplateColumns: '44px minmax(0, 1fr) 220px' }}>
              <span className="q-num">{label(p)}</span>
              <div>
                {editing === p.id ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <textarea className="textarea mono" style={{ minHeight: 80, fontSize: 13 }} value={p.text} autoFocus onChange={(e) => setProblem(p.id, { text: e.target.value })} />
                    <div className="row">
                      <select className="select input-sm" style={{ width: 'auto' }} value={p.answerType} onChange={(e) => setProblem(p.id, { answerType: e.target.value as Problem['answerType'] })}>
                        <option value="integer">Integer answer</option>
                        <option value="expression">Expression answer</option>
                      </select>
                      <input className="input input-sm" style={{ width: 80 }} type="number" min={0} value={p.points} onChange={(e) => setProblem(p.id, { points: Number(e.target.value) })} aria-label="Points" />
                      <span className="muted small">points</span>
                      <span className="grow" />
                      <button className="btn btn-sm" type="button" onClick={() => setEditing(null)}>Done</button>
                    </div>
                  </div>
                ) : (
                  <div className="q-text" style={{ fontSize: 15.5 }}>
                    <MathText text={p.text} />{' '}
                    <button type="button" className="linkbtn small" style={{ fontWeight: 500 }} onClick={() => setEditing(p.id)}>Edit</button>
                  </div>
                )}
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <input className="input mono" aria-label={`Answer to ${label(p)}`} value={p.answers.join(' | ')} placeholder="Answer" onChange={(e) => setProblem(p.id, { answers: e.target.value.split('|').map((s) => s.trim()) })} style={{ borderColor: p.answers.join('').trim() ? undefined : 'var(--amber)' }} />
                <span className="soft" style={{ minHeight: 20 }}><AnswerPreview value={p.answers[0] ?? ''} /></span>
              </div>
            </div>
          </div>
        ))}
        <p className="muted small" style={{ marginTop: 12 }}>To accept more than one form, separate answers with a vertical bar: 3/8 | 0.375</p>
      </section>

      <section className="section">
        <div className="section-head"><h2>Rules shown before the start</h2></div>
        <textarea className="textarea" value={round.rules} onChange={(e) => saveRound(round.id, { rules: e.target.value })} />
      </section>

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
        </Modal>
      )}
    </div>
  );
}
