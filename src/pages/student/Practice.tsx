import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GUTS, INDIVIDUAL, type DemoProblem } from '../../lib/demo/problems';
import type { Problem } from '../../lib/model';
import { homeFor, useStudent, useUser } from '../../lib/session';
import { duration } from '../../lib/time';
import { Logo } from '../../components/art';
import { Icon, type IconName } from '../../components/icons';
import { Tick } from './parts';
import { ExamSim } from './ExamSim';
import '../../styles/portal.css';
import '../../styles/practice.css';

/**
 * A ten-minute practice test, for anyone, signed in or not. It runs entirely
 * in the browser (see ExamSim): no attempt, no answers stored, no requests.
 * First a short "get ready" screen with what matters on the day and a check
 * of what this browser can do; then the test, exactly as the real one looks.
 */

const MINUTES = 10;

function problem(d: DemoProblem, i: number, set?: number): Problem {
  return { id: `practice-${i + 1}`, number: i + 1, set, text: d.text, answers: d.answers, answerType: d.type ?? 'integer', points: set ? 4 : 1 };
}

/** Three on their own (one with a fraction for an answer), then one Guts-style set of three. */
const PROBLEMS: Problem[] = [
  problem(INDIVIDUAL[0], 0),
  problem(INDIVIDUAL[2], 1),
  problem(INDIVIDUAL[6], 2),
  problem(GUTS[0][0], 3, 1),
  problem(GUTS[0][2], 4, 1),
  problem(GUTS[0][3], 5, 1),
];

export function Practice() {
  const user = useUser();
  const me = useStudent();
  const [step, setStep] = useState<'ready' | 'test'>('ready');
  const exit = user ? { label: 'Back to your page', to: homeFor(user) } : { label: 'Back to sign in', to: '/sign-in' };

  if (step === 'ready') return <GetReady exit={exit} onGo={() => setStep('test')} />;
  return (
    <ExamSim
      title="Practice test"
      context="Sample problems"
      minutes={MINUTES}
      kind="individual"
      problems={PROBLEMS}
      rules="Three problems to answer in any order, then a Guts-style set: hand it in to finish. Exact answers: integers, or fractions in lowest terms."
      integrity={{ policy: 'warn', lockAfter: 99 }}
      freezeMinutes={10}
      name={me?.competitor.name}
      who={me ? `${me.competitor.publicId} ${me.competitor.name} · practice` : undefined}
      audience="student"
      onBack={() => setStep('ready')}
      exit={exit}
      ribbon={
        <>
          <span className="ps-ribbon-t"><Icon name="pencil" size={14} /><span><b>Practice test.</b> Nothing you type leaves this tab.</span></span>
          <Link to={exit.to}>Leave</Link>
        </>
      }
    />
  );
}

// -------------------------------------------------------------- get ready

type CheckState = 'busy' | 'todo' | 'ok' | 'warn' | 'bad';
type Check = { key: string; icon: IconName; title: string; sub: ReactNode; state: CheckState; action?: ReactNode };

