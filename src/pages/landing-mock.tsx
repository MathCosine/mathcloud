import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Logo } from '../components/art';
import { Icon, type IconName } from '../components/icons';
import { Roll, Track } from '../components/ui';

/**
 * The front page's picture of the product: the organiser's Live page at noon
 * on contest day, drawn with the app's own pieces. The Guts board reorders as
 * sets come in, a grader keys a paper sheet, and now and then ⌘K opens to
 * find a student. It only moves while it is on screen, and not at all for
 * people who ask for reduced motion.
 */

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True while the element is on screen, the tab is visible and motion is welcome. */
export function usePlaying(ref: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
    let seen = false;
    const update = () => setOn(seen && !document.hidden);
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      update();
    }, { threshold: 0.12 });
    io.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [ref]);
  return on;
}

/** Call `fn` every `ms` while `on`. */
function useEvery(on: boolean, ms: number, fn: () => void) {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => f.current(), ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

// ------------------------------------------------------------------- data

type Mode = 'in_person' | 'online';
type BoardTeam = { id: string; name: string; mode: Mode; score: number; sets: number };
const TEAMS: BoardTeam[] = [
  { id: 'tt', name: 'Tidepool Theorems', mode: 'in_person', score: 61, sets: 4 },
  { id: 'hy', name: 'Hydrothermal', mode: 'in_person', score: 58, sets: 4 },
  { id: 'mj', name: 'Moon Jellies', mode: 'online', score: 55, sets: 4 },
  { id: 'bt', name: 'Blue Tangents', mode: 'online', score: 52, sets: 4 },
  { id: 'ap', name: 'Abyssal Plain', mode: 'in_person', score: 47, sets: 3 },
  { id: 'su', name: 'Sea Urchin Sums', mode: 'online', score: 43, sets: 3 },
];
// Which team hands in next, round and round: chosen so that places change.
const ORDER = ['su', 'mj', 'ap', 'bt', 'hy', 'su', 'tt', 'mj', 'ap', 'bt', 'su', 'hy', 'mj', 'tt'];
const GAIN = [0, 4, 6, 8, 10, 12, 14];

const SHEETS: { id: string; set: number; rows: { n: number; v: string; ok: boolean }[] }[] = [
  { id: 'T05', set: 5, rows: [{ n: 17, v: '144', ok: true }, { n: 18, v: '7/12', ok: true }, { n: 19, v: '√12', ok: false }, { n: 20, v: '40', ok: true }] },
  { id: 'T11', set: 4, rows: [{ n: 13, v: '2027', ok: true }, { n: 14, v: '0.375', ok: false }, { n: 15, v: '18', ok: true }, { n: 16, v: '5', ok: true }] },
];

const PALETTE = [
  { kind: 'Students', label: 'Carter Hughes', hint: 'Sea Urchin Sums', code: '16A', icon: 'student' as IconName },
  { kind: 'Students', label: 'Carla Mendes', hint: 'Abyssal Plain', code: '09B', icon: 'student' as IconName },
  { kind: 'Teams', label: 'Coral Lemma', hint: 'In person', code: '05', icon: 'roster' as IconName },
];

// --------------------------------------------------------------- the mock

export function HeroMock() {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1120);
  const playing = usePlaying(wrap);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width < 700;
  const W = compact ? 560 : 1200;
  const H = compact ? 836 : 676;
  const s = width / W;

  return (
    <div ref={wrap} className="mk-wrap" style={{ height: H * s }} role="img" aria-label="MathCloud's Live page during the Guts round: the scoreboard reorders as teams hand in sets, a grader keys a paper answer sheet, and the command bar finds a student.">
      <div className={`mk-stage ${compact ? 'compact' : ''}`} style={{ width: W, height: H, transform: `scale(${s})` }} aria-hidden="true" inert>
        {!compact && <MockSide />}
        <div className="mk-sheet">
          <div className="mk-sheet-head">
            <span className="mk-crumbs"><span>SFMO 2027</span><Icon name="chevron-right" size={13} /><b>Live</b></span>
            <span className="grow" />
            <Clock playing={playing} />
          </div>
          <MockBody playing={playing} compact={compact} />
          <Palette playing={playing} />
        </div>
      </div>
    </div>
  );
}

