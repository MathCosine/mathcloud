import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { askClarification, logEvent, saveResponse, startAttempt, submitAttempt, submitGutsSet } from '../../lib/actions';
import { ordinal, useBoard, useContest } from '../../lib/hooks';
import type { Clarification, IntegrityKind, Problem, Round } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, clockSec, duration, roundEnds, roundState } from '../../lib/time';
import { ScoreList } from '../../components/Scoreboard';
import { Logo } from '../../components/art';
import { Icon, type IconName } from '../../components/icons';
import { AnswerPreview, MathText, Modal, Segmented, toast, useNow } from '../../components/ui';
import { Tick } from './parts';
import '../../styles/portal.css';
import { loadTex } from '../../lib/tex';

// Start loading the maths typesetter with the test, so problems appear typeset.
void loadTex();

export function TestPortal() {
  const { roundId } = useParams();
  const me = useStudent();
  const contest = useContest() as ReturnType<typeof useContest> | undefined;
  const db = useDB();
  const round = contest?.rounds.find((r) => r.id === roundId);
  if (!me || !contest || !round) return <Navigate to="/me" replace />;
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
  const kind: [IconName, string] = round.kind === 'individual' ? ['user', 'On your own'] : round.kind === 'guts' ? ['roster', 'With your team, one set at a time'] : ['roster', 'With your team, one shared sheet'];
  return (
    <div className="ex">
      <div className="ex-bar intro">
        <div className="ex-l"><Logo size={24} /><span><b>{round.name}</b><small>{contest.short}</small></span></div>
        <div className={`ex-clock ${state === 'open' ? '' : 'idle'}`} role="timer">{state === 'open' && ends ? duration(ends - now) : '--:--'}</div>
        <div className="ex-r"><Link className="btn btn-sm btn-quiet" to="/me"><Icon name="back" />Back</Link></div>
      </div>
      <div className="ex-intro">
        <div>
          <div className="ex-chips">
            <span className="ex-chip"><Icon name={kind[0]} size={14} />{kind[1]}</span>
            <span className="ex-chip"><Icon name="timer" size={14} />{round.minutes} minutes</span>
            <span className="ex-chip"><Icon name="sigma" size={14} />{round.problems.length} problems</span>
          </div>
          <h1>{round.name}</h1>
          <p className="lede">{round.rules}</p>
        </div>
        <ul className="ex-rules">
          <li><span className="ex-ic"><Icon name="video" /></span>Stay in your Zoom room with your camera on.</li>
          <li><span className="ex-ic"><Icon name="screen" /></span><span>The test goes fullscreen. Leaving it is recorded for your proctor{round.integrity.policy === 'warn' ? ', and you will see a warning' : round.integrity.policy === 'lock' ? `, and the test locks after ${round.integrity.lockAfter} times` : ''}.</span></li>
          <li><span className="ex-ic"><Icon name="check-circle" /></span>Answers save as you type.</li>
          {round.kind === 'guts' && <li><span className="ex-ic"><Icon name="board" /></span>A live scoreboard sits beside the problems. It freezes {contest.board.freezeMinutes} minutes before the end.</li>}
        </ul>
        <div className="stack" style={{ gap: 16 }}>
          <label className="field">
            <span>Type your full name to promise the work is {round.kind === 'individual' ? 'your own' : 'your team’s own'}</span>
            <span className="ex-honor">
              <input className="input" value={honor} onChange={(e) => setHonor(e.target.value)} placeholder={name} autoComplete="off" spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && ok && state === 'open' && begin()} />
              <Tick on={ok} label={ok ? 'Name matches' : undefined} />
            </span>
          </label>
          <div className="ex-start">
            <button className="btn btn-primary btn-lg pt-start" type="button" disabled={!ok || state !== 'open'} onClick={begin}>Start {round.name}<Icon name="arrow" /></button>
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
    const timeUp = over && !attempt.submittedAt;
    return (
      <div className="ex">
        <div className="ex-bar"><div className="ex-l"><Logo size={24} /><span><b>{round.name}</b><small>{contest.short}</small></span></div><div /><div className="ex-r" /></div>
        <div className="ex-done">
          <div>
            <svg className="ex-mark" viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r="32" fill={timeUp ? 'var(--amber)' : 'var(--green)'} />
              <path d="M20 33.5l8 8 16-17" />
            </svg>
            <h1>{timeUp ? 'Time’s up' : 'Handed in'}</h1>
            <p className="lede">{answered} of {round.problems.length} answered{attempt.submittedAt ? `, handed in at ${clock(attempt.submittedAt)}` : ''}. Your results appear on your page when the organisers publish them.</p>
          </div>
          {round.kind === 'guts' && board && (
            <div className="card pt-card ex-done-board">
              <div className="ex-panel-head"><b>Scoreboard</b><span className="label">{board.frozen ? 'Frozen' : <span className="state go">Live</span>}</span></div>
              <ScoreList board={board} mine={me.team.id} limit={8} />
            </div>
          )}
          <div><Link className="btn btn-primary btn-lg" to="/me">Back to your page<Icon name="arrow" /></Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="ex">
      <div className="ex-bar">
        <div className="ex-l">
          <span>
            <b>{round.name}{round.kind === 'guts' ? `, set ${currentSet} of ${totalSets}` : ''}</b>
            <small>{me.competitor.publicId} {me.competitor.name}{round.kind !== 'individual' ? ` · ${me.team.name}` : ''}</small>
          </span>
        </div>
        <div className={`ex-clock ${low ? 'low' : ''} ${left <= 0 ? 'out' : ''}`} role="timer">{duration(Math.max(0, left))}</div>
        <div className="ex-r">
          <span key={pulse} className={`ex-saved ${saving ? 'busy' : pulse ? 'pulse' : ''}`}><i />{saving ? 'Saving' : savedAt ? `Saved ${clockSec(savedAt)}` : 'Saves as you type'}</span>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setConfirm(true)}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
        </div>
        <div className={`ex-track ${low ? 'low' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></div>
      </div>

      {fresh && seen !== fresh.id && (
        <div className="ex-banner" role="status">
          <Icon name="announce" />
          <span><b>From the proctors:</b> {fresh.question ? `${fresh.question} ` : ''}{fresh.answer}</span>
          <button className="btn btn-sm" type="button" onClick={() => setSeen(fresh.id)}>OK</button>
        </div>
      )}
      {notFull && (
        <div className="ex-banner amber" role="status">
          <Icon name="screen" />
          <span>You left fullscreen.</span>
          <button className="btn btn-sm" type="button" onClick={() => document.documentElement.requestFullscreen?.().then(() => setNotFull(false)).catch(() => setNotFull(false))}>Go back to fullscreen</button>
        </div>
      )}

      <div className="ex-body">
        <div>
          {round.kind === 'guts' && (
            <>
              <div className="ex-sets" aria-label={`Set ${currentSet} of ${totalSets}`}>
                {Array.from({ length: totalSets }, (_, i) => <span key={i} className={i + 1 < currentSet ? 'done' : i + 1 === currentSet ? 'now' : ''} />)}
              </div>
              <div className="ex-setline">
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
                <div key={p.id} className={`ex-q ${v.trim() ? 'answered' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="ex-num">{round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : p.number}</span>
                  <div>
                    <MathText text={p.text} className="ex-text" />
                  </div>
                  <div className="ex-answer">
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
                    <span className="ex-preview"><AnswerPreview value={v} /></span>
                    {round.kind !== 'individual' && by && by !== me.user.id && focused !== p.id && <span className="ex-by">Typed by {nameOf(by)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="ex-foot">
            <span className="ex-progress"><i><em style={{ width: `${(answered / Math.max(1, round.problems.length)) * 100}%` }} /></i>{answered} of {round.problems.length} answered</span>
            <button className="btn btn-primary" type="button" onClick={() => setConfirm(true)}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
          </div>
        </div>

        <aside className="ex-aside">
          {round.kind === 'guts' && (
            <Segmented label="Side panel" value={panel} onChange={setPanel} items={[{ key: 'board', label: 'Scoreboard' }, { key: 'questions', label: 'Questions', count: clars.length || undefined }]} />
          )}
          {panel === 'board' && board ? (
            <div>
              <div className="ex-panel-head">
                <span className="label">{contest.divisions.find((d) => d.id === me.team.divisionId)?.name} division</span>
                <span className="label">{board.frozen ? 'Frozen' : <span className="state go">Live</span>}</span>
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
        <div className="ex-lock" role="alertdialog" aria-label="Test locked">
          <div>
            <span className="ex-lock-ic"><Icon name="lock" size={22} /></span>
            <h2>Your test is locked</h2>
            <p className="soft">You left the test too many times. Tell your proctor on Zoom; they can unlock it. Your answers are safe and the clock keeps running.</p>
            <p className="ex-clock" style={{ marginTop: 8 }}>{duration(Math.max(0, left))}</p>
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
      <div className="ex-panel-head"><b>Questions</b>{items.length > 0 && <span className="label">{items.length}</span>}</div>
      {items.length === 0 && <p className="muted small">Ask if a problem is unclear. Answers that help everyone are shown to everyone.</p>}
      {items.map((c) => (
        <div key={c.id} className={`ex-qa ${seen.current.has(c.id) ? '' : 'new'}`}>
          <small>{clock(c.answeredAt ?? c.at)} · {c.broadcast ? 'to everyone' : 'to you'}</small>
          {c.question && <div className="soft">{c.question}</div>}
          {c.answer ? <div>{c.answer}</div> : <div className="muted">Waiting for a proctor</div>}
        </div>
      ))}
      <form className="ex-ask" onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; askClarification(roundId, competitorId, q); setQ(''); toast('Question sent', 'A proctor will answer here.', 'g'); }}>
        <textarea className="textarea" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a problem" />
        <button className="btn btn-sm" type="submit" disabled={!q.trim()}><Icon name="send" size={14} />Send</button>
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
      if ((e.target as HTMLElement)?.closest?.('.ex-answer')) recordRef.current('paste');
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
