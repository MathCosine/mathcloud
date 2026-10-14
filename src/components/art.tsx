/**
 * Drawings. Each one shows a real part of a contest day (a keyed answer
 * sheet, the Guts board, a test in the browser) rather than decoration, and
 * uses the app's own colours through CSS variables so it sits with the UI.
 */

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="var(--blue)" />
      <path d="M8.6 21.5h15a4.6 4.6 0 0 0 .5-9.17 6.7 6.7 0 0 0-12.73 1.03A4.1 4.1 0 0 0 8.6 21.5z" fill="#fff" />
      <path d="M13.4 17.2h5.6M16.2 14.4V20" stroke="var(--blue)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

/** A paper answer sheet, half keyed: what a grader works through. */
export function ArtSheet({ className }: { className?: string }) {
  const rows = [
    ['1', '210', 'g'], ['2', '10080', 'g'], ['3', '25', 'g'], ['4', '7/12', 'a'], ['5', '12', 'r'], ['6', '', ''], ['7', '', ''],
  ];
  return (
    <svg className={className} viewBox="0 0 220 260" role="img" aria-label="A paper answer sheet being keyed">
      <rect x="18" y="10" width="184" height="240" rx="6" fill="var(--bg)" stroke="var(--line-2)" />
      <rect x="18" y="10" width="184" height="40" rx="6" fill="var(--bg-2)" />
      <text x="34" y="35" fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">Individual</text>
      <text x="186" y="35" fontSize="13" fontWeight="700" fill="var(--ink-2)" fontFamily="var(--mono)" textAnchor="end">05A</text>
      {rows.map(([n, v, tone], i) => (
        <g key={n} transform={`translate(0 ${64 + i * 26})`}>
          <text x="34" y="13" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">{n}</text>
          <rect x="56" y="0" width="128" height="19" rx="4" fill={tone === 'g' ? 'var(--green-soft)' : tone === 'r' ? 'var(--red-soft)' : tone === 'a' ? 'var(--amber-soft)' : 'var(--bg-2)'} />
          <text x="66" y="14" fontSize="12" fontWeight="600" fill={tone === 'g' ? 'var(--green)' : tone === 'r' ? 'var(--red)' : tone === 'a' ? 'var(--amber)' : 'var(--ink-3)'} fontFamily="var(--mono)">{v}</text>
        </g>
      ))}
      <rect x="56" y="246" width="0" height="0" />
    </svg>
  );
}

/** The live Guts board on a projector. */
export function ArtBoard({ className }: { className?: string }) {
  const teams = [['Tidepool Theorems', 67, 5], ['Moon Jellies', 62, 5], ['Hydrothermal', 60, 4], ['Blue Tangents', 56, 4], ['Rip Current', 48, 3]];
  return (
    <svg className={className} viewBox="0 0 360 230" role="img" aria-label="The live Guts scoreboard">
      <rect x="6" y="6" width="348" height="196" rx="8" fill="#0D1117" />
      <text x="24" y="38" fontSize="18" fontWeight="700" fill="#F3F5F9" fontFamily="var(--sans)">Guts</text>
      <text x="336" y="40" fontSize="22" fontWeight="600" fill="#F3F5F9" fontFamily="var(--mono)" textAnchor="end">37:41</text>
      <rect x="24" y="50" width="312" height="2" fill="#232A35" />
      <rect x="24" y="50" width="140" height="2" fill="#7C9BFF" />
      {teams.map(([name, score, sets], i) => (
        <g key={String(name)} transform={`translate(0 ${70 + i * 25})`}>
          <text x="28" y="12" fontSize="11" fontWeight="700" fill={i < 3 ? '#F3F5F9' : '#9AA3B2'} fontFamily="var(--sans)">{i + 1}</text>
          <text x="46" y="12" fontSize="11" fontWeight="700" fill="#F3F5F9" fontFamily="var(--sans)">{name}</text>
          {Array.from({ length: 6 }, (_, k) => (
            <rect key={k} x={210 + k * 14} y="5" width="11" height="5" rx="1.5" fill={k < Number(sets) - 1 ? '#3CC48D' : k === Number(sets) - 1 ? '#7C9BFF' : '#2A3240'} />
          ))}
          <text x="334" y="12" fontSize="12" fontWeight="700" fill="#F3F5F9" fontFamily="var(--sans)" textAnchor="end">{score}</text>
        </g>
      ))}
      <rect x="150" y="202" width="60" height="10" fill="var(--line-2)" />
      <rect x="120" y="212" width="120" height="6" rx="3" fill="var(--line-2)" />
    </svg>
  );
}

