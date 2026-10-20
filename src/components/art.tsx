import type { CSSProperties, ReactNode } from 'react';

/**
 * Drawings. Each one shows a real part of a contest day (a keyed answer
 * sheet, the Guts board, a test in the browser) rather than decoration.
 *
 * They are drawn like the app: ink and greys on white, objects standing on a
 * thin solid edge (as the buttons do), and one accent for the thing that
 * matters in the picture. The accent is blue unless the page sets
 * --art-accent. Small parts arrive with a short pop that the global
 * reduced-motion rule turns off.
 */

const ACCENT = 'var(--art-accent, var(--blue))';
const EDGE = 'var(--line-2)';
const LINE = 'var(--bg-3)';

/** A shape that pops in after `delay` seconds (scales from its own centre). */
const popIn = (delay = 0.15): CSSProperties => ({ transformBox: 'fill-box', transformOrigin: 'center', animation: `pop .5s var(--spring) ${delay}s both` });

/** A white object on a thin solid edge, like a card or a tactile button. */
function Paper({ x, y, w, h, r = 8, stroke = EDGE }: { x: number; y: number; w: number; h: number; r?: number; stroke?: string }) {
  return (
    <g>
      <rect x={x} y={y + 2} width={w} height={h} rx={r} fill={EDGE} />
      <rect x={x} y={y} width={w} height={h} rx={r} fill="var(--bg)" stroke={stroke} />
    </g>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  // A cloud drawn from three circles, with a plus cut out of it: maths, in the cloud.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="#0B0B0E" />
      <path d="M9.4 22.2h13.4a4.3 4.3 0 0 0 .55-8.57 6.4 6.4 0 0 0-12.15 1.2 3.7 3.7 0 0 0-1.8 7.37z" fill="#fff" />
      <path d="M16.3 15.4v4.6M14 17.7h4.6" stroke="#0B0B0E" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="24.6" cy="8" r="2.1" fill="#5B7BFF" />
    </svg>
  );
}

