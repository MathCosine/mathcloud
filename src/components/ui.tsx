import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import katex from 'katex';

// ------------------------------------------------------------------- Roll

/** A number that rolls to its new value, so the eye goes to what changed. */
export function Roll({ value, plain }: { value: number | string; plain?: boolean }) {
  const s = String(value);
  const digitsOnly = /^\d+$/.test(s);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!digitsOnly) return <span>{s}</span>;
  return (
    <span className={`roll ${plain ? 'plain' : ''}`} aria-label={s} role="text">
      {s.split('').map((d, i) => (
        <span
          key={`${s.length}-${i}`}
          className="col"
          aria-hidden="true"
          style={{ transform: `translateY(${-Number(d) * 1.2}em)`, transition: mounted ? undefined : 'none' }}
        >
          {'0123456789'.split('').map((n) => (
            <span key={n}>{n}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

// --------------------------------------------------------------- Checkbox

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

// ------------------------------------------------------------------ icons

export const Tick = ({ draw }: { draw?: boolean }) => (
  <svg viewBox="0 0 12 12" className={`tick-svg ${draw ? 'tick-draw' : ''}`} aria-hidden="true">
    <path d="M2.5 6.3l2.2 2.2L9.5 3.7" />
  </svg>
);
export const Ring = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
export const Dash = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
export const Cross = () => (
  <svg viewBox="0 0 12 12" className="tick-svg" aria-hidden="true">
    <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
  </svg>
);
export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const Mark = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M0 12L12 0V12Z" fill="#0E8A5F" />
    <path d="M0 0H12L0 12Z" fill="#1D5BD6" />
  </svg>
);

export type Tone = 'green' | 'amber' | 'grey' | 'blue' | 'red';

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const icon = tone === 'green' ? <Tick /> : tone === 'amber' ? <Ring /> : tone === 'red' ? <Cross /> : <Dash />;
  return (
    <span className={`status ${tone}`}>
      {icon}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------- Math

/** Text with $…$ maths, rendered with KaTeX. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.startsWith('$') && part.endsWith('$') && part.length > 2 ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(1, -1), { throwOnError: false }) }} />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/** A typed answer shown as maths when it looks like maths. */
export function AnswerPreview({ value }: { value: string }) {
  const v = value.trim();
  if (!v || /^-?\d+$/.test(v)) return null;
  const tex = v.includes('\\') ? v : v.replace(/^(-?\d+)\/(\d+)$/, '\\frac{$1}{$2}').replace(/sqrt\(([^)]*)\)/g, '\\sqrt{$1}');
  return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(`\\displaystyle ${tex}`, { throwOnError: false }) }} />;
}

// ------------------------------------------------- sliding indicator hooks

/** Positions an underline / thumb under the selected child, and slides it. */
export function useSlider<T extends HTMLElement>(selector: string, deps: unknown[]) {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<{ width: number; x: number }>({ width: 0, x: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current?.querySelector<HTMLElement>(selector);
      if (el) setStyle({ width: el.offsetWidth, x: el.offsetLeft });
    };
    place();
    window.addEventListener('resize', place);
    document.fonts?.ready.then(place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, style: { width: style.width, transform: `translateX(${style.x}px)` } };
}

export function Tabs<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; label: ReactNode; count?: number }[] }) {
  const { ref, style } = useSlider<HTMLDivElement>('[aria-selected="true"]', [value, items.length]);
  return (
    <div className="tabs" role="tablist" ref={ref}>
      {items.map((it) => (
        <button key={it.key} role="tab" type="button" aria-selected={it.key === value} onClick={() => onChange(it.key)}>
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
  }, 4000);
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, 4250);
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
            {t.body && <span>{t.body}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal

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

// ------------------------------------------------------------------ misc

/** Re-render every `ms` (for clocks). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel panel-pad" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <h3>{title}</h3>
      {children && <div className="sub" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  return (
    <label className="search">
      <span className="sr">Search</span>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input ref={inputRef} type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <span className="kbd">/</span>
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
  toast('CSV ready', `${filename}, ${rows.length} rows.`);
}
