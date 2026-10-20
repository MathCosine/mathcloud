import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { client } from '../lib/remote/client';
import type { Round, Team } from '../lib/model';
import { buildBoard, gutsRound, rank, type Board, type BoardRow } from '../lib/scoring/board';
import { REMOTE, useAllDB } from '../lib/store';
import { duration } from '../lib/time';
import { Logo } from '../components/art';
import { Icon } from '../components/icons';
import { ScoreList } from '../components/Scoreboard';
import { useNow } from '../components/ui';
import '../styles/public.css';

type PublicRow = { round_name: string; opened_at: string; ends_at: string; frozen: boolean; code: string; name: string; score: number | string; sets: number; set_count: number };

/**
 * The live Guts leaderboard for anyone: parents at home, teams on their
 * phones. Team names and scores only, frozen like the projector board.
 * Every other result stays private. Connected, it asks the database every
 * 15 seconds while the page is open and visible; nothing else.
 */
export function PublicBoard() {
  const { slug = '' } = useParams();
  const now = useNow(1000);
  const all = useAllDB();
  const local = !REMOTE ? all.contests.find((c) => c.slug === slug) : undefined;
  const [rows, setRows] = useState<PublicRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!REMOTE) return;
    let alive = true;
    const load = async (force = false) => {
      if (!force && (document.visibilityState !== 'visible' || Date.now() - last.current < 14500)) return;
      last.current = Date.now();
      const { data, error: e } = await client().rpc('public_guts_board', { p_slug: slug });
      if (!alive) return;
      if (e) setError(e.message);
      else setRows((data as PublicRow[] | null) ?? []);
    };
    void load(true);
    const timer = setInterval(() => void load(), 15000);
    const onVisible = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug]);

  const board: Board | null = useMemo(() => {
    if (!REMOTE) {
      if (!local || local.details?.publicBoard === false) return null;
      const round = gutsRound(local);
      if (!round?.openedAt) return null;
      return buildBoard({ contest: local, teams: all.teams.filter((t) => t.contestId === local.id), attempts: all.attempts, rulings: all.rulings, divisionId: 'all', now });
    }
    if (!rows?.length) return null;
    const first = rows[0];
    const round = { id: 'guts', name: first.round_name, short: first.round_name, kind: 'guts', minutes: 0, startsAt: first.opened_at, status: 'open', openedAt: first.opened_at, graceSeconds: 0, integrity: { policy: 'log', lockAfter: 0 }, problems: [], rules: '' } as Round;
    const totalSets = Math.max(1, first.set_count || 6);
    const list: BoardRow[] = rows.map((r) => {
      const team = { id: r.code, code: r.code, name: r.name } as Team;
      return { team, score: Number(r.score), sets: r.sets, current: r.sets > 0 && r.sets < totalSets ? r.sets + 1 : null, started: r.sets > 0, place: null, tied: false, lastSetAt: null };
    });
    const endsAt = new Date(first.ends_at).getTime();
    return { round, rows: rank(list), totalSets, frozen: rows.some((r) => r.frozen), freezeAt: null, endsAt };
    // `now` only matters for the sandbox copy, which recomputes as answers arrive.
  }, [rows, local, all, now]);

  const title = REMOTE ? board?.round.name : local?.short;
  const left = board?.endsAt ? board.endsAt - now : null;

  return (
    <div className="pb">
      <header className="pb-top">
        <Link to={`/c/${slug}`} className="brand"><Logo size={22} /><span>MathCloud</span></Link>
        <span className="grow" />
        <Link className="btn btn-sm" to={`/c/${slug}`}><Icon name="calendar" size={14} />Event page</Link>
      </header>
      <main className="pb-main">
        <div className="pb-head">
          <div>
            <span className="kicker"><span className="dot-live" style={{ display: 'inline-block' }} />Live Guts leaderboard</span>
            <h1 className="page-title">{title ?? 'Guts'}</h1>
          </div>
          {left !== null && left > 0 && <div className="pb-clock"><small>Time left</small><b className="mono">{duration(left)}</b></div>}
          {left !== null && left <= 0 && <div className="pb-clock"><small>Guts is over</small><b>Final scores at the awards</b></div>}
        </div>
        {board?.frozen && (
          <div className="note amber pb-frozen"><Icon name="lock" size={15} />The board is frozen for the last minutes. The final order is revealed at the awards.</div>
        )}
        {error ? (
          <section className="card"><p className="soft" style={{ margin: 0 }}>The leaderboard could not be loaded. It refreshes by itself; try again in a moment.</p></section>
        ) : !board ? (
          <section className="card pb-empty">
            <Icon name="board" size={28} />
            <b>The leaderboard appears when Guts starts</b>
            <p className="soft">Keep this page open: it updates by itself every few seconds once the round begins.</p>
          </section>
        ) : (
          <section className="card pb-board">
            <ScoreList board={board} limit={100} />
          </section>
        )}
        <p className="muted small pb-note">Team names and Guts scores only. Every other result is private to each student and team.</p>
      </main>
    </div>
  );
}