/** A test in the browser: one problem, the answer, the clock. */
export function ArtLaptop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 210" role="img" aria-label="An online test in the browser">
      <rect x="30" y="10" width="260" height="168" rx="8" fill="var(--bg)" stroke="var(--line-2)" />
      <rect x="30" y="10" width="260" height="28" rx="8" fill="var(--bg-2)" />
      <circle cx="46" cy="24" r="3.5" fill="var(--line-2)" />
      <circle cx="58" cy="24" r="3.5" fill="var(--line-2)" />
      <text x="160" y="29" fontSize="13" fontWeight="600" fill="var(--ink)" fontFamily="var(--mono)" textAnchor="middle">37:36</text>
      <rect x="30" y="37" width="150" height="2" fill="var(--blue)" />
      <text x="48" y="66" fontSize="10" fontWeight="700" fill="var(--blue)" fontFamily="var(--mono)">1.2</text>
      <text x="72" y="66" fontSize="11" fill="var(--ink)" fontFamily="var(--sans)">How many minutes are in a week?</text>
      <rect x="72" y="76" width="110" height="24" rx="4" fill="var(--blue-soft)" />
      <rect x="72" y="98" width="110" height="2" fill="var(--blue)" />
      <text x="82" y="93" fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="var(--mono)">10080</text>
      <circle cx="196" cy="88" r="3.5" fill="var(--green)" />
      <text x="204" y="92" fontSize="10" fill="var(--ink-3)" fontFamily="var(--sans)">Saved</text>
      <text x="48" y="128" fontSize="10" fontWeight="700" fill="var(--ink-3)" fontFamily="var(--mono)">1.3</text>
      <rect x="72" y="119" width="160" height="7" rx="3.5" fill="var(--bg-3)" />
      <rect x="72" y="134" width="110" height="24" rx="4" fill="var(--bg-2)" />
      <path d="M10 186h300l-14 14H24z" fill="var(--line-2)" />
    </svg>
  );
}

/** Registration to results: the whole contest as five steps. */
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
        return (
          <g key={t}>
            {i > 0 && <path d={`M${x - 26} 46h18`} stroke="var(--line-2)" strokeWidth="2" markerEnd="url(#arrow)" />}
            <rect x={x} y="14" width="118" height="64" rx="10" fill="var(--bg)" stroke={i === 2 ? 'var(--blue)' : 'var(--line-2)'} strokeWidth={i === 2 ? 1.6 : 1} />
            <circle cx={x + 18} cy="34" r="9" fill={i < 2 ? 'var(--green)' : i === 2 ? 'var(--blue)' : 'var(--bg-3)'} />
            <text x={x + 18} y="38" fontSize="10" fontWeight="700" fill={i <= 2 ? '#fff' : 'var(--ink-3)'} textAnchor="middle" fontFamily="var(--sans)">{i + 1}</text>
            <text x={x + 34} y="38" fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">{t}</text>
            <text x={x + 14} y="62" fontSize="11" fill="var(--ink-3)" fontFamily="var(--sans)">{s}</text>
          </g>
        );
      })}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0l10 5-10 5z" fill="var(--line-2)" />
        </marker>
      </defs>
    </svg>
  );
}

/** Empty states: a small drawing that says what will be here. */
export function ArtEmpty({ kind, className }: { kind: 'teams' | 'mail' | 'results' | 'problems' | 'waivers' | 'search'; className?: string }) {
  return (
    <svg className={className ?? 'art-empty'} viewBox="0 0 120 90" aria-hidden="true">
      <ellipse cx="60" cy="82" rx="44" ry="5" fill="var(--bg-3)" />
      {kind === 'teams' && (
        <g>
          <rect x="22" y="22" width="76" height="50" rx="6" fill="var(--bg)" stroke="var(--line-2)" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx="36" cy={36 + i * 13} r="4" fill={i === 0 ? 'var(--blue)' : 'var(--bg-3)'} />
              <rect x="46" y={33 + i * 13} width={i === 0 ? 40 : 30} height="6" rx="3" fill="var(--bg-3)" />
            </g>
          ))}
        </g>
      )}
      {kind === 'mail' && (
        <g>
          <rect x="24" y="26" width="72" height="46" rx="5" fill="var(--bg)" stroke="var(--line-2)" />
          <path d="M26 29l34 24 34-24" fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
          <circle cx="92" cy="26" r="9" fill="var(--blue)" />
          <path d="M88 26l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {kind === 'results' && (
        <g>
          <rect x="30" y="44" width="18" height="28" rx="2" fill="var(--bg-3)" />
          <rect x="51" y="30" width="18" height="42" rx="2" fill="var(--blue)" />
          <rect x="72" y="52" width="18" height="20" rx="2" fill="var(--bg-3)" />
          <text x="60" y="26" fontSize="10" fontWeight="700" textAnchor="middle" fill="var(--blue)" fontFamily="var(--sans)">1</text>
        </g>
      )}
      {kind === 'problems' && (
        <g>
          <rect x="28" y="16" width="64" height="58" rx="5" fill="var(--bg)" stroke="var(--line-2)" />
          <text x="38" y="38" fontSize="12" fill="var(--ink-2)" fontFamily="KaTeX_Math, serif" fontStyle="italic">x² + 1</text>
          <rect x="38" y="48" width="44" height="6" rx="3" fill="var(--bg-3)" />
          <rect x="38" y="60" width="30" height="6" rx="3" fill="var(--bg-3)" />
        </g>
      )}
      {kind === 'waivers' && (
        <g>
          <rect x="34" y="14" width="52" height="62" rx="4" fill="var(--bg)" stroke="var(--line-2)" />
          <rect x="42" y="26" width="36" height="5" rx="2.5" fill="var(--bg-3)" />
          <rect x="42" y="36" width="30" height="5" rx="2.5" fill="var(--bg-3)" />
          <path d="M44 62c6-8 10 4 16-3s8 2 14-2" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {kind === 'search' && (
        <g>
          <circle cx="54" cy="44" r="18" fill="var(--bg)" stroke="var(--line-2)" strokeWidth="3" />
          <path d="M67 57l14 14" stroke="var(--line-2)" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
