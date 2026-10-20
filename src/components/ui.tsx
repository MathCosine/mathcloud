import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';
import type { DivisionMode } from '../lib/model';
import { Icon, type IconName } from './icons';

// ------------------------------------------------------------------- Roll

/** A number that rolls to its new value, so the eye goes to what changed. */
export function Roll({ value }: { value: number | string }) {
  const s = String(value);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!/^\d+$/.test(s)) return <span>{s}</span>;
  return (
    <span className="roll" aria-label={s} role="img">
      {s.split('').map((d, i) => (
        <span key={`${s.length}-${i}`} className="col" aria-hidden="true" style={{ transform: `translateY(${-Number(d) * 1.15}em)`, transition: ready ? undefined : 'none' }}>
          {'0123456789'.split('').map((n) => (
            <span key={n}>{n}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

// --------------------------------------------------------------- controls

export function Checkbox({ checked, onChange, label }: { checked: boolean | 'mixed'; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className="cb"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked ? 'true' : 'false'}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path className="t1" d="M4 8.5l2.5 2.5L12 5.5" />
        <path className="d1" d="M4.5 8h7" />
      </svg>
    </button>
  );
}

export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export type Tone = 'ok' | 'wait' | 'bad' | 'go' | 'off';

/** A dot and a word. */
export function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`state ${tone}`}>{children}</span>;
}

/** Guts sets as a row of small bars: done, now, to come. */
export function Track({ done, total, current }: { done: number; total: number; current: number | null }) {
  return (
    <span className="track" aria-label={`${done} of ${total} sets handed in`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < done ? 'done' : current === i + 1 ? 'now' : ''} />
      ))}
    </span>
  );
}

// ------------------------------------------------- in person and online

export const MODE_ICON: Record<DivisionMode, IconName> = { in_person: 'pin', online: 'screen' };
const MODE_WORD: Record<DivisionMode, string> = { in_person: 'In person', online: 'Online' };

/** In person or online, always as colour, icon and word together. */
export function ModeChip({ mode, children, lg }: { mode: DivisionMode; children?: ReactNode; lg?: boolean }) {
  return (
    <span className={`mode ${mode} ${lg ? 'lg' : ''}`}>
      <Icon name={MODE_ICON[mode]} size={lg ? 15 : 13} />
      {children ?? MODE_WORD[mode]}
    </span>
  );
}

/** One big option in a choice that changes what comes after it. */
export function Choice({
  checked, onSelect, tone, icon, title, children, points, disabled, compact,
}: {
  checked: boolean; onSelect: () => void; tone: DivisionMode | 'both'; icon: IconName; title: ReactNode;
  children?: ReactNode; points?: { icon: IconName; text: ReactNode }[]; disabled?: boolean; compact?: boolean;
}) {
  return (
    <button
      type="button" role="radio" aria-checked={checked} aria-disabled={disabled || undefined}
      className={`choice ${tone} ${compact ? 'compact' : ''}`}
      onClick={() => !disabled && onSelect()}
    >
      <span className="ic"><Icon name={icon} size={20} /></span>
      <span className="stack" style={{ gap: 4 }}>
        <h3>{title}</h3>
        {children && <p>{children}</p>}
      </span>
      {points && (
        <ul>
          {points.map((p, i) => <li key={i}><Icon name={p.icon} size={14} /><span>{p.text}</span></li>)}
        </ul>
      )}
      <span className="tick"><Icon name="check" size={13} /></span>
    </button>
  );
}

// ------------------------------------------------------------------- Math

export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith('$') && part.endsWith('$') ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(1, -1), { throwOnError: false }) }} />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/** A typed answer shown as maths when it is more than a plain number. */
export function AnswerPreview({ value }: { value: string }) {
  const v = value.trim();
  if (!v || /^-?\d+$/.test(v)) return null;
  const tex = v.includes('\\') ? v : v.replace(/^(-?\d+)\/(\d+)$/, '\\frac{$1}{$2}').replace(/sqrt\(([^)]*)\)/g, '\\sqrt{$1}');
  return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(`\\displaystyle ${tex}`, { throwOnError: false }) }} />;
}

// ---------------------------------------------------- sliding indicators

export function useSlider<T extends HTMLElement>(selector: string, deps: unknown[]) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState({ w: 0, x: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current?.querySelector<HTMLElement>(selector);
      if (el) setPos({ w: el.offsetWidth, x: el.offsetLeft });
    };
    place();
    window.addEventListener('resize', place);
    document.fonts?.ready.then(place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, style: { width: pos.w, transform: `translateX(${pos.x}px)` } };
}

export function Tabs<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; label: ReactNode; count?: number }[] }) {
  const { ref, style } = useSlider<HTMLDivElement>('[aria-selected="true"]', [value, items.length]);
  // Left and right move between tabs, as in any tab list.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = items.findIndex((it) => it.key === value);
    const n = items.length;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    onChange(items[to].key);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="tabs" role="tablist" ref={ref} onKeyDown={onKey}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={it.key === value} tabIndex={it.key === value ? 0 : -1} onClick={() => onChange(it.key)}>
          {it.label}
          {it.count !== undefined && <span className="n">{it.count}</span>}
        </button>
      ))}
      <span className="tab-line" style={style} />
    </div>
  );
}