/** A paper answer sheet, half keyed: what a grader works through. The row being keyed carries the accent. */
export function ArtSheet({ className }: { className?: string }) {
  const rows: [string, string, 'ok' | 'no' | 'ask' | 'now' | ''][] = [
    ['1', '210', 'ok'], ['2', '10080', 'ok'], ['3', '25', 'ok'], ['4', '7/12', 'ask'], ['5', '12', 'no'], ['6', '3', 'now'], ['7', '', ''],
  ];
  return (
    <svg className={className} viewBox="0 0 220 260" role="img" aria-label="A paper answer sheet being keyed">
      <Paper x={18} y={10} w={184} h={236} />
      <text x="34" y="36" fontSize="13" fontWeight="600" fill="var(--ink)" fontFamily="var(--sans)" letterSpacing="-.2">Individual</text>
      <text x="186" y="36" fontSize="12" fontWeight="500" fill="var(--ink-3)" fontFamily="var(--mono)" textAnchor="end">05A</text>
      <path d="M34 48h152" stroke="var(--line)" />
      {rows.map(([n, v, tone], i) => (
        <g key={n} transform={`translate(0 ${60 + i * 25})`}>
          <text x="34" y="13" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">{n}</text>
          {tone === 'now' ? (
            <g>
              <rect x="54" y="-1" width="104" height="21" rx="5" fill="var(--bg)" stroke={ACCENT} strokeWidth="1.5" />
              <text x="64" y="14" fontSize="12" fontWeight="600" fill="var(--ink)" fontFamily="var(--mono)">{v}</text>
              <rect x="74" y="4" width="1.5" height="12" rx=".75" fill={ACCENT} style={{ animation: 'now 1.1s steps(1) infinite' }} />
            </g>
          ) : (
            <g>
              <rect x="54" y="0" width="104" height="19" rx="5" fill="var(--bg-2)" />
              <text x="64" y="14" fontSize="12" fontWeight="600" fill={v ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--mono)">{v}</text>
            </g>
          )}
          {tone === 'ok' && <path d="M170 10l3 3 6-7" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
          {tone === 'no' && <path d="M171 6l6 6M177 6l-6 6" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" />}
          {tone === 'ask' && <text x="174" y="14" fontSize="12" fontWeight="600" fill="var(--ink-3)" fontFamily="var(--sans)" textAnchor="middle">?</text>}
        </g>
      ))}
    </svg>
  );
}

/** The live Guts board on a projector: an ink screen, the set being handed in carries the accent. */
export function ArtBoard({ className }: { className?: string }) {
  const teams: [string, number, number][] = [['Tidepool Theorems', 67, 5], ['Moon Jellies', 62, 5], ['Hydrothermal', 60, 4], ['Blue Tangents', 56, 4], ['Rip Current', 48, 3]];
  return (
    <svg className={className} viewBox="0 0 360 230" role="img" aria-label="The live Guts scoreboard">
      <rect x="6" y="6" width="348" height="196" rx="10" fill="var(--ink)" />
      <text x="26" y="40" fontSize="18" fontWeight="600" fill="#fff" fontFamily="var(--sans)" letterSpacing="-.4">Guts</text>
      <text x="334" y="41" fontSize="21" fontWeight="600" fill="#fff" fontFamily="var(--mono)" textAnchor="end">37:41</text>
      <rect x="26" y="52" width="308" height="2" rx="1" fill="rgba(255,255,255,.12)" />
      <rect x="26" y="52" width="140" height="2" rx="1" fill={ACCENT} />
      {teams.map(([name, score, sets], i) => (
        <g key={name} transform={`translate(0 ${72 + i * 25})`}>
          <text x="28" y="12" fontSize="11" fontWeight="500" fill="rgba(255,255,255,.5)" fontFamily="var(--sans)">{i + 1}</text>
          <text x="46" y="12" fontSize="11" fontWeight="500" fill="#fff" fontFamily="var(--sans)">{name}</text>
          {Array.from({ length: 6 }, (_, k) => (
            <rect key={k} x={210 + k * 14} y="5" width="11" height="5" rx="1.5" fill={k < sets - 1 ? 'rgba(255,255,255,.72)' : k === sets - 1 ? ACCENT : 'rgba(255,255,255,.12)'} />
          ))}
          <text x="334" y="12" fontSize="12" fontWeight="600" fill="#fff" fontFamily="var(--sans)" textAnchor="end">{score}</text>
        </g>
      ))}
      <rect x="160" y="202" width="40" height="10" fill={EDGE} />
      <rect x="126" y="212" width="108" height="5" rx="2.5" fill={EDGE} />
    </svg>
  );
}

/** A test in the browser: one problem, the answer being typed (the accent), the clock. */
export function ArtLaptop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 210" role="img" aria-label="An online test in the browser">
      <Paper x={30} y={10} w={260} h={166} r={10} />
      <circle cx="47" cy="25" r="3" fill={EDGE} />
      <circle cx="58" cy="25" r="3" fill={EDGE} />
      <circle cx="69" cy="25" r="3" fill={EDGE} />
      <text x="160" y="30" fontSize="12.5" fontWeight="600" fill="var(--ink)" fontFamily="var(--mono)" textAnchor="middle">37:36</text>
      <path d="M30 39h260" stroke="var(--line)" />
      <rect x="30" y="38" width="150" height="2" fill={ACCENT} />
      <text x="48" y="66" fontSize="10" fontWeight="500" fill="var(--ink-3)" fontFamily="var(--mono)">1.2</text>
      <text x="72" y="66" fontSize="11" fill="var(--ink)" fontFamily="var(--sans)">How many minutes are in a week?</text>
      <rect x="72" y="76" width="110" height="24" rx="5" fill="var(--bg-2)" />
      <rect x="72" y="98" width="110" height="2" rx="1" fill={ACCENT} />
      <text x="82" y="93" fontSize="13" fontWeight="600" fill="var(--ink)" fontFamily="var(--mono)">10080</text>
      <path d="M193 88l2.5 2.5 5-5.5" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="206" y="92" fontSize="10" fill="var(--ink-3)" fontFamily="var(--sans)">Saved</text>
      <text x="48" y="128" fontSize="10" fontWeight="500" fill="var(--ink-3)" fontFamily="var(--mono)">1.3</text>
      <rect x="72" y="120" width="160" height="6" rx="3" fill={LINE} />
      <rect x="72" y="134" width="110" height="24" rx="5" fill="var(--bg-2)" />
      <path d="M12 188h296l-12 12H24z" fill={EDGE} />
    </svg>
  );
}