function MockSide() {
  const nav: [IconName, string, string?][] = [
    ['overview', 'Overview'], ['roster', 'Teams', '21'], ['people', 'People'], ['waivers', 'Waivers'],
    ['rounds', 'Rounds'], ['live', 'Live', 'live'], ['grading', 'Grading', '3'],
    ['results', 'Results'], ['reports', 'Reports'], ['mail', 'Email'],
  ];
  return (
    <div className="mk-side">
      <div className="mk-brand"><Logo size={22} /><span>MathCloud</span></div>
      <div className="mk-ctx">
        <span className="tile" style={{ width: 28, height: 28, fontSize: 10, borderRadius: 8 }}>SF</span>
        <span><b>SFMO 2027</b><small>SF Math Initiative</small></span>
        <Icon name="chevron" size={14} />
      </div>
      <div className="mk-find"><Icon name="search" size={14} />Search or jump to…<span className="kbd">⌘K</span></div>
      {nav.map(([icon, label, n], i) => (
        <div key={label}>
          {(i === 1 || i === 4 || i === 7) && <div className="mk-nav-label">{i === 1 ? 'Before' : i === 4 ? 'On the day' : 'After'}</div>}
          <div className={`mk-nav ${label === 'Live' ? 'on' : ''}`}>
            <Icon name={icon} size={15} />
            {label}
            {n === 'live' ? <span className="dot-live" /> : n ? <span className={`mk-count ${n === '3' ? 'hot' : ''}`}>{n}</span> : null}
          </div>
        </div>
      ))}
      <div className="mk-me"><span className="avatar">JL</span><span><b>Jordan Lee</b><small>Director</small></span></div>
    </div>
  );
}

function Clock({ playing }: { playing: boolean }) {
  const [left, setLeft] = useState(37 * 60 + 41);
  useEvery(playing, 1000, () => setLeft((l) => (l <= 10 * 60 ? 37 * 60 + 41 : l - 1)));
  return <span className="live-pill">Guts <span className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></span>;
}

function MockBody({ playing, compact }: { playing: boolean; compact: boolean }) {
  const [teams, setTeams] = useState(TEAMS);
  const [step, setStep] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [fading, setFading] = useState(false);

  useEvery(playing, 2600, () => {
    if (step >= ORDER.length) {
      // Back to the start, out of sight of the change.
      setFading(true);
      setTimeout(() => {
        setTeams(TEAMS);
        setStep(0);
        setFading(false);
      }, 320);
      return;
    }
    const id = ORDER[step];
    setStep((n) => n + 1);
    setTeams((ts) => ts.map((t) => (t.id === id && t.sets < 6 ? { ...t, sets: t.sets + 1, score: t.score + GAIN[t.sets + 1] } : t)));
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1300);
  });

  const ranked = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const sets = teams.reduce((n, t) => n + t.sets, 0) + 18;

  return (
    <div className="mk-body">
      <div className="mk-head">
        <div>
          <h3>Guts is open</h3>
          <p><Roll value={sets} /> sets in · 7 online teams working</p>
        </div>
        {!compact && (
          <div className="row" style={{ gap: 8 }}>
            <span className="btn btn-sm"><Icon name="board" size={14} />Board</span>
            <span className="btn btn-sm btn-primary"><Icon name="announce" size={14} />Announce</span>
          </div>
        )}
      </div>
      {!compact && (
        <div className="mk-figs">
          <div className="mk-fig"><span className="mode in_person"><Icon name="pin" size={12} />In person</span><b>52</b><small>of 52 checked in</small><i><em style={{ width: '100%' }} /></i></div>
          <div className="mk-fig"><span className="mode online"><Icon name="screen" size={12} />Online</span><b>31</b><small>of 32 in Zoom rooms</small><i className="b"><em style={{ width: '96%' }} /></i></div>
          <div className="mk-fig"><span className="mk-fig-label">To rule on</span><b>3</b><small>answers not in the key</small></div>
        </div>
      )}
      <div className="mk-cols">
        <div className="mk-card">
          <div className="mk-card-head"><b>Scoreboard</b><span className="state go">Live</span></div>
          <div className={`mk-board ${fading ? 'fading' : ''}`} style={{ height: ranked.length * 46 }}>
            {teams.map((t) => {
              const place = ranked.indexOf(t);
              return (
                <div key={t.id} className={`mk-row ${flash === t.id ? 'flash' : ''} ${t.id === 'su' ? 'mine' : ''}`} style={{ transform: `translateY(${place * 46}px)` }}>
                  <span className="mk-place">{place + 1}</span>
                  <span className={`mk-dot ${t.mode}`} />
                  <span className="mk-name">{t.name}</span>
                  <Track done={t.sets} total={6} current={t.sets < 6 ? t.sets + 1 : null} />
                  <span className="mk-score"><Roll value={t.score} /></span>
                </div>
              );
            })}
          </div>
        </div>
        <Keying playing={playing} />
      </div>
    </div>
  );
}

