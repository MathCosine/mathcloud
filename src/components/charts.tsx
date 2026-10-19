/**
 * Small charts drawn as SVG: each answers one question an organiser asks
 * ("how many waivers are in?", "how did the field do?", "which problem was
 * hard?"), with the number written beside it so nobody has to read a bar.
 */

/**
 * A progress ring: part of a whole. Big rings carry the percentage in the
 * middle; small ones (under 64px, beside a number that already says it) show
 * only a tick when complete, so the text never spills over the stroke.
 */
export function Ring({ value, total, size = 64, tone = 'green', label }: { value: number; total: number; size?: number; tone?: 'green' | 'blue' | 'amber'; label?: string }) {
  const stroke = Math.max(4, Math.round(size / 11));
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const share = total ? Math.min(1, value / total) : 0;
  const pct = total ? Math.round(share * 100) : 0;
  const mid = size / 2;
  // "100%" is about 2.5 em wide; keep it inside the hole with some air.
  const font = Math.min(size / 4.4, ((r - stroke / 2) * 2 * 0.78) / 2.5);
  const t = size * 0.16;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value} of ${total}`} className="ring">
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={stroke} />
      <circle
        cx={mid} cy={mid} r={r} fill="none" stroke={`var(--${tone})`} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${share * c} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} style={{ transition: 'stroke-dasharray .6s var(--ease)' }}
      />
      {size >= 64 ? (
        <text x="50%" y="50%" dy=".35em" textAnchor="middle" fontSize={font} fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">{pct}%</text>
      ) : share >= 1 ? (
        <path d={`M${mid - t} ${mid + t * 0.05} L${mid - t * 0.3} ${mid + t * 0.7} L${mid + t} ${mid - t * 0.65}`} fill="none" stroke={`var(--${tone})`} strokeWidth={Math.max(2, stroke * 0.55)} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** Score distribution, one bar per score, with one score marked (a student's own). */
export function Histogram({ scores, max, mark, height = 120, label }: { scores: number[]; max: number; mark?: number; height?: number; label?: string }) {
  const bins = Array.from({ length: max + 1 }, (_, s) => scores.filter((x) => Math.round(x) === s).length);
  const top = Math.max(1, ...bins);
  const w = 100 / bins.length;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" role="img" aria-label={label ?? 'Score distribution'} style={{ height, width: '100%' }}>
        {bins.map((n, s) => {
          const h = (n / top) * (height / 3 - 2);
          return <rect key={s} x={s * w + w * 0.12} y={height / 3 - h} width={w * 0.76} height={h} rx={0.6} fill={mark === s ? 'var(--blue)' : 'var(--bg-3)'} />;
        })}
      </svg>
      <figcaption className="chart-axis"><span>0</span><span>{Math.round(max / 2)}</span><span>{max}</span></figcaption>
    </figure>
  );
}

/** Solve rate for each problem: the shape of a round's difficulty. */
export function SolveBars({ rates, highlight }: { rates: { number: number; rate: number; label?: string }[]; highlight?: Set<number> }) {
  return (
    <div className="solve-bars" role="img" aria-label="Solve rate by problem">
      {rates.map((r) => (
        <div key={r.number} className={`sb ${highlight?.has(r.number) ? 'on' : ''}`} title={`${r.label ?? `Problem ${r.number}`}: ${Math.round(r.rate * 100)}% solved`}>
          <span className="bar"><i style={{ height: `${Math.max(3, r.rate * 100)}%` }} /></span>
          <span className="n">{r.label ?? r.number}</span>
        </div>
      ))}
    </div>
  );
}

/** Registrations over time: a line that ends today. */
export function Spark({ dates, width = 160, height = 36 }: { dates: string[]; width?: number; height?: number }) {
  if (dates.length < 2) return null;
  const ts = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const t0 = ts[0];
  const t1 = Math.max(ts[ts.length - 1], t0 + 1);
  const pts = ts.map((t, i) => [((t - t0) / (t1 - t0)) * (width - 4) + 2, height - 2 - ((i + 1) / ts.length) * (height - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${dates.length} sign-ups over time`} className="spark">
      <path d={`${d} L${width - 2} ${height - 2} L2 ${height - 2} Z`} fill="var(--blue-soft)" />
      <path d={d} fill="none" stroke="var(--blue)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.5" fill="var(--blue)" />
    </svg>
  );
}