/** Registration to results: the whole contest as five steps. Done steps are ink, the current one carries the accent. */
export function ArtFlow({ className }: { className?: string }) {
  const steps = [
    ['Sign-ups', 'Form or CSV'],
    ['Day of', 'In person and online'],
    ['Grading', 'Keyed and checked'],
    ['Results', 'Your weights, ties'],
    ['Reports', 'Emailed to families'],
  ];
  return (
    <svg className={className} viewBox="0 0 760 120" role="img" aria-label="Sign-ups, the day, grading, results, reports">
      {steps.map(([t, s], i) => {
        const x = 10 + i * 150;
        const now = i === 2;
        return (
          <g key={t}>
            {i > 0 && <path d={`M${x - 25} 46h13M${x - 16} 42l4 4-4 4`} stroke={EDGE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
            <Paper x={x} y={14} w={118} h={64} r={11} stroke={now ? ACCENT : EDGE} />
            {i < 2 ? (
              <g>
                <circle cx={x + 18} cy="34" r="8" fill="var(--ink)" />
                <path d={`M${x + 14.5} 34l2.5 2.5 4.5-5`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : (
              <g>
                <circle cx={x + 18} cy="34" r="8" fill={now ? ACCENT : 'var(--bg)'} stroke={now ? 'none' : EDGE} strokeWidth="1.5" />
                <text x={x + 18} y="37.5" fontSize="9.5" fontWeight="600" fill={now ? '#fff' : 'var(--ink-3)'} textAnchor="middle" fontFamily="var(--sans)">{i + 1}</text>
              </g>
            )}
            <text x={x + 33} y="38" fontSize="13" fontWeight="600" fill="var(--ink)" fontFamily="var(--sans)" letterSpacing="-.2">{t}</text>
            <text x={x + 14} y="62" fontSize="11" fill="var(--ink-3)" fontFamily="var(--sans)">{s}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Empty states: a small line drawing that says what will be here. Greys on
 * white, with one accent part that pops in.
 */
export function ArtEmpty({ kind, className }: { kind: 'teams' | 'mail' | 'results' | 'problems' | 'waivers' | 'search'; className?: string }) {
  const pictures: Record<typeof kind, ReactNode> = {
    teams: (
      <g>
        <Paper x={24} y={18} w={72} h={54} />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx="37" cy={31 + i * 14} r="4" fill={i === 0 ? ACCENT : LINE} style={i === 0 ? popIn(0.2) : undefined} />
            <rect x="46" y={28.5 + i * 14} width={i === 0 ? 36 : 28 - i * 4} height="5" rx="2.5" fill={i === 0 ? 'var(--line-2)' : LINE} />
          </g>
        ))}
      </g>
    ),
    mail: (
      <g>
        <Paper x={22} y={24} w={70} h={46} r={6} />
        <path d="M25 28l32 23 32-23" fill="none" stroke={EDGE} strokeWidth="1.5" strokeLinejoin="round" />
        <g style={popIn(0.2)}>
          <circle cx="92" cy="25" r="9" fill={ACCENT} />
          <path d="M88 25l3 3 5-6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    ),
    results: (
      <g>
        <rect x="28" y="46" width="20" height="26" rx="3" fill={LINE} />
        <rect x="72" y="54" width="20" height="18" rx="3" fill={LINE} />
        <g style={{ transformBox: 'fill-box', transformOrigin: 'bottom', animation: 'pop .55s var(--spring) .15s both' }}>
          <rect x="50" y="30" width="20" height="42" rx="3" fill={ACCENT} />
        </g>
        <text x="60" y="24" fontSize="10" fontWeight="600" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--sans)">1</text>
        <path d="M20 72h80" stroke={EDGE} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    ),
    problems: (
      <g>
        <Paper x={28} y={12} w={60} h={62} r={6} />
        <text x="38" y="33" fontSize="12" fill="var(--ink-2)" fontFamily="KaTeX_Math, serif" fontStyle="italic">x² + 1</text>
        <rect x="38" y="42" width="40" height="5" rx="2.5" fill={LINE} />
        <rect x="38" y="52" width="28" height="5" rx="2.5" fill={LINE} />
        <g style={popIn(0.2)}>
          <rect x="72" y="52" width="24" height="16" rx="4" fill={ACCENT} />
          <path d="M79 60l3 3 6-6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    ),
    waivers: (
      <g>
        <Paper x={34} y={12} w={52} h={62} r={5} />
        <rect x="42" y="23" width="34" height="5" rx="2.5" fill={LINE} />
        <rect x="42" y="33" width="26" height="5" rx="2.5" fill={LINE} />
        <path d="M42 62h34" stroke={EDGE} strokeLinecap="round" />
        <path d="M44 58c5-8 9 3 14-3s7 2 13-2" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" pathLength={1}
          style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: 'art-draw .8s var(--out) .2s forwards' }} />
      </g>
    ),
    search: (
      <g>
        <circle cx="54" cy="42" r="17" fill="var(--bg)" stroke={EDGE} strokeWidth="2.5" />
        <rect x="45" y="38" width="18" height="3" rx="1.5" fill={LINE} />
        <rect x="45" y="45" width="11" height="3" rx="1.5" fill={LINE} />
        <path d="M67 55l13 13" stroke="var(--ink-3)" strokeWidth="5" strokeLinecap="round" />
        <circle cx="86" cy="22" r="3.5" fill={ACCENT} style={popIn(0.25)} />
      </g>
    ),
  };
  return (
    <svg className={className ?? 'art-empty'} viewBox="0 0 120 90" aria-hidden="true">
      <style>{'@keyframes art-draw { to { stroke-dashoffset: 0; } }'}</style>
      {pictures[kind]}
    </svg>
  );
}
