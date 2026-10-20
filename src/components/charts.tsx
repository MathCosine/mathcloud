import { useEffect, useState } from 'react';

/**
 * Small charts drawn as SVG: each answers one question an organiser asks
 * ("how many waivers are in?", "how did the field do?", "which problem was
 * hard?"), with the number written beside it so nobody has to read a bar.
 * Ink and greys, with colour only where it means something (done, waiting,
 * the one score that is yours). Each one draws itself in when it arrives;
 * the global reduced-motion rule makes that instant.
 */

/** True one frame after mount, so a CSS transition can run from the empty state. */
function useArrived() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

/**
 * A progress ring: part of a whole. Big rings carry the percentage in the
 * middle; small ones (under 64px, beside a number that already says it) show
 * only a tick when complete, so the text never spills over the stroke.
 */
export function Ring({ value, total, size = 64, tone = 'green', label }: { value: number; total: number; size?: number; tone?: 'green' | 'blue' | 'amber' | 'ink'; label?: string }) {
  const on = useArrived();
  const stroke = Math.max(4, Math.round(size / 11));
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const share = total ? Math.min(1, value / total) : 0;
  const pct = total ? Math.round(share * 100) : 0;
  const mid = size / 2;
  // "100%" is about 2.5 em wide; keep it inside the hole with some air.
  const font = Math.min(size / 4.4, ((r - stroke / 2) * 2 * 0.78) / 2.5);
  const t = size * 0.16;
  const colour = `var(--${tone})`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value} of ${total}`} className="ring">
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={stroke} />
      <circle
        cx={mid} cy={mid} r={r} fill="none" stroke={colour} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(on ? share : 0) * c} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} style={{ transition: 'stroke-dasharray .9s var(--out)' }}
      />
      {size >= 64 ? (
        <text x="50%" y="50%" dy=".35em" textAnchor="middle" fontSize={font} fontWeight="600" letterSpacing="-.03em" fill="var(--ink)" fontFamily="var(--sans)">{pct}%</text>
      ) : share >= 1 ? (
        <path
          d={`M${mid - t} ${mid + t * 0.05} L${mid - t * 0.3} ${mid + t * 0.7} L${mid + t} ${mid - t * 0.65}`} fill="none" stroke={colour} strokeWidth={Math.max(2, stroke * 0.55)}
          strokeLinecap="round" strokeLinejoin="round" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: on ? 0 : 1, transition: 'stroke-dashoffset .35s var(--out) .55s' }}
        />
      ) : null}
    </svg>
  );
}

/** Score distribution, one bar per score, with one score marked (a student's own). */
export function Histogram({ scores, max, mark, height = 120, label }: { scores: number[]; max: number; mark?: number; height?: number; label?: string }) {
  const on = useArrived();
  const bins = Array.from({ length: max + 1 }, (_, s) => scores.filter((x) => Math.round(x) === s).length);
  const top = Math.max(1, ...bins);
  const w = 100 / bins.length;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" role="img" aria-label={label ?? 'Score distribution'} style={{ height, width: '100%' }}>
        {bins.map((n, s) => {
          const h = (n / top) * (height / 3 - 2);
          return (
            <rect
              key={s} x={s * w + w * 0.12} y={height / 3 - h} width={w * 0.76} height={h} rx={0.6} fill={mark === s ? 'var(--blue)' : 'var(--bg-3)'}
              style={{ transformBox: 'fill-box', transformOrigin: 'bottom', transform: on ? 'none' : 'scaleY(0)', transition: `transform .6s var(--out) ${Math.min(s * 12, 300)}ms` }}
            />
          );
        })}
      </svg>
      <figcaption className="chart-axis"><span>0</span><span>{Math.round(max / 2)}</span><span>{max}</span></figcaption>
    </figure>
  );
}

/** Solve rate for each problem: the shape of a round's difficulty. Styled inline, so it needs no stylesheet. */
export function SolveBars({ rates, highlight }: { rates: { number: number; rate: number; label?: string }[]; highlight?: Set<number> }) {
  const on = useArrived();
  return (
    <div className="solve-bars" role="img" aria-label="Solve rate by problem" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
      {rates.map((r, i) => (
        <div key={r.number} className={`sb ${highlight?.has(r.number) ? 'on' : ''}`} title={`${r.label ?? `Problem ${r.number}`}: ${Math.round(r.rate * 100)}% solved`}
          style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span className="bar" style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', borderRadius: 4, background: 'var(--bg-2)', overflow: 'hidden' }}>
            <i style={{
              display: 'block', width: '100%', height: `${Math.max(3, r.rate * 100)}%`, borderRadius: 4, background: highlight?.has(r.number) ? 'var(--ink)' : 'var(--line-2)',
              transformOrigin: 'bottom', transform: on ? 'none' : 'scaleY(0)', transition: `transform .6s var(--out) ${Math.min(i * 15, 300)}ms`,
            }} />
          </span>
          <span className="n" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.label ?? r.number}</span>
        </div>
      ))}
    </div>
  );
}

/** Registrations over time: an ink line that draws itself in and ends today. */
export function Spark({ dates, width = 160, height = 36 }: { dates: string[]; width?: number; height?: number }) {
  const on = useArrived();
  if (dates.length < 2) return null;
  const ts = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const t0 = ts[0];
  const t1 = Math.max(ts[ts.length - 1], t0 + 1);
  const pts = ts.map((t, i) => [((t - t0) / (t1 - t0)) * (width - 8) + 3, height - 3 - ((i + 1) / ts.length) * (height - 8)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${dates.length} sign-ups over time`} className="spark">
      <path d={`${d} L${ex} ${height - 1} L${pts[0][0]} ${height - 1} Z`} fill="var(--bg-3)" style={{ opacity: on ? 0.7 : 0, transition: 'opacity .6s var(--ease) .3s' }} />
      <path d={d} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: on ? 0 : 1, transition: 'stroke-dashoffset 1s var(--out)' }} />
      <circle cx={ex} cy={ey} r="5" fill="var(--ink)" opacity=".1" style={{ opacity: on ? 0.1 : 0, transition: 'opacity .3s .8s' }} />
      <circle cx={ex} cy={ey} r="2.5" fill="var(--ink)" style={{ opacity: on ? 1 : 0, transition: 'opacity .3s .8s' }} />
    </svg>
  );
}
