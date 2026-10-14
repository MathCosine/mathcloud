import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';

/** Shared by the student and coach portals: the day as a line, a countdown, a printable sheet. */

export type TimelineState = 'past' | 'now' | 'next';
export type TimelineItem = { id: string; time: ReactNode; title: ReactNode; detail?: ReactNode; side?: ReactNode; state: TimelineState };

/** The day as a vertical line: green up to now, a blue dot for what is on, hollow dots for what is to come. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="pt-tl">
      {items.map((it, i) => {
        const nextState = items[i + 1]?.state;
        const lineDone = it.state === 'past' && nextState !== undefined && nextState !== 'next';
        return (
          <li key={it.id} className={`pt-tl-item ${it.state}`}>
            <div className="pt-tl-time">{it.time}</div>
            <div className="pt-tl-rail" aria-hidden="true">
              {i < items.length - 1 && (
                <svg className="pt-tl-line" viewBox="0 0 2 100" preserveAspectRatio="none">
                  <line x1="1" y1="0" x2="1" y2="100" stroke={lineDone ? 'var(--green)' : 'var(--line-2)'} strokeWidth="2" strokeDasharray={lineDone ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              <svg className="pt-tl-dot" width="18" height="18" viewBox="0 0 18 18">
                {it.state === 'now' && <circle cx="9" cy="9" r="8.5" fill="var(--blue-soft)" />}
                <circle cx="9" cy="9" r={it.state === 'now' ? 5 : 4.5} fill={it.state === 'past' ? 'var(--green)' : it.state === 'now' ? 'var(--blue)' : 'var(--bg)'} stroke={it.state === 'past' ? 'var(--green)' : it.state === 'now' ? 'var(--blue)' : 'var(--line-2)'} strokeWidth="2" />
                {it.state === 'past' && <path d="M6.6 9.1l1.6 1.6 3.2-3.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
            </div>
            <div className="pt-tl-body">
              <div className="pt-tl-title">{it.title}</div>
              {it.detail && <div className="pt-tl-detail">{it.detail}</div>}
            </div>
            <div className="pt-tl-side">{it.side}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** "in 3 days", "in 4 h 10 min", "in 12:04". */
export function until(ms: number) {
  if (ms <= 0) return 'now';
  const min = Math.floor(ms / 60000);
  if (min >= 60 * 48) return `in ${Math.round(min / 1440)} days`;
  if (min >= 60) return `in ${Math.floor(min / 60)} h ${min % 60} min`;
  const s = Math.floor(ms / 1000);
  return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A clock time in a zone, 24-hour. */
export const hm = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

/** "Sat 23 Jan" in a zone. */
export const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * A full-screen sheet to read and print: score reports, sign-in slips. When
 * it is open, printing prints only the sheet, one page per `.pt-page`.
 */
export function SheetView({ title, sub, onClose, children, actions }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('pt-has-sheet');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('pt-has-sheet');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return createPortal(
    <div className="pt-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pt-sheet-bar">
        <button className="btn btn-sm btn-quiet" type="button" onClick={onClose}><Icon name="back" />Back</button>
        <div className="pt-sheet-title"><b>{title}</b>{sub && <span className="muted small">{sub}</span>}</div>
        <div className="row" style={{ gap: 6 }}>
          {actions}
          <button className="btn btn-sm btn-primary" type="button" onClick={() => window.print()}><Icon name="file" />Print</button>
        </div>
      </div>
      <div className="pt-sheet-body">{children}</div>
    </div>,
    document.body,
  );
}
