import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, Moon, Sun } from 'lucide-react';
import { contestOf } from '../lib/actions';
import type { Contest } from '../lib/model';
import { buildBoard, gutsRound, type Board, type BoardRow } from '../lib/scoring/board';
import { useUser } from '../lib/session';
import { useDB, useVersion } from '../lib/store';
import { clockIn, duration, roundState } from '../lib/time';
import { useChanges } from '../components/Scoreboard';
import { Icon } from '../components/icons';
import { EmptyState, MODE_ICON, Roll, useNow } from '../components/ui';
import '../styles/live.css';

type Mode = string; // a division id, or 'all' for both side by side
const THEME_KEY = 'mathcloud-board-theme';

/**
 * The Guts board for a projector. Big enough to read from the back of a
 * room; rows glide to their new places as scores change, and a score that
 * goes up glows for a moment. Also what the online division sees if a
 * proctor shares their screen on Zoom.
 */
export function BoardPage() {
  const db = useDB();
  const contest = contestOf(db) as Contest | undefined;
  if (!contest || !gutsRound(contest) || !contest.divisions.length) return <NoBoard hasContest={!!contest} />;
  return <LiveBoard contest={contest} />;
}

/** Signed out, or a contest with no Guts round: say where the board comes from. */
function NoBoard({ hasContest }: { hasContest: boolean }) {
  const user = useUser();
  const navigate = useNavigate();
  return (
    <div className="board-none">
      <EmptyState
        className="card"
        icon="board"
        title={hasContest ? 'This contest has no Guts round' : 'No live board here yet'}
        action={
          <>
            {user ? (
              <button className="btn btn-primary" type="button" onClick={() => navigate(hasContest ? '/staff/rounds' : '/')}>{hasContest ? 'Go to Rounds' : 'Your home'}</button>
            ) : (
              <Link className="btn btn-primary" to="/sign-in">Sign in</Link>
            )}
            <button className="btn btn-quiet" type="button" onClick={() => navigate(-1)}><Icon name="back" />Back</button>
          </>
        }
      >
        {hasContest
          ? 'The live board follows the Guts round. Add one under Rounds, and it shows here while the round runs.'
          : 'The live board opens from an organiser’s account: Live, then Show on projector.'}
      </EmptyState>
    </div>
  );
}

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) !== 'light';
  } catch {
    return true;
  }
}

