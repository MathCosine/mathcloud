import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/icons';
import { toast } from '../../../components/ui';

/** Where the text comes from: a dropped or chosen file, pasted rows, or a sample. */
export function Source({
  onLoad, samples, hint, pasteLabel, pastePlaceholder, accept = /\.(csv|tsv|txt)$/i, title = 'Drop a CSV here',
}: {
  onLoad: (text: string, name: string) => void;
  samples?: { label: string; text: string; name: string }[];
  hint: ReactNode;
  pasteLabel?: string;
  pastePlaceholder?: string;
  accept?: RegExp;
  title?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (!accept.test(f.name)) return toast('That is not a CSV', 'In Google Sheets or Excel: File, Download, Comma-separated values.', 'r');
    f.text().then((t) => onLoad(t, f.name));
  };
  if (paste) {
    return (
      <div className="stack">
        <label className="field">
          <span>{pasteLabel ?? 'Paste the rows, header first'}</span>
          <textarea className="textarea mono imp-paste" autoFocus placeholder={pastePlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={!text.trim()} onClick={() => onLoad(text, 'pasted text')}>Continue</button>
          <button className="btn btn-quiet" type="button" onClick={() => setPaste(false)}>Back</button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}
    >
      <span className="ic"><Icon name="upload" size={22} /></span>
      <b>{title}</b>
      <span className="soft small">{hint}</span>
      <div className="row wrap" style={{ justifyContent: 'center', marginTop: 6 }}>
        <button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()}>Choose a file</button>
        <button className="btn" type="button" onClick={() => setPaste(true)}>Paste instead</button>
        {samples?.map((s) => (
          <button key={s.label} className="btn btn-quiet" type="button" onClick={() => onLoad(s.text, s.name)}>{s.label}</button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

/** One "which column is this" select, with an example value from the file. */
export function ColumnSelect({ label, required, value, headers, sample, onChange }: {
  label: ReactNode; required?: boolean; value: number | undefined; headers: string[]; sample: string; onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="field">
      <span>{label}{required && <em className="muted" style={{ fontStyle: 'normal', fontWeight: 500 }}>needed</em>}</span>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} style={required && value === undefined ? { borderColor: 'var(--amber)' } : undefined}>
        <option value="">Not in the file</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
      <small className="sample-col">{sample ? `e.g. ${sample}` : ' '}</small>
    </label>
  );
}

/** First non-empty value in a column, for the "e.g." under a select. */
export const sampleOf = (rows: string[][], i: number | undefined) => (i === undefined ? '' : rows.slice(1).map((r) => r[i]).find((x) => x) ?? '');

/** The four steps, so it is clear where you are and that nothing is saved yet. */
export function Steps({ at, onRestart, steps = ['File', 'Columns', 'Check and import'] }: { at: 1 | 2 | 3; onRestart?: () => void; steps?: string[] }) {
  return (
    <div className="imp-steps-row">
      <ol className="imp-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={i + 1 < at ? 'done' : i + 1 === at ? 'now' : ''} aria-current={i + 1 === at ? 'step' : undefined}>
            <span className="n">{i + 1 < at ? <Icon name="check" size={12} /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      {onRestart && <button className="btn btn-sm btn-quiet" type="button" onClick={onRestart}>Choose another file</button>}
    </div>
  );
}

/** "12 new · 3 updates · 2 skipped" */
export function Tally({ items }: { items: { n: number; label: string; tone?: 'g' | 'b' | 'a' | 'r' | '' }[] }) {
  return (
    <span className="imp-tally">
      {items.filter((x) => x.n > 0 || !x.tone).map((x) => (
        <span key={x.label} className={x.tone ? `t-${x.tone}` : ''}><b>{x.n}</b> {x.label}</span>
      ))}
    </span>
  );
}

export function Issues({ errors, warnings, notes, ok = 'Ready' }: { errors: string[]; warnings: string[]; notes?: string[]; ok?: string }) {
  return (
    <>
      {ok && errors.length === 0 && warnings.length === 0 && !notes?.length && <span className="state ok">{ok}</span>}
      <ul className="issues">
        {errors.map((e) => <li key={e} className="e">{e}</li>)}
        {warnings.map((w) => <li key={w} className="w">{w}</li>)}
        {notes?.map((n) => <li key={n} className="n">{n}</li>)}
      </ul>
    </>
  );
}

// ------------------------------------------------------------- pictures

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function ArtTeams() {
  return (
    <svg viewBox="0 0 72 52" aria-hidden="true">
      <rect x="4" y="6" width="40" height="40" rx="4" {...S} />
      <path d="M4 16h40M4 26h40M4 36h40M18 6v40" {...S} opacity=".55" />
      <circle cx="56" cy="20" r="5" {...S} className="a" />
      <circle cx="63" cy="31" r="4" {...S} className="a" />
      <path d="M48 40c1.5-6 5-9 8-9s6.5 3 8 9" {...S} className="a" />
    </svg>
  );
}

export function ArtStudents() {
  return (
    <svg viewBox="0 0 72 52" aria-hidden="true">
      <circle cx="12" cy="18" r="5" {...S} className="a" />
      <path d="M4 36c1.5-6 4.5-9 8-9s6.5 3 8 9" {...S} className="a" />
      <path d="M24 26h14m-4-4l4 4-4 4" {...S} />
      <rect x="42" y="8" width="26" height="36" rx="5" {...S} />
      <path d="M48 18h14M48 26h14M48 34h8" {...S} opacity=".55" />
    </svg>
  );
}

export function ArtProblems() {
  return (
    <svg viewBox="0 0 72 52" aria-hidden="true">
      <rect x="10" y="4" width="36" height="44" rx="4" {...S} />
      <path d="M17 14h3M24 14h16M17 24h3M24 24h12M17 34h3M24 34h14" {...S} opacity=".55" />
      <rect x="44" y="20" width="22" height="14" rx="3" {...S} className="a" />
      <path d="M49 27.5l2.5 2.5 5-6" {...S} className="a" />
    </svg>
  );
}

export function ArtSheets() {
  return (
    <svg viewBox="0 0 72 52" aria-hidden="true">
      <rect x="6" y="4" width="36" height="44" rx="4" {...S} />
      <path d="M12 12h12" {...S} opacity=".55" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x="12" y={18 + i * 7} width="8" height="5" rx="1" {...S} opacity=".55" />)}
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M24 ${20.5 + i * 7}h12`} {...S} opacity=".35" />)}
      <path d="M52 40l12-24 4 2-12 24-5 2z" {...S} className="a" />
    </svg>
  );
}