function GetReady({ exit, onGo }: { exit: { label: string; to: string }; onGo: () => void }) {
  const user = useUser();
  const [shown, setShown] = useState(0);
  const [full, setFull] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [away, setAway] = useState<number | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false);
  const [wide, setWide] = useState(typeof window === 'undefined' ? true : window.innerWidth >= 900);

  // The checks tick in one after another, so each one is read.
  useEffect(() => {
    if (shown >= 4) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 380);
    return () => clearTimeout(t);
  }, [shown]);

  // Leaving the tab and coming back: the same signal the test listens to.
  useEffect(() => {
    let left = 0;
    const onVis = () => {
      if (document.hidden) left = Date.now();
      else if (left) {
        const ms = Date.now() - left;
        left = 0;
        if (ms > 400) setAway(ms);
      }
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onResize = () => setWide(window.innerWidth >= 900);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const tryFull = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFull('ok');
      setTimeout(() => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      }, 1400);
    } catch {
      setFull('failed');
    }
  };

  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const canSee = typeof document !== 'undefined' && typeof document.hidden === 'boolean';
  const checks: Check[] = [
    {
      key: 'full',
      icon: 'screen',
      title: 'Fullscreen works',
      state: !canFull || full === 'failed' ? 'warn' : full === 'ok' ? 'ok' : 'todo',
      sub: !canFull || full === 'failed'
        ? 'This browser will not go fullscreen. The test still runs; use Chrome, Edge or Firefox on a computer if you can.'
        : full === 'ok' ? 'It went fullscreen and came back. The test does this when you press Start.' : 'Press Try it: the page goes fullscreen for a moment.',
      action: canFull && full !== 'ok' ? <button className="btn btn-sm" type="button" onClick={tryFull}>Try it</button> : undefined,
    },
    {
      key: 'tab',
      icon: 'eye',
      title: 'Leaving the tab is noticed',
      state: !canSee ? 'warn' : away !== null ? 'ok' : 'todo',
      sub: !canSee ? 'This browser does not say when you leave the tab.' : away !== null ? `Noticed: you were away for ${duration(away)}. In the test, your proctor sees this.` : 'Switch to another tab or app, then come back here.',
    },
    {
      key: 'net',
      icon: 'cloud',
      title: online ? 'Connected' : 'No connection',
      state: online ? 'ok' : 'bad',
      sub: online ? 'Answers save while you type, so a steady connection matters.' : 'Connect to the internet. On the day, answers save while you type.',
    },
    {
      key: 'size',
      icon: 'screen',
      title: wide ? 'Screen is big enough' : 'Small screen',
      state: wide ? 'ok' : 'warn',
      sub: wide ? 'Problems and answer boxes sit side by side.' : 'The test works here, but a laptop or desktop is easier on the day.',
    },
  ];
  const ready = checks.filter((c, i) => i < shown && c.state === 'ok').length;

  return (
    <div className="ex">
      <div className="ex-bar intro">
        <div className="ex-l"><Logo size={24} /><span><b>Practice test</b><small>{user ? 'Not part of the contest' : 'MathCloud'}</small></span></div>
        <div className="ex-clock idle" role="timer">{duration(MINUTES * 60000)}</div>
        <div className="ex-r"><Link className="btn btn-sm btn-quiet" to={exit.to}><Icon name="back" />Back</Link></div>
      </div>
      <div className="ex-intro ps-ready">
        <div>
          <div className="ex-chips">
            <span className="ex-chip"><Icon name="user" size={14} />On your own</span>
            <span className="ex-chip"><Icon name="timer" size={14} />{MINUTES} minutes</span>
            <span className="ex-chip"><Icon name="sigma" size={14} />{PROBLEMS.length} problems</span>
          </div>
          <h1>Try the test before the day</h1>
          <p className="lede">The same screen as the online rounds, with sample problems: three on their own, then a Guts-style set. Nothing is saved or sent, and at the end you see which answers were right.</p>
        </div>

        <section>
          <h2 className="ps-h"><span><Icon name="checklist" size={16} />On the day</span></h2>
          <ul className="ex-rules">
            <li><span className="ex-ic"><Icon name="video" /></span>Join your Zoom room with your camera on, showing you and your desk.</li>
            <li><span className="ex-ic"><Icon name="close" /></span>Close other tabs and apps first. Leaving the test is recorded for your proctor.</li>
            <li><span className="ex-ic"><Icon name="cloud" /></span>Use a steady connection: sit near the router, or plug in.</li>
          </ul>
        </section>

        <section>
          <h2 className="ps-h"><span><Icon name="screen" size={16} />This device</span><span className="label">{ready} of {checks.length} checked</span></h2>
          <div className="ps-meter" aria-hidden="true"><i style={{ width: `${(ready / checks.length) * 100}%` }} /></div>
          <ul className="pt-check ps-device">
            {checks.map((c, i) => {
              const state: CheckState = i < shown ? c.state : 'busy';
              return (
                <li key={c.key} className={state === 'ok' ? 'done' : ''}>
                  {state === 'warn' || state === 'bad' ? <span className="ps-pending" aria-hidden="true"><Icon name="warning" size={13} /></span> : <Tick on={state === 'ok'} next={state === 'todo'} busy={state === 'busy'} />}
                  <span><b>{c.title}</b><small className={state === 'warn' ? 'wait' : state === 'bad' ? 'bad' : ''}>{state === 'busy' ? 'Checking' : c.sub}</small></span>
                  {state === 'busy' ? <span /> : c.action ?? (state === 'ok' ? <span className="ok">OK</span> : state === 'todo' ? <span className="muted small">Waiting</span> : <span />)}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="ex-start">
          <button className="btn btn-primary btn-lg pt-start" type="button" onClick={onGo}>Continue to the test<Icon name="arrow" /></button>
          <span className="muted">Next: the start screen, as on the day.</span>
        </div>
      </div>
    </div>
  );
}
