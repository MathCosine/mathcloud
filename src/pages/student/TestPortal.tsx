import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { askClarification, logEvent, saveResponse, startAttempt, submitAttempt, submitGutsSet } from '../../lib/actions';
import { ordinal, useBoard, useContest } from '../../lib/hooks';
import type { Clarification, IntegrityKind, Problem, Round } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, clockSec, duration, roundEnds, roundState } from '../../lib/time';
import { ScoreList } from '../../components/Scoreboard';
import { AnswerPreview, MathText, Modal, toast, useNow } from '../../components/ui';

export function TestPortal() {
  const { roundId } = useParams();
  const me = useStudent();
  const contest = useContest();
  const db = useDB();
  const round = contest.rounds.find((r) => r.id === roundId);
  if (!me || !round) return <Navigate to="/me" replace />;
  if (contest.divisions.find((d) => d.id === me.team.divisionId)?.mode !== 'online') return <Navigate to="/me" replace />;
  const entrantId = round.kind === 'individual' ? me.competitor.id : me.team.id;
  const attempt = db.attempts.find((a) => a.roundId === round.id && a.entrantId === entrantId);
  if (!attempt?.startedAt) return <Intro round={round} entrantId={entrantId} name={me.competitor.name} />;
  return <Running key={attempt.id} round={round} attemptId={attempt.id} />;
}

// ------------------------------------------------------------------ intro