export function Segmented<K extends string>({ value, onChange, items, label }: { value: K; onChange: (k: K) => void; items: { key: K; label: ReactNode; count?: number }[]; label: string }) {
  const { ref, style } = useSlider<HTMLDivElement>('[aria-pressed="true"]', [value, items.length]);
  return (
    <div className="seg" role="group" aria-label={label} ref={ref}>
      <span className="seg-thumb" style={style} />
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={it.key === value} onClick={() => onChange(it.key)}>
          {it.label}
          {it.count !== undefined && <span className="n">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ toasts

type ToastItem = { id: number; title: string; body?: string; tone?: 'g' | 'a' | 'r' | ''; out?: boolean };
let toasts: ToastItem[] = [];
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());
const toastTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

function dismissToast(id: number, delay = 0) {
  toastTimers.get(id)?.forEach(clearTimeout);
  toastTimers.set(id, [
    setTimeout(() => {
      toasts = toasts.map((t) => (t.id === id ? { ...t, out: true } : t));
      emitToasts();
    }, delay),
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      toastTimers.delete(id);
      emitToasts();
    }, delay + 250),
  ]);
}

export function toast(title: string, body?: string, tone: ToastItem['tone'] = '') {
  const id = Date.now() + Math.random();
  toasts = [...toasts.slice(-2), { id, title, body, tone }];
  emitToasts();
  dismissToast(id, tone === 'r' ? 6000 : 3800);
}

/** The mark at the start of a toast: a tick that draws itself for good news, a dot otherwise. */
function ToastMark({ tone }: { tone?: ToastItem['tone'] }) {
  if (tone === 'g') {
    return (
      <i className="tk" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.4 2.4 5.2-5.4" /></svg>
      </i>
    );
  }
  return <i aria-hidden="true" />;
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''} ${t.out ? 'out' : ''}`} onClick={() => dismissToast(t.id)} title="Dismiss">
          <ToastMark tone={t.tone} />
          <div>
            <b>{t.title}</b>
            {t.body && <span> {t.body}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------- modal, drawer

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside a dialog, and give focus back to whatever opened it. */
function useFocusTrap(box: React.RefObject<HTMLElement | null>, active: boolean, first?: () => HTMLElement | null | undefined) {
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    // Two frames: the dialog may only just be mounting.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        const el = box.current;
        if (!el || el.contains(document.activeElement)) return;
        const start = first?.() ?? el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? el;
        start.focus({ preventScroll: true });
      });
    });
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.key !== 'Tab' || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!all.length) return;
      const a = all[0];
      const z = all[all.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        a.focus();
      } else if (e.shiftKey && (document.activeElement === a || document.activeElement === el)) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', onKey);
      const now = document.activeElement;
      if (before && document.contains(before) && (!now || now === document.body || box.current?.contains(now))) before.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(box, true);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // On <body>, so nothing on the page (a transform, an overflow) can clip or move it.
  return createPortal(
    <div className="scrim" onClick={onClose} role="presentation">
      <div ref={box} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h2 id={id}>{title}</h2>
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A panel that floats in from the right. It keeps showing what it showed while
 * it slides away, and leaves the page entirely once it has gone.
 */
export function Drawer({ open, onClose, kicker, title, children, foot }: { open: boolean; onClose: () => void; kicker?: ReactNode; title?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const last = useRef({ kicker, title, children, foot });
  const box = useRef<HTMLElement>(null);
  if (open) last.current = { kicker, title, children, foot };
  useEffect(() => {
    if (open) {
      setMounted(true);
      // One frame closed, then open, so it slides rather than appears.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 460);
    return () => clearTimeout(t);
  }, [open]);
  useFocusTrap(box, open, () => box.current?.querySelector<HTMLElement>('.close'));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  const c = last.current;
  return createPortal(
    <aside ref={box} className={`drawer ${shown ? 'open' : ''}`} aria-hidden={!open} role="dialog" aria-label={typeof c.title === 'string' ? c.title : undefined}>
      <div className="drawer-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">{c.kicker}</span>
          <button className="close" type="button" aria-label="Close" title="Close (Esc)" onClick={onClose}><CloseIcon /></button>
        </div>
        {c.title && <h2>{c.title}</h2>}
      </div>
      <div className="drawer-body">{c.children}</div>
      {c.foot && <div className="drawer-foot">{c.foot}</div>}
    </aside>,
    document.body,
  );
}

/** Nothing here yet: what this is for, and the one next step. */
export function EmptyState({ icon, title, children, action, className }: { icon: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`es ${className ?? ''}`}>
      <span className="es-ic"><Icon name={icon} size={20} /></span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <div className="es-act">{action}</div>}
    </div>
  );
}

// -------------------------------------------------------------------- misc

/** Re-render every `ms` (for clocks). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function SearchBox({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  return (
    <label className={`search ${value ? 'has' : ''}`}>
      <span className="sr">Search</span>
      <Icon name="search" />
      <input
        ref={ref}
        className="input"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        autoComplete="off"
      />
      {value && (
        <button type="button" className="search-x" aria-label="Clear search" title="Clear (Esc)" onClick={(e) => { e.preventDefault(); onChange(''); ref.current?.focus(); }}>
          <CloseIcon />
        </button>
      )}
    </label>
  );
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast(`Exported ${rows.length} rows`, filename);
}
