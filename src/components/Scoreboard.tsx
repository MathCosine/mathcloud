import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Board, BoardRow } from '../lib/scoring/board';
import { Roll, Track } from './ui';

type Changes = { delta: Map<string, number>; up: Set<string> };
const NONE: Changes = { delta: new Map(), up: new Set() };

/**
 * What just changed on a board: whose score went up (and by how much), and who
 * climbed. Held for `ms`, long enough for the eye to find it, then let go.
 */
export function useChanges(rows: BoardRow[], ms = 2600): Changes {
  const prev = useRef<Map<string, { score: number; i: number }> | null>(null);
  const [changes, setChanges] = useState<Changes>(NONE);
  const sig = rows.map((r) => `${r.team.id}:${r.score}`).join(',');
  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(rows.map((r, i) => [r.team.id, { score: r.score, i }]));
    if (!before) return;
    const delta = new Map<string, number>();
    const up = new Set<string>();
    rows.forEach((r, i) => {
      const b = before.get(r.team.id);
      if (!b) return;
      if (r.score > b.score) delta.set(r.team.id, r.score - b.score);
      if (i < b.i && r.score > b.score) up.add(r.team.id);
    });
    if (delta.size || up.size) setChanges({ delta, up });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => {
    if (changes === NONE) return;
    const t = setTimeout(() => setChanges(NONE), ms);
    return () => clearTimeout(t);
  }, [changes, ms]);
  return changes;
}

/** Remember which teams' scores went up since the last render, for a brief highlight. */
export function useBumps(rows: BoardRow[]) {
  return new Set(useChanges(rows, 1400).delta.keys());
}

/**
 * Rows that change order slide to their new place instead of jumping (FLIP:
 * note where each row was, let it move, then play the difference back).
 */
function useGlide(order: string) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-k]').forEach((row) => {
      const k = row.dataset.k!;
      const top = row.offsetTop;
      next.set(k, top);
      const was = last.current.get(k);
      if (still || was === undefined || was === top) return;
      row.style.transition = 'none';
      row.style.transform = `translateY(${was - top}px)`;
      void row.offsetHeight;
      row.style.transition = '';
      row.style.transform = '';
    });
    last.current = next;
  }, [order]);
  return box;
}

/** The compact live Guts standings used beside the test and on the Live page. */
export function ScoreList({ board, mine, limit = 10 }: { board: Board; mine?: string; limit?: number }) {
  const { delta, up } = useChanges(board.rows, 2200);
  const top = board.rows.slice(0, limit);
  const mineRow = mine ? board.rows.find((r) => r.team.id === mine) : undefined;
  const extra = mineRow && !top.includes(mineRow) ? mineRow : null;
  const box = useGlide([...top, ...(extra ? [extra] : [])].map((r) => r.team.id).join(','));
  const row = (r: BoardRow) => {
    const d = delta.get(r.team.id);
    return (
      <div key={r.team.id} data-k={r.team.id} className={`sb-row ${r.team.id === mine ? 'mine' : ''} ${d ? 'bump' : ''} ${up.has(r.team.id) ? 'up' : ''} ${r.place && r.place <= 3 ? 'lead' : ''}`}>
        <span className="sb-place">{r.place ?? '–'}</span>
        <span className="sb-name">{r.team.name}{d ? <span className="sb-delta" key={`${r.team.id}-${r.score}`}>+{d}</span> : null}</span>
        <Track done={r.sets} total={board.totalSets} current={r.current} />
        <span className="sb-score">
          <Roll value={r.score} />
        </span>
      </div>
    );
  };
  return (
    <div className="sb" ref={box}>
      {top.length === 0 && <div className="sb-none">No teams in this division yet.</div>}
      {top.map(row)}
      {extra && (
        <>
          <div className="sb-gap" aria-hidden="true">⋯</div>
          {row(extra)}
        </>
      )}
      {board.rows.length > limit && !extra && <div className="sb-more">and {board.rows.length - limit} more {board.rows.length - limit === 1 ? 'team' : 'teams'}</div>}
    </div>
  );
}
