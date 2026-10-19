import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import type { Contest } from '../lib/model';
import { buildBoard, gutsRound, type Board, type BoardRow } from '../lib/scoring/board';
import { useUser } from '../lib/session';
import { useDB, useVersion } from '../lib/store';
import { clockIn, duration, roundState } from '../lib/time';
import { useBumps } from '../components/Scoreboard';
import { Logo } from '../components/art';
import { Roll, useNow } from '../components/ui';
import '../styles/dayof.css';

type Mode = string; // a division id, or 'all' for both side by side

/**
 * The Guts board for a projector. Big enough to read from the back of a
 * room; rows glide to their new places as scores change. Also what the
 * online division sees if a proctor shares their screen on Zoom.
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
      <section className="card">
        <Logo size={32} />
        <h1>{hasContest ? 'This contest has no Guts round' : 'No live board here yet'}</h1>
        <p className="soft">
          {hasContest
            ? 'The live board follows the Guts round. Add one under Rounds, and it shows here while the round runs.'
            : 'The live board opens from an organiser’s account: Live, then Show on projector.'}
        </p>
        <div className="row wrap">
          {user ? (
            <button className="btn btn-primary" type="button" onClick={() => navigate(hasContest ? '/staff/rounds' : '/')}>{hasContest ? 'Go to Rounds' : 'Your home'}</button>
          ) : (
            <Link className="btn btn-primary" to="/sign-in">Sign in</Link>
          )}
          <button className="btn" type="button" onClick={() => navigate(-1)}>Back</button>
        </div>
      </section>
    </div>
  );
}

function LiveBoard({ contest }: { contest: Contest }) {
  const db = useDB();
  const v = useVersion();
  const navigate = useNavigate();
  const now = useNow(500);
  const [mode, setMode] = useState<Mode>(contest.divisions[0].id);
  const [dark, setDark] = useState(false);
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

  // Controls fade away while presenting and the mouse is still.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 2600);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const status =
    state === 'scheduled'
      ? `Starts at ${clockIn(round.startsAt, contest.timeZone)}`
      : state === 'open'
        ? frozen
          ? `Frozen with ${contest.board.freezeMinutes}:00 left. Final standings at the awards.`
          : contest.board.freezeMinutes
            ? `Freezes with ${contest.board.freezeMinutes}:00 left`
            : 'Live'
        : contest.board.revealed
          ? 'Final standings'
          : 'Round over. Final standings at the awards.';

  return (
    <div className={`board ${dark ? 'dark' : ''}`} style={{ cursor: idle && full ? 'none' : undefined }}>
      <header className="board-head">
        <div>
          <div className="board-title">Guts</div>
          <div className="board-sub">{contest.short} · {mode === 'all' ? 'Both divisions' : contest.divisions.find((d) => d.id === mode)?.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`board-clock ${left !== null && left < 5 * 60000 && state === 'open' ? 'low' : ''}`}>
            {state === 'open' && left !== null ? duration(left) : state === 'scheduled' ? clockIn(round.startsAt, contest.timeZone).replace(' PT', '') : '0:00'}
          </div>
          <div className="board-freeze">{status}</div>
        </div>
      </header>
      <div className="board-bar"><i style={{ width: state === 'open' && left !== null ? `${Math.max(0, Math.min(100, 100 - (left / (round.minutes * 60000)) * 100))}%` : state === 'closed' ? '100%' : '0%' }} /></div>

      <div className="board-cols" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map(({ d, board }) => (
          <div key={d.id} className="board-col">
            {mode === 'all' && <h2>{d.name}</h2>}
            <Rows board={board} split={mode !== 'all' && board.rows.length > 12} slots={mode === 'all' ? Math.max(...shown.map((s) => s.board.rows.length)) : 0} />
          </div>
        ))}
      </div>

      <footer className="board-foot" style={{ opacity: idle && full ? 0 : 1, transition: 'opacity .4s' }}>
        <span>{frozen ? 'Frozen' : state === 'open' ? 'Live. Sets appear as they are handed in or keyed.' : ''}</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {[...contest.divisions.map((d) => ({ key: d.id, label: d.name })), { key: 'all', label: 'Both' }].map((m) => (
            <button key={m.key} type="button" className="btn btn-sm" style={mode === m.key ? { color: 'var(--b-ink)', borderColor: 'var(--b-ink-2)' } : undefined} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setDark((x) => !x)}>{dark ? 'Light' : 'Dark'}</button>
          <button type="button" className="btn btn-sm" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>{full ? 'Exit full screen' : 'Full screen'}</button>
          <button type="button" className="btn btn-sm" onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); navigate(-1); }}>Close</button>
        </div>
      </footer>
    </div>
  );
}

/** Rows positioned by rank, so a change of rank is a glide rather than a jump. */
function Rows({ board, split, slots }: { board: Board; split: boolean; slots: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const bumped = useBumps(board.rows);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 70) });
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
  const gap = 28;
  const colW = (box.w - gap * (cols - 1)) / cols;
  const rowH = Math.max(40, Math.min(76, box.h / Math.max(perCol, 1)));
  return (
    <div ref={ref} className="board-list" style={{ height: perCol * rowH }}>
      {board.rows.map((r: BoardRow, i) => {
        const col = Math.floor(i / perCol);
        const y = (i % perCol) * rowH;
        return (
          <div
            key={r.team.id}
            className={`b-row ${i < 3 && r.place ? 'lead' : ''} ${bumped.has(r.team.id) ? 'flash' : ''}`}
            style={{ width: colW, height: rowH - 6, transform: `translate(${col * (colW + gap)}px, ${y}px)` }}
          >
            <span className="b-place">{r.place ?? '–'}</span>
            <span className="b-name">{r.team.name}<small>{r.team.code}</small></span>
            <span className="b-track" aria-label={`${r.sets} of ${board.totalSets} sets`}>
              {Array.from({ length: board.totalSets }, (_, k) => <i key={k} className={k < r.sets ? 'done' : r.current === k + 1 ? 'now' : ''} />)}
            </span>
            <span className="b-score"><Roll value={r.score} /></span>
          </div>
        );
      })}
    </div>
  );
}
