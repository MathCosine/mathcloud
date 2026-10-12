import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { askClarification, logEvent, saveResponse, startAttempt, submitAttempt, submitGutsSet } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Clarification, IntegrityKind, Problem, Round } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, clockSec, duration, roundState } from '../../lib/time';
import { AnswerPreview, MathText, Modal, Tick, toast, useNow } from '../../components/ui';

export function TestPortal() {
  const { roundId } = useParams();
  const me = useStudent();
  const contest = useContest();
  const db = useDB();
  const round = contest.rounds.find((r) => r.id === roundId);
  if (!me || !round) return <Navigate to="/me" replace />;
  const division = contest.divisions.find((d) => d.id === me.team.divisionId)!;
  if (division.mode !== 'online') return <Navigate to="/me" replace />;
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
  const ok = honor.trim().toLowerCase().replace(/\s+/g, ' ') === name.toLowerCase();

  const begin = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen refused (iPhone, some embeds); the test still runs and logs focus changes */
    }
    startAttempt(round.id, entrantId, honor.trim());
  };

  return (
    <div className="test-shell">
      <div className="test-bar">
        <div className="left"><b>{round.name}</b><small>{contest.short}</small></div>
        <div />
        <div className="right"><Link to="/me" className="btn btn-sm">Back</Link></div>
      </div>
      <div style={{ maxWidth: 620, margin: '48px auto', padding: '0 20px' }} className="stack">
        <div className="eyebrow">{round.kind === 'individual' ? 'On your own' : round.kind === 'guts' ? 'With your team, a set at a time' : 'With your team, one shared sheet'} · {round.minutes} minutes</div>
        <h1>{round.name}</h1>
        <p className="sub2" style={{ fontSize: 15 }}>{round.rules}</p>
        <div className="panel panel-pad stack" style={{ gap: 10 }}>
          <h3>Before you start</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.7 }}>
            <li>Be in your Zoom room with your camera on.</li>
            <li>The test goes fullscreen. Leaving the tab, the window or fullscreen is logged for your proctor{round.integrity.policy === 'lock' ? `, and after ${round.integrity.lockAfter} times the test locks` : round.integrity.policy === 'warn' ? ', and you will see a warning' : ''}.</li>
            <li>Answers save as you type. If your connection drops, keep going; they save when it returns.</li>
            <li>The clock is the same for everyone and ends at {roundState(round) === 'open' && round.openedAt ? clock(new Date(new Date(round.openedAt).getTime() + round.minutes * 60000)) : 'the scheduled time'}.</li>
          </ul>
          <label className="field" style={{ marginTop: 6 }}>
            <span>Honour code: type your full name to promise the work is your {round.kind === 'individual' ? 'own' : 'team’s own'}</span>
            <input className="input" value={honor} onChange={(e) => setHonor(e.target.value)} placeholder={name} onKeyDown={(e) => e.key === 'Enter' && ok && state === 'open' && begin()} />
          </label>
          <div className="row">
            <button className="btn btn-primary btn-lg" type="button" disabled={!ok || state !== 'open'} onClick={begin}>Start {round.name}</button>
            {state !== 'open' && <span className="sub">This round is not open right now.</span>}
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
  const started = new Date(attempt.startedAt!).getTime();
  const left = deadline - now;
  const over = left <= -round.graceSeconds * 1000;
  const done = !!attempt.submittedAt || over;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'set' | 'all' | null>(null);
  const [notFull, setNotFull] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Hand in automatically when time is up.
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

  useIntegrity(record, !done && !attempt.locked, setNotFull, attempt.id);

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
    }, 450);
  };

  const sets = Math.max(...round.problems.map((p) => p.set ?? 1));
  const currentSet = (attempt.setsSubmitted ?? 0) + 1;
  const shown = round.kind === 'guts' ? round.problems.filter((p) => p.set === currentSet) : round.problems;
  const valueOf = (p: Problem) => (p.id in drafts ? drafts[p.id] : attempt.responses[p.id]?.value ?? '');
  const answered = round.problems.filter((p) => valueOf(p).trim()).length;
  const nameOf = (userId: string) => db.users.find((u) => u.id === userId)?.name ?? db.competitors.find((c) => `u-${c.id}` === userId)?.name ?? 'a teammate';
  const total = deadline - started;
  const low = left < 5 * 60000;

  const clars = db.clarifications
    .filter((c) => c.roundId === round.id && (c.broadcast || c.fromCompetitorId === me.competitor.id))
    .sort((a, b) => (b.answeredAt ?? b.at).localeCompare(a.answeredAt ?? a.at));
  const latestBroadcast = clars.find((c) => c.broadcast && c.answer && new Date(c.answeredAt ?? c.at).getTime() > started);
  const [seenBroadcast, setSeenBroadcast] = useState<string | null>(null);
  const room = contest.rooms.find((r) => r.teamIds.includes(me.team.id));

  if (done) {
    return (
      <div className="test-shell">
        <div className="test-bar"><div className="left"><b>{round.name}</b><small>{contest.short}</small></div><div /><div className="right" /></div>
        <div style={{ maxWidth: 520, margin: '72px auto', padding: '0 20px', textAlign: 'center' }} className="stack">
          <div className="lock-icon" style={{ background: 'var(--green-wash)', color: 'var(--green)' }}><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
          <h1>{over && !attempt.submittedAt ? 'Time’s up' : 'Handed in'}</h1>
          <p className="sub2">Your {round.kind === 'individual' ? '' : 'team’s '}answers were handed in{attempt.submittedAt ? ` at ${clockSec(attempt.submittedAt)}` : ''}. {answered} of {round.problems.length} answered. Results come out when the director publishes them.</p>
          <div><Link className="btn btn-primary" to="/me">Back to your rounds</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="test-shell">
      <div className="test-bar">
        <div className="left">
          <b>{round.name}{round.kind === 'guts' ? ` · set ${currentSet} of ${sets}` : ''}</b>
          <small>{me.competitor.publicId} {me.competitor.name}{round.kind !== 'individual' ? ` · ${me.team.name}` : ''}</small>
        </div>
        <div className={`timer ${low ? 'low' : ''} ${left <= 0 ? 'out' : ''}`} role="timer" aria-label={`${duration(left)} left`}>{duration(Math.max(0, left))}</div>
        <div className="right">
          <span key={pulse} className={`saved ${saving ? 'saving' : pulse ? 'pulse' : ''}`}><i />{saving ? 'Saving…' : savedAt ? `Saved ${clockSec(savedAt)}` : 'Answers save as you type'}</span>
          <button className="btn btn-sm" type="button" onClick={() => setConfirm(round.kind === 'guts' ? 'set' : 'all')}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
        </div>
      </div>
      <div className={`time-track ${low ? 'low' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></div>

      {latestBroadcast && seenBroadcast !== latestBroadcast.id && (
        <div className="callout blue" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0, animation: 'swap-in 260ms var(--ease) both' }}>
          <span style={{ flex: 1 }}><b>Announcement</b> · {latestBroadcast.question ? `${latestBroadcast.question} ` : ''}{latestBroadcast.answer}</span>
          <button className="btn btn-sm" type="button" onClick={() => setSeenBroadcast(latestBroadcast.id)}>Got it</button>
        </div>
      )}
      {notFull && (
        <div className="callout amber" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
          <span style={{ flex: 1 }}>You are out of fullscreen. Go back so nothing else is on screen.</span>
          <button className="btn btn-sm" type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => setNotFull(false))}>Return to fullscreen</button>
        </div>
      )}

      <div className="test-body">
        <div>
          {round.kind === 'guts' && (
            <div className="set-steps">
              {Array.from({ length: sets }, (_, i) => i + 1).map((s) => (
                <span key={s} className={`set-step ${s < currentSet ? 'done' : s === currentSet ? 'now' : ''}`}>{s < currentSet && <Tick />}Set {s}</span>
              ))}
            </div>
          )}
          <div className="problems" key={currentSet}>
            {shown.map((p, i) => {
              const v = valueOf(p);
              const editor = attempt.responses[p.id]?.by;
              return (
                <div key={p.id} className={`problem ${v.trim() ? 'answered' : ''}`} style={{ animation: `swap-in 240ms var(--ease) ${i * 30}ms both` }}>
                  <span className="pnum">{round.kind === 'guts' ? `${p.set}.${((p.number - 1) % 4) + 1}` : p.number}</span>
                  <div className="ptext">
                    <MathText text={p.text} />
                    {round.kind === 'guts' && <div className="sub mono" style={{ fontSize: 11.5, marginTop: 4 }}>{p.points} points</div>}
                  </div>
                  <div className="pans">
                    <input
                      aria-label={`Answer to problem ${p.number}`}
                      value={v}
                      inputMode={p.answerType === 'integer' ? 'numeric' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={attempt.locked}
                      onFocus={() => setFocused(p.id)}
                      onBlur={() => setFocused((f) => (f === p.id ? null : f))}
                      onChange={(e) => { setDrafts((d) => ({ ...d, [p.id]: e.target.value })); save(p, e.target.value); }}
                    />
                    <span className="preview"><AnswerPreview value={v} /></span>
                    {round.kind !== 'individual' && editor && editor !== me.user.id && focused !== p.id && <span className="who-edit">Last typed by {nameOf(editor)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <span className="sub" style={{ fontSize: 12.5 }}>{answered} of {round.problems.length} answered</span>
            <button className="btn btn-primary" type="button" onClick={() => setConfirm(round.kind === 'guts' ? 'set' : 'all')}>{round.kind === 'guts' ? `Hand in set ${currentSet}` : 'Hand in'}</button>
          </div>
        </div>

        <aside>
          {room && (
            <div className="side-card">
              <h3>{room.name} on Zoom</h3>
              <p className="sub" style={{ fontSize: 12.5 }}>Stay on camera for the whole round. Raise a hand there if something is wrong with your computer.</p>
            </div>
          )}
          <Clarifications roundId={round.id} competitorId={me.competitor.id} items={clars} />
        </aside>
      </div>

      {warn && (
        <Modal title="That was recorded" onClose={() => setWarn(null)} actions={<button className="btn btn-primary" type="button" onClick={() => setWarn(null)}>Back to the test</button>}>
          <p>{warn} Stay in this window until you hand in.{round.integrity.policy === 'lock' ? ` After ${round.integrity.lockAfter} times the test locks until your proctor unlocks it.` : ''}</p>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm === 'set' ? `Hand in set ${currentSet}?` : `Hand in ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Keep working</button>
              <button className="btn btn-primary" type="button" onClick={() => {
                Object.values(timers.current).forEach(clearTimeout);
                for (const p of shown) if (p.id in drafts) saveResponse(attempt.id, p.id, drafts[p.id], me.user.id);
                if (confirm === 'set') submitGutsSet(attempt.id);
                else submitAttempt(attempt.id);
                setDrafts({});
                setConfirm(null);
              }}>{confirm === 'set' ? 'Hand in and see the next set' : 'Hand in'}</button>
            </>
          }
        >
          <p>
            {confirm === 'set'
              ? `Once you move on you cannot come back to set ${currentSet}. ${shown.filter((p) => !valueOf(p).trim()).length ? `${shown.filter((p) => !valueOf(p).trim()).length} of its answers are blank.` : 'Every answer in it is filled in.'}`
              : `${round.problems.length - answered ? `${round.problems.length - answered} answers are blank. ` : ''}You have ${duration(left)} left, and you cannot change anything after handing in.`}
          </p>
        </Modal>
      )}
      {attempt.locked && (
        <div className="lock-screen" role="alertdialog" aria-label="Test locked">
          <div className="lock-card">
            <div className="lock-icon"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></div>
            <h2>Your test is locked</h2>
            <p>You left the test too many times. Your proctor has been told and can unlock it from the proctoring screen. Tell them on Zoom. Your answers are safe, and the clock keeps running.</p>
            <p className="mono sub" style={{ marginTop: 12 }}>{duration(Math.max(0, left))} left</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Clarifications({ roundId, competitorId, items }: { roundId: string; competitorId: string; items: Clarification[] }) {
  const [q, setQ] = useState('');
  const seen = useRef(new Set(items.map((c) => c.id)));
  useEffect(() => {
    items.forEach((c) => seen.current.add(c.id));
  });
  return (
    <div className="side-card">
      <h3>Questions and answers</h3>
      {items.length === 0 && <p className="sub" style={{ fontSize: 12.5 }}>Nothing yet. Ask if a problem is unclear; answers that help everyone are shown to everyone.</p>}
      {items.map((c) => (
        <div key={c.id} className={`clar ${seen.current.has(c.id) ? '' : 'new'}`}>
          <small>{clock(c.answeredAt ?? c.at)} · {c.broadcast ? 'to everyone' : 'to you'}</small>
          {c.question && <div className="sub2">{c.question}</div>}
          {c.answer ? <div>{c.answer}</div> : <div className="sub">Waiting for a proctor…</div>}
        </div>
      ))}
      <form className="stack" style={{ gap: 6, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; askClarification(roundId, competitorId, q); setQ(''); toast('Question sent', 'A proctor will answer here.'); }}>
        <textarea className="textarea" style={{ minHeight: 56 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a problem" />
        <button className="btn btn-sm" type="submit" disabled={!q.trim()}>Send question</button>
      </form>
    </div>
  );
}

/**
 * What a browser can see during a test: the tab hidden, the window losing
 * focus, fullscreen ending, a paste, a shrunken window, a dropped connection,
 * and the same test open twice. Each becomes an event with its duration.
 * None of it sees a phone; that is what the Zoom camera is for.
 */
function useIntegrity(record: (kind: IntegrityKind, ms?: number) => void, active: boolean, setNotFull: (v: boolean) => void, attemptId: string) {
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
    const onPaste = () => recordRef.current('paste');
    let offlineAt = 0;
    const onOffline = () => (offlineAt = Date.now());
    const onOnline = () => offlineAt && recordRef.current('offline', Date.now() - offlineAt);
    let narrow = false;
    const onResize = () => {
      const isNarrow = window.innerWidth < (window.screen?.availWidth ?? window.innerWidth) * 0.6;
      if (isNarrow && !narrow) recordRef.current('resize');
      narrow = isNarrow;
    };
    // The same attempt open in two tabs or devices.
    const presence = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mathcloud-presence') : null;
    const me = Math.random().toString(36).slice(2);
    presence?.postMessage({ attemptId, from: me, hello: true });
    presence?.addEventListener('message', (e: MessageEvent<{ attemptId: string; from: string; hello?: boolean }>) => {
      if (e.data.attemptId !== attemptId || e.data.from === me) return;
      if (e.data.hello) {
        presence.postMessage({ attemptId, from: me });
        recordRef.current('second_session');
      }
    });

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
  }, [active, attemptId, setNotFull]);
}
