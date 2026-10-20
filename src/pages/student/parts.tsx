import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';
import { Roll } from '../../components/ui';
import { duration } from '../../lib/time';

/** Shared by the student and coach portals: the day as a line, a tick, a countdown, a printable sheet. */

export type TimelineState = 'past' | 'now' | 'next';
export type TimelineItem = { id: string; time: ReactNode; title: ReactNode; detail?: ReactNode; side?: ReactNode; state: TimelineState };

/** The day as a vertical line: green up to now, a blue dot for what is on, hollow dots for what is to come. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="pt-tl">
      {items.map((it, i) => {
        const nextState = items[i + 1]?.state;
        const fill = it.state === 'past' && nextState !== undefined && nextState !== 'next';
        return (
          <li key={it.id} className={`pt-tl-item ${it.state} ${fill ? 'fill' : ''}`}>
            <div className="pt-tl-time">{it.time}</div>
            <div className="pt-tl-rail" aria-hidden="true">
              <span className="pt-tl-dot">{it.state === 'past' && <Icon name="check" size={10} />}</span>
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

/**
 * A round tick for a checklist. When something becomes done while you watch,
 * the circle fills and the tick draws itself in; things already done are
 * simply ticked.
 */
export function Tick({ on, next, busy, label }: { on: boolean; next?: boolean; busy?: boolean; label?: string }) {
  const was = useRef(on);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (on && !was.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 700);
      was.current = on;
      return () => clearTimeout(t);
    }
    was.current = on;
  }, [on]);
  return (
    <span className={`pt-tick ${on ? 'on' : ''} ${pop ? 'pop' : ''} ${next && !on ? 'next' : ''} ${busy && !on ? 'busy' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {busy && !on ? <span className="spinner" /> : (
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.5 2.5L12 5.5" /></svg>
      )}
    </span>
  );
}

/** Time left as rolling digits: each second the last digit slides to its new value. */
export function Countdown({ ms, className }: { ms: number; className?: string }) {
  const text = duration(ms);
  return (
    <span className={`pt-clock ${className ?? ''}`} role="timer" aria-label={`${text} left`}>
      {text.split(':').map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="pt-colon" aria-hidden="true">:</span>}
          <Roll value={p} />
        </Fragment>
      ))}
    </span>
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

/** A button that copies, and says so for a moment with a tick. */
export function CopyButton({ text, label = 'Copy', title, onCopied, className }: { text: string | (() => Promise<string | null>); label?: string; title?: string; onCopied?: (ok: boolean, value: string | null) => void; className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);
  const run = async () => {
    setState('busy');
    const value = typeof text === 'string' ? text : await text();
    const ok = value ? await copyText(value) : false;
    setState(ok ? 'done' : 'idle');
    onCopied?.(ok, value);
  };
  return (
    <button type="button" className={`btn btn-sm btn-quiet pt-copy ${state} ${label ? '' : 'bare'} ${className ?? ''}`} onClick={run} disabled={state === 'busy'} title={title} aria-label={label ? undefined : title}>
      <span className="pt-copy-ic"><Icon name="copy" size={14} /><Icon name="check" size={14} /></span>
      {label && (state === 'done' ? 'Copied' : label)}
    </button>
  );
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
          <button className="btn btn-sm btn-primary" type="button" onClick={() => window.print()}><Icon name="print" />Print</button>
        </div>
      </div>
      <div className="pt-sheet-body">{children}</div>
    </div>,
    document.body,
  );
}
