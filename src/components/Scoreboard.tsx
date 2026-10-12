import { useEffect, useRef, useState } from 'react';
import type { Board, BoardRow } from '../lib/scoring/board';
import { Roll, Track } from './ui';

/** Remember which teams' scores went up since the last render, for a brief highlight. */
export function useBumps(rows: BoardRow[]) {
  const prev = useRef<Map<string, number>>(new Map());
  const [bumped, setBumped] = useState<Set<string>>(new Set());
  const sig = rows.map((r) => `${r.team.id}:${r.score}`).join(',');
  useEffect(() => {
    const up = new Set<string>();
    for (const r of rows) {
      const before = prev.current.get(r.team.id);
      if (before !== undefined && r.score > before) up.add(r.team.id);
    }
    prev.current = new Map(rows.map((r) => [r.team.id, r.score]));
    if (!up.size) return;
    setBumped(up);
    const t = setTimeout(() => setBumped(new Set()), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return bumped;
}

/** The compact live Guts standings used beside the test and on the Live page. */
export function ScoreList({ board, mine, limit = 10 }: { board: Board; mine?: string; limit?: number }) {
  const bumped = useBumps(board.rows);
  const top = board.rows.slice(0, limit);
  const mineRow = mine ? board.rows.find((r) => r.team.id === mine) : undefined;
  const extra = mineRow && !top.includes(mineRow) ? mineRow : null;
  const row = (r: BoardRow) => (
    <div key={r.team.id} className={`sb-row ${r.team.id === mine ? 'mine' : ''} ${bumped.has(r.team.id) ? 'bump' : ''}`}>
      <span className="sb-place">{r.place ?? '–'}</span>
      <span className="sb-name">{r.team.name}</span>
      <Track done={r.sets} total={board.totalSets} current={r.current} />
      <span className="sb-score"><Roll value={r.score} /></span>
    </div>
  );
  return (
    <div>
      {top.map(row)}
      {extra && (
        <>
          <div className="muted tiny" style={{ padding: '2px 8px' }}>⋯</div>
          {row(extra)}
        </>
      )}
      {board.rows.length > limit && !extra && <div className="muted tiny" style={{ padding: '6px 8px' }}>and {board.rows.length - limit} more teams</div>}
    </div>
  );
}