function LiveBoard({ contest }: { contest: Contest }) {
  const db = useDB();
  const v = useVersion();
  const navigate = useNavigate();
  const now = useNow(500);
  const [mode, setMode] = useState<Mode>(contest.divisions[0].id);
  const [dark, setDark] = useState(readTheme);
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(false);
  const second = Math.floor(now / 1000);
  const boards = useMemo(
    () => contest.divisions.map((d) => ({ d, board: buildBoard({ contest, teams: db.teams, attempts: db.attempts, rulings: db.rulings, divisionId: d.id, now })! })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, second],
  );
  const round = boards[0].board.round;
  const state = roundState(round, now);
  const ends = boards[0].board.endsAt;
  const frozen = boards[0].board.frozen;
  const left = ends ? ends - now : null;
  const shown = mode === 'all' ? boards : boards.filter((b) => b.d.id === mode);
  const modes = [...contest.divisions.map((d) => ({ key: d.id, label: d.name })), ...(contest.divisions.length > 1 ? [{ key: 'all', label: 'Both' }] : [])];

  const toggleTheme = useCallback(() => setDark((x) => {
    try {
      localStorage.setItem(THEME_KEY, x ? 'light' : 'dark');
    } catch {
      /* a convenience only */
    }
    return !x;
  }), []);
  const toggleFull = useCallback(() => {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  }, []);
  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.history.length > 1) navigate(-1);
    else navigate('/staff/live');
  };

  // The page around the board takes its colour, so nothing light shows at the edges.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const before = els.map((e) => [e.style.backgroundColor, e.style.colorScheme] as const);
    els.forEach((e) => {
      e.style.backgroundColor = dark ? '#09090B' : '#FFFFFF';
      e.style.colorScheme = dark ? 'dark' : 'light';
    });
    return () => els.forEach((e, i) => {
      e.style.backgroundColor = before[i][0];
      e.style.colorScheme = before[i][1];
    });
  }, [dark]);

  // Controls fade away while presenting and the mouse is still. Keys still work.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 2600);
    };
    const onKey = (e: KeyboardEvent) => {
      wake();
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'f') toggleFull();
      else if (k === 't') toggleTheme();
      else if (/^[1-9]$/.test(k) && modes[Number(k) - 1]) setMode(modes[Number(k) - 1].key);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', onKey);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleFull, toggleTheme, modes.length]);

  const low = state === 'open' && left !== null && left < 5 * 60000;
  const clockText = state === 'open' && left !== null ? duration(left) : state === 'scheduled' ? clockIn(round.startsAt, contest.timeZone).replace(' PT', '') : '0:00';
  const status: { icon: ReactNode; text: string } =
    state === 'scheduled'
      ? { icon: <Icon name="clock" />, text: `Starts at ${clockIn(round.startsAt, contest.timeZone)}` }
      : state === 'open'
        ? frozen
          ? { icon: <Icon name="lock" />, text: `Frozen with ${contest.board.freezeMinutes}:00 left · final standings at the awards` }
          : contest.board.freezeMinutes
            ? { icon: <Icon name="timer" />, text: `Freezes with ${contest.board.freezeMinutes}:00 left` }
            : { icon: <i className="board-dot" />, text: 'Live' }
        : contest.board.revealed
          ? { icon: <Icon name="check" />, text: 'Final standings' }
          : { icon: <Icon name="lock" />, text: 'Round over · final standings at the awards' };
  const pct = state === 'open' && left !== null ? Math.max(0, Math.min(100, 100 - (left / (round.minutes * 60000)) * 100)) : state === 'closed' ? 100 : 0;
  const division = mode === 'all' ? null : contest.divisions.find((d) => d.id === mode);

  return (
    <div className={`board ${dark ? '' : 'light'} ${idle ? 'idle' : ''}`} data-state={state} style={{ cursor: idle && full ? 'none' : undefined }}>
      <header className="board-head">
        <div className="board-id">
          <div className="board-kicker">
            <span className={`board-live ${state}`} aria-hidden="true" />
            {contest.short}
          </div>
          <h1 className="board-title">{round.name}</h1>
          <div className="board-sub">
            {division ? <><Icon name={MODE_ICON[division.mode]} />{division.name}</> : <><Icon name="both" />Both divisions</>}
          </div>
        </div>
        <div className="board-time">
          <div className={`board-clock ${low ? 'low' : ''} ${state === 'open' ? 'ticking' : ''}`} aria-label={clockText}>
            {clockText.split(':').map((part, i) => (
              <span key={i}>{i > 0 && <span className="colon">:</span>}{part}</span>
            ))}
          </div>
          <div className={`board-status ${frozen ? 'frozen' : ''}`}>{status.icon}<span>{status.text}</span></div>
        </div>
      </header>
      <div className="board-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>

      <main className="board-cols" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map(({ d, board }) => (
          <section key={d.id} className="board-col" aria-label={`${d.name} standings`}>
            {mode === 'all' && <h2><Icon name={MODE_ICON[d.mode]} />{d.name}<span>{board.rows.length} teams</span></h2>}
            {board.rows.length ? (
              <Rows board={board} split={mode !== 'all' && board.rows.length > 12} slots={mode === 'all' ? Math.max(...shown.map((s) => s.board.rows.length)) : 0} />
            ) : (
              <p className="board-empty">No teams in this division yet.</p>
            )}
          </section>
        ))}
      </main>

      <footer className="board-foot">
        <span className="board-note">{frozen ? 'Scores after the freeze stay hidden until the awards.' : state === 'open' ? 'Sets appear as they are handed in or keyed.' : ''}</span>
        <div className="board-ctl" role="toolbar" aria-label="Board controls">
          {modes.length > 1 && (
            <div className="board-seg" role="group" aria-label="Division">
              {modes.map((m, i) => (
                <button key={m.key} type="button" aria-pressed={mode === m.key} title={`${m.label} (${i + 1})`} onClick={() => setMode(m.key)}>{m.label}</button>
              ))}
            </div>
          )}
          <button type="button" className="board-ic" onClick={toggleTheme} aria-label={dark ? 'Light board' : 'Dark board'} title={`${dark ? 'Light' : 'Dark'} (T)`}>
            {dark ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          </button>
          <button type="button" className="board-ic" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={`${full ? 'Exit full screen' : 'Full screen'} (F)`}>
            {full ? <Minimize2 size={17} strokeWidth={1.75} /> : <Maximize2 size={17} strokeWidth={1.75} />}
          </button>
          <button type="button" className="board-ic" onClick={close} aria-label="Close the board" title="Close">
            <Icon name="close" size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Rows positioned by rank, so a change of rank is a glide rather than a jump. */
function Rows({ board, split, slots }: { board: Board; split: boolean; slots: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const { delta, up } = useChanges(board.rows);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const foot = document.querySelector('.board-foot')?.getBoundingClientRect().height ?? 48;
      setBox({ w: el.clientWidth, h: Math.max(300, window.innerHeight - el.getBoundingClientRect().top - foot - 28) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const cols = split ? 2 : 1;
  // Side by side, both columns share one row height so they line up.
  const perCol = Math.max(Math.ceil(board.rows.length / cols), slots);
  const gap = Math.max(24, box.w * 0.04);
  const colW = (box.w - gap * (cols - 1)) / cols;
  const rowH = Math.max(38, Math.min(88, box.h / Math.max(perCol, 1)));
  const font = Math.round(Math.max(14, Math.min(rowH * 0.42, 36, colW / 17)));
  const lead = board.rows[0]?.score ?? 0;
  return (
    <div ref={ref} className="board-list" style={{ height: perCol * rowH, fontSize: font }}>
      {board.rows.map((r: BoardRow, i) => {
        const col = Math.floor(i / perCol);
        const y = (i % perCol) * rowH;
        const d = delta.get(r.team.id);
        return (
          <div
            key={r.team.id}
            className={`b-row ${r.place && r.place <= 3 && r.score > 0 ? 'lead' : ''} ${d ? 'flash' : ''} ${up.has(r.team.id) ? 'up' : ''} ${!r.started ? 'idle' : ''}`}
            style={{ width: colW, height: rowH, transform: `translate3d(${col * (colW + gap)}px, ${y}px, 0)` }}
          >
            <span className="b-place">{r.place && r.score > 0 ? r.place : '–'}</span>
            <span className="b-name">{r.team.name}<small>{r.team.code}</small>{d ? <span className="b-delta" key={`${r.team.id}:${r.score}`}>+{d}</span> : null}</span>
            <span className="b-track" aria-label={`${r.sets} of ${board.totalSets} sets`}>
              {Array.from({ length: board.totalSets }, (_, k) => <i key={k} className={k < r.sets ? 'done' : r.current === k + 1 ? 'now' : ''} />)}
            </span>
            <span className="b-score">
              <Roll value={r.score} />
            </span>
            <i className="b-bar" style={{ transform: `scaleX(${lead ? r.score / lead : 0})` }} aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