function Intro({ round, entrantId, name }: { round: Round; entrantId: string; name: string }) {
  const contest = useContest();
  const now = useNow(1000);
  const [honor, setHonor] = useState('');
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const ok = honor.trim().toLowerCase().replace(/\s+/g, ' ') === name.toLowerCase();
  const begin = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* Some browsers and phones refuse fullscreen. The test still runs and still notices leaving the tab. */
    }
    const error = await startAttempt(round.id, entrantId, honor.trim());
    if (error) toast('Could not start', error, 'r');
  };
  return (
    <div className="exam">
      <div className="exam-bar">
        <div className="l"><b>{round.name}</b><span>{contest.short}</span></div>
        <div className={`clock ${state === 'open' ? '' : 'muted'}`}>{state === 'open' && ends ? duration(ends - now) : '--:--'}</div>
        <div className="r"><Link className="btn btn-sm" to="/me">Back</Link></div>
      </div>
      <div style={{ maxWidth: 600, margin: '56px auto', padding: '0 20px' }} className="stack-lg">
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">{round.kind === 'individual' ? 'On your own' : round.kind === 'guts' ? 'With your team, one set at a time' : 'With your team, one shared sheet'} · {round.minutes} minutes · {round.problems.length} problems</span>
          <h1 className="page-title" style={{ fontSize: 32 }}>{round.name}</h1>
          <p className="lede">{round.rules}</p>
        </div>
        <ul className="soft" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Stay in your Zoom room with your camera on.</li>
          <li>The test goes fullscreen. Leaving it is recorded for your proctor{round.integrity.policy === 'warn' ? ', and you will see a warning' : round.integrity.policy === 'lock' ? `, and the test locks after ${round.integrity.lockAfter} times` : ''}.</li>
          <li>Answers save as you type.</li>
          {round.kind === 'guts' && <li>A live scoreboard sits beside the problems. It freezes {contest.board.freezeMinutes} minutes before the end.</li>}
        </ul>
        <div className="stack">
          <label className="field">
            <span>Type your full name to promise the work is {round.kind === 'individual' ? 'your own' : 'your team’s own'}</span>
            <input className="input" style={{ height: 44 }} value={honor} onChange={(e) => setHonor(e.target.value)} placeholder={name} onKeyDown={(e) => e.key === 'Enter' && ok && state === 'open' && begin()} />
          </label>
          <div className="row wrap">
            <button className="btn btn-primary btn-lg" type="button" disabled={!ok || state !== 'open'} onClick={begin}>Start</button>
            {state !== 'open' && <span className="muted">This round is not open.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- running

function Running({ round, attemptId }: { round: Round; attemptId: string }) {
  const db = useDB();
  const me = useStudent()!;
  const contest = useContest();
  const attempt = db.attempts.find((a) => a.id === attemptId)!;
  const now = useNow(500);
  const deadline = new Date(attempt.deadline!).getTime();
  const total = round.minutes * 60000;
  const left = deadline - now;
  const over = left <= -round.graceSeconds * 1000;
  const done = !!attempt.submittedAt || over;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notFull, setNotFull] = useState(false);
  const [panel, setPanel] = useState<'board' | 'questions'>(round.kind === 'guts' ? 'board' : 'questions');
  const [seen, setSeen] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const board = useBoard(me.team.divisionId, now);

  useEffect(() => {
    if (over && !attempt.submittedAt) submitAttempt(attempt.id);
  }, [over, attempt.submittedAt, attempt.id]);
  useEffect(() => {
    if (done && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [done]);

  const record = useCallback(
    (kind: IntegrityKind, ms?: number) => {
      if (done) return;
      const outcome = logEvent(attempt.id, { kind, ms });
      if (outcome === 'warn') setWarn(kind === 'paste' ? 'Pasting into the test was recorded.' : `You left the test${ms ? ` for ${duration(ms)}` : ''}. Your proctor can see this.`);
    },
    [attempt.id, done],
  );
  useIntegrity(record, !done && !attempt.locked, setNotFull, `${attempt.id}:${me.user.id}`);

  const save = (p: Problem, value: string) => {
    clearTimeout(timers.current[p.id]);
    setSaving(true);
    timers.current[p.id] = setTimeout(() => {
      const r = saveResponse(attempt.id, p.id, value, me.user.id);
      setSaving(false);
      if (!r.ok) return toast('Not saved', r.reason, 'r');
      setSavedAt(new Date().toISOString());
      setPulse((n) => n + 1);
      setDrafts((d) => {
        const n = { ...d };
        if (n[p.id] === value) delete n[p.id];
        return n;
      });
    }, 400);
  };

  const totalSets = Math.max(...round.problems.map((p) => p.set ?? 1));
  const currentSet = (attempt.setsSubmitted ?? 0) + 1;
  const shown = round.kind === 'guts' ? round.problems.filter((p) => p.set === currentSet) : round.problems;
  const valueOf = (p: Problem) => (p.id in drafts ? drafts[p.id] : attempt.responses[p.id]?.value ?? '');
  const answered = round.problems.filter((p) => valueOf(p).trim()).length;
  const blanks = shown.filter((p) => !valueOf(p).trim()).length;
  const nameOf = (uid: string) => db.users.find((u) => u.id === uid)?.name ?? db.competitors.find((c) => `u-${c.id}` === uid)?.name ?? 'a teammate';
  const low = left < 5 * 60000;
  const clars = db.clarifications
    .filter((c) => c.roundId === round.id && (c.broadcast || c.fromCompetitorId === me.competitor.id))
    .sort((a, b) => (b.answeredAt ?? b.at).localeCompare(a.answeredAt ?? a.at));
  const fresh = clars.find((c) => c.broadcast && c.answer && new Date(c.answeredAt ?? c.at).getTime() > new Date(attempt.startedAt!).getTime());
  const myRow = board?.rows.find((r) => r.team.id === me.team.id);

  if (done) {
    return (
      <div className="exam">
        <div className="exam-bar"><div className="l"><b>{round.name}</b><span>{contest.short}</span></div><div /><div className="r" /></div>
        <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 20px' }} className="stack-lg">
          <div className="stack" style={{ gap: 8 }}>
            <h1 className="page-title" style={{ fontSize: 32 }}>{over && !attempt.submittedAt ? 'Time’s up' : 'Handed in'}</h1>
            <p className="lede">{answered} of {round.problems.length} answered{attempt.submittedAt ? `, handed in at ${clock(attempt.submittedAt)}` : ''}. Results come out when the director publishes them.</p>
          </div>
          {round.kind === 'guts' && board && (
            <div>
              <div className="section-head"><h2 style={{ fontSize: 15 }}>Scoreboard</h2><span className="label">{board.frozen ? 'Frozen' : 'Live'}</span></div>
              <ScoreList board={board} mine={me.team.id} limit={8} />
            </div>
          )}
          <div><Link className="btn btn-primary" to="/me">Back to your rounds</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="exam">
      <div className="exam-bar">
        <div className="l">
          <b>{round.name}{round.kind === 'guts' ? `, set ${currentSet} of ${totalSets}` : ''}</b>
          <span>{me.competitor.publicId} {me.competitor.name}{round.kind !== 'individual' ? ` · ${me.team.name}` : ''}</span>
        </div>
        <div className={`clock ${low ? 'low' : ''} ${left <= 0 ? 'out' : ''}`} role="timer">{duration(Math.max(0, left))}</div>
        <div className="r">
          <span key={pulse} className={`saved ${saving ? 'busy' : pulse ? 'pulse' : ''}`}><i />{saving ? 'Saving' : savedAt ? `Saved ${clockSec(savedAt)}` : 'Saves as you type'}</span>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setConfirm(true)}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
        </div>
        <div className={`track-time ${low ? 'low' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></div>
      </div>

      {fresh && seen !== fresh.id && (
        <div className="note blue row wrap" style={{ borderRadius: 0, justifyContent: 'center', gap: 16 }}>
          <span><b>From the proctors:</b> {fresh.question ? `${fresh.question} ` : ''}{fresh.answer}</span>
          <button className="btn btn-sm" type="button" onClick={() => setSeen(fresh.id)}>OK</button>
        </div>
      )}
      {notFull && (
        <div className="note amber row wrap" style={{ borderRadius: 0, justifyContent: 'center', gap: 16 }}>
          <span>You left fullscreen.</span>
          <button className="btn btn-sm" type="button" onClick={() => document.documentElement.requestFullscreen?.().then(() => setNotFull(false)).catch(() => setNotFull(false))}>Go back to fullscreen</button>
        </div>
      )}

      <div className="exam-body">
        <div>
          {round.kind === 'guts' && (
            <>
              <div className="sets" aria-label={`Set ${currentSet} of ${totalSets}`}>
                {Array.from({ length: totalSets }, (_, i) => <span key={i} className={i + 1 < currentSet ? 'done' : i + 1 === currentSet ? 'now' : ''} />)}
              </div>
              <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 6, rowGap: 2 }}>
                <span className="label">Set {currentSet} · {shown[0]?.points} points each · you cannot come back to it</span>
                {myRow && <span className="label">Your team: {myRow.score} points{myRow.place ? `, ${ordinal(myRow.place)}` : ''}</span>}
              </div>
            </>
          )}
          <div key={currentSet}>
            {shown.map((p, i) => {
              const v = valueOf(p);
              const by = attempt.responses[p.id]?.by;
              return (
                <div key={p.id} className={`q ${v.trim() ? 'answered' : ''}`} style={{ animation: `rise .28s var(--ease) ${i * 40}ms both` }}>
                  <span className="q-num">{round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : p.number}</span>
                  <div>
                    <MathText text={p.text} className="q-text" />
                  </div>
                  <div className="q-answer">
                    <input
                      aria-label={`Answer to problem ${p.number}`}
                      value={v}
                      placeholder="Answer"
                      inputMode={p.answerType === 'integer' ? 'numeric' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={attempt.locked}
                      onFocus={() => setFocused(p.id)}
                      onBlur={() => setFocused((f) => (f === p.id ? null : f))}
                      onChange={(e) => { setDrafts((d) => ({ ...d, [p.id]: e.target.value })); save(p, e.target.value); }}
                    />
                    <span className="preview"><AnswerPreview value={v} /></span>
                    {round.kind !== 'individual' && by && by !== me.user.id && focused !== p.id && <span className="by">Typed by {nameOf(by)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row wrap" style={{ justifyContent: 'space-between', paddingTop: 22, borderTop: '1px solid var(--line)' }}>
            <span className="muted small">{answered} of {round.problems.length} answered</span>
            <button className="btn btn-primary" type="button" onClick={() => setConfirm(true)}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
          </div>
        </div>

        <aside className="aside-sticky">
          {round.kind === 'guts' && (
            <div className="panel-tabs" role="group" aria-label="Side panel">
              <button type="button" aria-pressed={panel === 'board'} onClick={() => setPanel('board')}>Scoreboard</button>
              <button type="button" aria-pressed={panel === 'questions'} onClick={() => setPanel('questions')}>Questions{clars.length ? ` (${clars.length})` : ''}</button>
            </div>
          )}
          {panel === 'board' && board ? (
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label">{contest.divisions.find((d) => d.id === me.team.divisionId)?.name} division</span>
                <span className="label">{board.frozen ? 'Frozen' : 'Live'}</span>
              </div>
              <ScoreList board={board} mine={me.team.id} limit={10} />
              {board.frozen && <p className="muted tiny" style={{ marginTop: 8 }}>Frozen for the last {contest.board.freezeMinutes} minutes. Final standings at the awards.</p>}
            </div>
          ) : (
            <Questions roundId={round.id} competitorId={me.competitor.id} items={clars} />
          )}
        </aside>
      </div>

      {warn && (
        <Modal title="That was recorded" onClose={() => setWarn(null)} actions={<button className="btn btn-primary" type="button" onClick={() => setWarn(null)}>Back to the test</button>}>
          <p>{warn} Stay in this window until you hand in.</p>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={round.kind === 'guts' ? `Hand in set ${currentSet}?` : `Hand in ${round.name}?`}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Keep working</button>
              <button className="btn btn-primary" type="button" onClick={() => {
                Object.values(timers.current).forEach(clearTimeout);
                for (const p of shown) if (p.id in drafts) saveResponse(attempt.id, p.id, drafts[p.id], me.user.id);
                if (round.kind === 'guts') submitGutsSet(attempt.id);
                else submitAttempt(attempt.id);
                setDrafts({});
                setConfirm(false);
                if (round.kind === 'guts' && currentSet < totalSets) toast(`Set ${currentSet} handed in`, 'It is on the scoreboard now.', 'g');
              }}>{round.kind === 'guts' && currentSet < totalSets ? 'Hand in, next set' : 'Hand in'}</button>
            </>
          }
        >
          <p>
            {round.kind === 'guts'
              ? `You cannot come back to set ${currentSet}.${blanks ? ` ${blanks} of its answers ${blanks === 1 ? 'is' : 'are'} blank.` : ''}`
              : `${round.problems.length - answered ? `${round.problems.length - answered} answers are blank. ` : ''}You cannot change anything afterwards.`}
          </p>
        </Modal>
      )}
      {attempt.locked && (
        <div className="lock" role="alertdialog" aria-label="Test locked">
          <div className="stack">
            <h2>Your test is locked</h2>
            <p className="soft">You left the test too many times. Tell your proctor on Zoom; they can unlock it. Your answers are safe and the clock keeps running.</p>
            <p className="clock" style={{ marginTop: 8 }}>{duration(Math.max(0, left))}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Questions({ roundId, competitorId, items }: { roundId: string; competitorId: string; items: Clarification[] }) {
  const [q, setQ] = useState('');
  const seen = useRef(new Set(items.map((c) => c.id)));
  useEffect(() => {
    items.forEach((c) => seen.current.add(c.id));
  });
  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Questions</h2>
      {items.length === 0 && <p className="muted small">Ask if a problem is unclear. Answers that help everyone are shown to everyone.</p>}
      {items.map((c) => (
        <div key={c.id} className={`qa ${seen.current.has(c.id) ? '' : 'new'}`}>
          <small>{clock(c.answeredAt ?? c.at)} · {c.broadcast ? 'to everyone' : 'to you'}</small>
          {c.question && <div className="soft">{c.question}</div>}
          {c.answer ? <div>{c.answer}</div> : <div className="muted">Waiting for a proctor</div>}
        </div>
      ))}
      <form className="stack" style={{ gap: 8, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; askClarification(roundId, competitorId, q); setQ(''); toast('Question sent'); }}>
        <textarea className="textarea" style={{ minHeight: 64 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a problem" />
        <button className="btn btn-sm" type="submit" disabled={!q.trim()}>Send</button>
      </form>
    </div>
  );
}

/**
 * What a browser can see during a test: the tab hidden, the window losing
 * focus, fullscreen ending, a paste, a shrunken window, a dropped connection,
 * and the same person's test open twice. None of it sees a phone; the Zoom
 * camera is for that.
 */
function useIntegrity(record: (kind: IntegrityKind, ms?: number) => void, active: boolean, setNotFull: (v: boolean) => void, presenceKey: string) {
  const recordRef = useRef(record);
  recordRef.current = record;
  const away = useRef<{ start: number; kind: IntegrityKind } | null>(null);

  useEffect(() => {
    if (!active) return;
    const leave = (kind: IntegrityKind) => {
      if (!away.current) away.current = { start: Date.now(), kind };
      else if (kind === 'hidden') away.current.kind = 'hidden';
    };
    const back = () => {
      if (!away.current) return;
      const ms = Date.now() - away.current.start;
      const kind = away.current.kind;
      away.current = null;
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
      if ((e.target as HTMLElement)?.closest?.('.q-answer')) recordRef.current('paste');
    };
    let offlineAt = 0;
    const onOffline = () => (offlineAt = Date.now());
    const onOnline = () => offlineAt && recordRef.current('offline', Date.now() - offlineAt);
    let narrow = false;
    const onResize = () => {
      const isNarrow = window.innerWidth < (window.screen?.availWidth ?? window.innerWidth) * 0.6;
      if (isNarrow && !narrow) recordRef.current('resize');
      narrow = isNarrow;
    };
    // The same person's test open in two tabs or on two devices.
    const presence = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mathcloud-presence') : null;
    const me = Math.random().toString(36).slice(2);
    const onMsg = (e: MessageEvent<{ key: string; from: string; hello?: boolean }>) => {
      if (e.data.key !== presenceKey || e.data.from === me) return;
      if (e.data.hello) {
        presence?.postMessage({ key: presenceKey, from: me });
        recordRef.current('second_session');
      }
    };
    presence?.addEventListener('message', onMsg);
    presence?.postMessage({ key: presenceKey, from: me, hello: true });

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('paste', onPaste);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('resize', onResize);
      presence?.close();
    };
  }, [active, presenceKey, setNotFull]);
}
