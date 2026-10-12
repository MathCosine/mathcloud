import type { ReactNode } from 'react';

/**
 * One small line-icon set, drawn on a 24 grid with a 1.75 stroke so every
 * icon has the same weight as the text beside it. Icons only ever sit next
 * to a word; they help scanning, they never stand alone.
 */
const PATHS: Record<string, ReactNode> = {
  overview: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="4" rx="1.5" /><rect x="13" y="10" width="7" height="10" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /></>,
  setup: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  roster: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" /></>,
  rounds: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3.5h6v2H9zM9 10h6M9 14h6M9 18h3" /></>,
  live: <><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></>,
  grading: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14 8l3 3M13 20h7" /></>,
  results: <><path d="M3 20h18M5 20v-7h4v7M10 20V8h4v12M15 20v-4h4v4" /></>,
  certificate: <><circle cx="12" cy="9" r="5.5" /><path d="M8.7 13.5L7.5 21l4.5-2.5 4.5 2.5-1.2-7.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  people: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></>,
  pin: <><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  screen: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>,
  video: <><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="M15.5 10.5l6-3.5v10l-6-3.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  board: <><path d="M3 4.5h18M4.5 4.5v10h15v-10M12 14.5V19M8.5 21l3.5-2 3.5 2" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  table: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  ticket: <><path d="M4 6.5h16v3.2a2.3 2.3 0 0 0 0 4.6v3.2H4v-3.2a2.3 2.3 0 0 0 0-4.6z" /><path d="M14.5 7v10" strokeDasharray="1.6 2" /></>,
  pencil: <><path d="M15 4l5 5L9 20H4v-5z" /><path d="M12.5 6.5l5 5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.4 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.4-3.8-8.5s1.2-6.1 3.8-8.5z" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  switch: <><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" /></>,
  chevron: <path d="M7 10l5 5 5-5" />,
  dot: <circle cx="12" cy="12" r="3" />,
  both: <><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
