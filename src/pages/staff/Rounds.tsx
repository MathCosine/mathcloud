import { useState } from 'react';
import { closeRound, openRound, saveRound } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { IntegrityPolicy, Problem, Round } from '../../lib/model';
import { useDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { MathText, Modal, Status, Tabs, toast, useNow } from '../../components/ui';

export function Rounds() {
  const contest = useContest();
  const [roundId, setRoundId] = useState(contest.rounds[0].id);
  const round = contest.rounds.find((r) => r.id === roundId)!;
  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Rounds</span></div>
      <div className="page-head">
        <div>
          <h1>Rounds</h1>
          <div className="meta">Every division sits each round at the same moment: on paper in San Francisco, in the browser online.</div>
        </div>
      </div>
      <Tabs value={roundId} onChange={setRoundId} items={contest.rounds.map((r) => ({ key: r.id, label: r.name, count: r.problems.length }))} />
      <RoundEditor key={round.id} round={round} />
    </>
  );
}

function RoundEditor({ round }: { round: Round }) {
  const db = useDB();
  const contest = useContest();
  const now = useNow(1000);
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const attempts = db.attempts.filter((a) => a.roundId === round.id);

  const setProblem = (id: string, patch: Partial<Problem>) => saveRound(round.id, { problems: round.problems.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  return (
    <div className="grid-main-side">
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <h3>Problems and answer key</h3>
            <span className="sub" style={{ fontSize: 12.5 }}>Saved as you type. Accept several answers by separating them with “ | ”.</span>
          </div>
          {round.problems.map((p) => (
            <div key={p.id} className="round-card" style={{ gridTemplateColumns: '36px minmax(0, 1fr) 200px', alignItems: 'start' }}>
              <span className="pnum">{round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : p.number}</span>
              <div className="stack" style={{ gap: 6 }}>
                <MathText text={p.text} className="ptext" />
                <details>
                  <summary className="sub" style={{ fontSize: 12.5, cursor: 'pointer' }}>Edit text</summary>
                  <textarea className="textarea mono" style={{ minHeight: 70, marginTop: 6 }} value={p.text} onChange={(e) => setProblem(p.id, { text: e.target.value })} />
                </details>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <label className="field">
                  <span>Answer</span>
                  <input className={`input mono ${p.answers.join('').trim() ? '' : 'bad'}`} value={p.answers.join(' | ')} onChange={(e) => setProblem(p.id, { answers: e.target.value.split('|').map((s) => s.trim()) })} />
                </label>
                <div className="row" style={{ gap: 6 }}>
                  <select className="select input-sm" value={p.answerType} onChange={(e) => setProblem(p.id, { answerType: e.target.value as Problem['answerType'] })} style={{ height: 28 }}>
                    <option value="integer">Integer</option>
                    <option value="expression">Expression</option>
                  </select>
                  <input className="input input-sm mono" type="number" min={0} value={p.points} onChange={(e) => setProblem(p.id, { points: Number(e.target.value) })} style={{ width: 64 }} aria-label="Points" />
                  <span className="sub" style={{ fontSize: 12 }}>pts</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{round.name}</h3>
            {state === 'open' ? <Status tone="blue">Open</Status> : state === 'closed' ? <Status tone="green">Finished</Status> : <Status tone="grey">Scheduled</Status>}
          </div>
          {state === 'open' && ends && <div className="score-big mono" style={{ fontSize: 30, marginTop: 10 }}>{duration(ends - now)}</div>}
          <p className="sub" style={{ fontSize: 12.5, marginTop: 6 }}>
            Scheduled {clockIn(round.startsAt, contest.timeZone)} on 23 Jan · {attempts.filter((a) => a.source === 'online').length} online · {attempts.filter((a) => a.source === 'paper').length} paper
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            {state === 'open' ? (
              <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close now</button>
            ) : (
              <button className="btn btn-primary" type="button" onClick={() => setConfirm('open')}>{state === 'closed' ? 'Reopen now' : 'Open now'}</button>
            )}
          </div>
          <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>In the demo, opening a round starts its clock now so you can try it as a student.</p>
        </div>

        <div className="panel panel-pad stack">
          <h3>Settings</h3>
          <label className="field">
            <span>Length</span>
            <div className="row"><input className="input mono" type="number" min={1} value={round.minutes} onChange={(e) => saveRound(round.id, { minutes: Number(e.target.value) })} style={{ width: 90 }} /><span className="sub">minutes</span></div>
          </label>
          <label className="field">
            <span>Grace period</span>
            <div className="row"><input className="input mono" type="number" min={0} value={round.graceSeconds} onChange={(e) => saveRound(round.id, { graceSeconds: Number(e.target.value) })} style={{ width: 90 }} /><span className="sub">seconds after time for answers already typed to save</span></div>
          </label>
          <label className="field">
            <span>Leaving the test tab</span>
            <select className="select" value={round.integrity.policy} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, policy: e.target.value as IntegrityPolicy } })}>
              <option value="log">Log it for the proctor</option>
              <option value="warn">Log it and warn the student</option>
              <option value="lock">Lock the test after repeated exits</option>
            </select>
          </label>
          {round.integrity.policy === 'lock' && (
            <label className="field">
              <span>Lock after</span>
              <div className="row"><input className="input mono" type="number" min={1} value={round.integrity.lockAfter} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, lockAfter: Number(e.target.value) } })} style={{ width: 90 }} /><span className="sub">exits</span></div>
            </label>
          )}
          <label className="check"><input type="checkbox" checked={!!round.mystery} onChange={(e) => saveRound(round.id, { mystery: e.target.checked })} />Keep the format secret until it starts</label>
          <label className="field">
            <span>Rules shown before the start</span>
            <textarea className="textarea" value={round.rules} onChange={(e) => saveRound(round.id, { rules: e.target.value })} />
          </label>
        </div>
      </div>

      {confirm && (
        <Modal
          title={confirm === 'open' ? `Open ${round.name} now?` : `Close ${round.name} now?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' ? 'btn-primary' : 'btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') { openRound(round.id); toast(`${round.name} is open`, `${round.minutes} minutes from now. Online students can start.`, 'g'); }
                else { closeRound(round.id); toast(`${round.name} is closed`, 'Every online test still open was handed in.'); }
                setConfirm(null);
              }}>{confirm === 'open' ? 'Open round' : 'Close and hand in every test'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `Every online competitor can start immediately, and the ${round.minutes}-minute clock starts for everyone at once.${roundState(round) === 'closed' ? ' Reopening clears the online answers from the last run.' : ''}` : 'Every online test still in progress is handed in as it stands. Students see “Time’s up”.'}</p>
        </Modal>
      )}
    </div>
  );
}