/** A grader keys a paper sheet: each answer typed, then checked against the key. */
function Keying({ playing }: { playing: boolean }) {
  const [sheet, setSheet] = useState(0);
  const [row, setRow] = useState(0);
  const [chars, setChars] = useState(0);
  const [judged, setJudged] = useState(0);
  const cur = SHEETS[sheet];

  useEffect(() => {
    if (!playing) return;
    let t: ReturnType<typeof setTimeout>;
    if (row >= cur.rows.length) {
      t = setTimeout(() => {
        setSheet((s) => (s + 1) % SHEETS.length);
        setRow(0);
        setChars(0);
        setJudged(0);
      }, 2400);
    } else if (chars < [...cur.rows[row].v].length) {
      t = setTimeout(() => setChars((c) => c + 1), 150 + Math.random() * 90);
    } else if (judged <= row) {
      t = setTimeout(() => setJudged(row + 1), 380);
    } else {
      t = setTimeout(() => {
        setRow((r) => r + 1);
        setChars(0);
      }, 520);
    }
    return () => clearTimeout(t);
  }, [playing, row, chars, judged, cur]);

  // Reduced motion, or before it starts: the sheet already keyed.
  const still = !playing && row === 0 && chars === 0;
  return (
    <div className="mk-card">
      <div className="mk-card-head"><b>Key paper sheets</b><span className="mk-muted">Guts · set {cur.set}</span></div>
      <div className="mk-key-id"><span className="mono">{cur.id}</span><span className="mode in_person"><Icon name="pin" size={12} />In person</span></div>
      <div className="mk-keyrows" key={cur.id}>
        {cur.rows.map((r, i) => {
          const done = still || i < row || (i === row && judged > i);
          const typing = !still && i === row && !done;
          const shown = still || i < row ? r.v : i === row ? [...r.v].slice(0, chars).join('') : '';
          return (
            <div key={r.n} className={`mk-keyrow ${done ? (r.ok ? 'ok' : 'rule') : ''} ${typing ? 'typing' : ''}`}>
              <span className="mk-n">{r.n}</span>
              <span className="mk-input mono">{shown}{typing && <i className="mk-caret" />}</span>
              <span className="mk-verdict">
                {done && (r.ok ? <span className="mk-tick"><Icon name="check" size={12} /></span> : <span className="mk-rule">To rule</span>)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mk-key-foot"><span>{still ? 4 : Math.min(judged, 4)} of 4 keyed</span><span className="kbd">Enter</span></div>
    </div>
  );
}

/** Every so often, ⌘K opens and finds a student. */
function Palette({ playing }: { playing: boolean }) {
  const [phase, setPhase] = useState<'off' | 'open' | 'closing'>('off');
  const [typed, setTyped] = useState(0);
  const [at, setAt] = useState(0);
  const query = 'car';

  useEffect(() => {
    if (!playing) {
      setPhase('off');
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    if (phase === 'off') t = setTimeout(() => { setTyped(0); setAt(0); setPhase('open'); }, 7000);
    else if (phase === 'open' && typed < query.length) t = setTimeout(() => setTyped((n) => n + 1), 260);
    else if (phase === 'open' && at === 0) t = setTimeout(() => setAt(1), 900);
    else if (phase === 'open') t = setTimeout(() => setPhase('closing'), 1100);
    else t = setTimeout(() => setPhase('off'), 260);
    return () => clearTimeout(t);
  }, [playing, phase, typed, at]);

  if (phase === 'off') return null;
  const q = query.slice(0, typed);
  const items = PALETTE.filter((p) => !q || p.label.toLowerCase().includes(q) || p.kind === 'Teams');
  return (
    <div className={`mk-scrim ${phase}`}>
      <div className="mk-cmdk">
        <div className="mk-cmdk-in"><Icon name="search" size={16} /><span>{q || <span className="mk-ph">Search people, teams and pages</span>}<i className="mk-caret" /></span><span className="kbd">esc</span></div>
        <div className="mk-cmdk-list">
          {items.map((p, i) => (
            <div key={p.label}>
              {(i === 0 || items[i - 1].kind !== p.kind) && <div className="mk-cmdk-group">{p.kind}</div>}
              <div className={`mk-cmdk-item ${i === Math.min(at, items.length - 1) ? 'on' : ''}`}>
                <Icon name={p.icon} size={15} />
                <span className="mono mk-code">{p.code}</span>
                {p.label}
                <small>{p.hint}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
