import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import katex from 'katex';

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
  return (
    <div className="tabs" role="tablist" ref={ref}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={it.key === value} onClick={() => onChange(it.key)}>
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

export function toast(title: string, body?: string, tone: ToastItem['tone'] = '') {
  const id = Date.now() + Math.random();
  toasts = [...toasts.slice(-2), { id, title, body, tone }];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, out: true } : t));
    emitToasts();
  }, 3800);
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, 4050);
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
        <div key={t.id} className={`toast ${t.tone ?? ''} ${t.out ? 'out' : ''}`}>
          <i />
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

export function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, kicker, title, children, foot }: { open: boolean; onClose: () => void; kicker?: ReactNode; title?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      {open && (
        <>
          <div className="drawer-head">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="label">{kicker}</span>
              <button className="close" type="button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
            </div>
            {title && <h2>{title}</h2>}
          </div>
          <div className="drawer-body">{children}</div>
          {foot && <div className="drawer-foot">{foot}</div>}
        </>
      )}
    </aside>
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
  return (
    <label className="search">
      <span className="sr">Search</span>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input ref={inputRef} className="input" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
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
