import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { linkedEdition, MODE_LABEL, newProblem, offers } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { AnswerType, Contest, DivisionMode, Problem, Round } from '../../lib/model';
import {
  addBlank, answersOf, answersText, applyPaste, checkKey, describeShape, isAnswered, isBlock, isWhole, labelOf, listOf, moveToSet, nextSet,
  parseTsv, pasteShape, readAnswers, renumberRows, setSize, sortGuts, type Col, type Fix, type Make,
} from '../../lib/problem-grid';
import { saveKey } from '../../lib/problem-save';
import { useAllDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Icon } from '../../components/icons';
import { AnswerPreview, Checkbox, EmptyState, MathText, Modal, State, Tabs, toast, useNow } from '../../components/ui';
import '../../styles/problems.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SAVE_MS = 600;

// ------------------------------------------------------------------- page

export function Problems() {
  const contest = useContest();
  const all = useAllDB();
  const [params, setParams] = useSearchParams();
  const round = contest.rounds.find((r) => r.id === params.get('round')) ?? contest.rounds[0];
  const total = contest.rounds.reduce((n, r) => n + r.problems.length, 0);
  const answered = contest.rounds.reduce((n, r) => n + r.problems.filter(isAnswered).length, 0);
  const other = linkedEdition(all, contest);

  // The tab underline measures its tab when the tab changes; when a count
  // in a label changes width, ask it to measure again.
  const counts = contest.rounds.map((r) => `${r.problems.filter(isAnswered).length}/${r.problems.length}`).join();
  useEffect(() => { window.dispatchEvent(new Event('resize')); }, [counts]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Problems</h1>
          <p className="page-sub">
            {!contest.rounds.length ? 'No rounds yet.'
              : !total ? 'Enter each round’s answer key. The problem text is optional for paper rounds.'
                : answered === total ? `All ${plural(total, 'problem')} in ${plural(contest.rounds.length, 'round')} have an answer.`
                  : `${answered} of ${plural(total, 'problem')} answered. ${total - answered} still ${total - answered === 1 ? 'needs one' : 'need one'} before the day.`}
          </p>
        </div>
        {round && (
          <div className="actions">
            <Link className="btn" to={`/staff/import?type=problems&round=${round.id}`}><Icon name="upload" />Import from a spreadsheet</Link>
            <Link className="btn" to={`/staff/preview/${round.id}`}><Icon name="eye" />Preview as a student</Link>
          </div>
        )}
      </div>

      {other && <EditionNote contest={contest} other={other} />}

      {!round ? (
        <section className="card">
          <EmptyState icon="sigma" title="No rounds yet" action={<Link className="btn btn-primary" to="/staff/rounds"><Icon name="rounds" />Go to Rounds</Link>}>
            Rounds are set when the contest is created. Each round’s problems and answer key are entered here.
          </EmptyState>
        </section>
      ) : (
        <>
          <Tabs
            value={round.id}
            onChange={(k) => setParams({ round: k }, { replace: true })}
            items={contest.rounds.map((r) => ({ key: r.id, label: <TabLabel round={r} /> }))}
          />
          <KeyEditor key={round.id} round={round} contest={contest} />
        </>
      )}
    </>
  );
}

function TabLabel({ round }: { round: Round }) {
  const n = round.problems.length;
  const a = round.problems.filter(isAnswered).length;
  const done = n > 0 && a === n;
  return (
    <span className="pr-tab">
      {round.name}
      <span className={`pr-tab-n ${done ? 'done' : n ? 'todo' : ''}`} title={n ? `${a} of ${n} problems have an answer` : 'No problems yet'}>
        {done && <Icon name="check" size={12} />}
        {n ? <>{a} of {n}<span className="hide-sm"> answered</span></> : 'empty'}
      </span>
    </span>
  );
}

/** The other edition keeps its own problems; say where they are copied over. */
function EditionNote({ contest, other }: { contest: Contest; other: Contest }) {
  const navigate = useNavigate();
  const mode: DivisionMode = contest.divisions[0]?.mode ?? 'in_person';
  const otherMode: DivisionMode = other.divisions[0]?.mode ?? (mode === 'online' ? 'in_person' : 'online');
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/staff/settings#taking-part');
    // Settings loads lazily: scroll to its section once it is there.
    let tries = 0;
    const find = () => {
      const el = document.getElementById('taking-part');
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else if (tries++ < 40) setTimeout(find, 50);
    };
    setTimeout(find, 50);
  };
  return (
    <p className="pr-edition">
      <Icon name="link" size={14} />
      <span>
        <b>{other.short} {MODE_LABEL[otherMode].toLowerCase()}</b> has its own copy of the problems, so changes here stay here.
        To bring its problems over: <a href="/staff/settings#taking-part" onClick={go}>Settings → How teams take part → Copy problems from it</a>.
      </span>
    </p>
  );
}

// ---------------------------------------------------------------- editor

type SaveState = 'idle' | 'pending' | 'saved' | 'held';
type Undo = { rows: Problem[]; label: string };

const keyOnlyKey = (roundId: string) => `mc.problems.keyOnly.${roundId}`;
function readKeyOnly(round: Round, paper: boolean): boolean {
  try {
    const v = localStorage.getItem(keyOnlyKey(round.id));
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* private window: fall through to the default */
  }
  return paper && round.problems.length > 0 && round.problems.every((p) => !p.text.trim());
}

const hasDuplicates = (rows: Problem[]) => new Set(rows.map((p) => p.number)).size !== rows.length;

function KeyEditor({ round, contest }: { round: Round; contest: Contest }) {
  const kind = round.kind;
  const guts = kind === 'guts';
  const online = offers(contest, 'online');

  // The rows being edited. The store catches up when a save goes out.
  const [rows, setRowsState] = useState<Problem[]>(round.problems);
  const rowsRef = useRef(rows);
  const [phantom, setPhantom] = useState(() => newProblem(round).id);
  const [active, setActive] = useState<string | null>(round.problems[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyOnly, setKeyOnlyState] = useState(() => readKeyOnly(round, !online));
  const [save, setSave] = useState<SaveState>('idle');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [epoch, setEpoch] = useState(0);
  const pending = useRef(false);
  const saving = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grid = useRef<HTMLTableElement>(null);

  const make: Make = (list, set) => newProblem({ ...round, problems: list }, set);

  // ---- saving: 600 ms after the typing stops, or when focus leaves the grid
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    const list = rowsRef.current;
    if (!guts && hasDuplicates(list)) {
      setSave('held');
      return;
    }
    pending.current = false;
    saving.current++;
    void saveKey(round.id, list).finally(() => { saving.current--; });
    setSave('saved');
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const commit = (next: Problem[], opts: { now?: boolean; reset?: boolean } = {}) => {
    rowsRef.current = next;
    setRowsState(next);
    pending.current = true;
    setSave('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_MS);
    if (opts.reset) setEpoch((e) => e + 1);
    if (opts.now) flush();
  };
  const change = (id: string, patch: Partial<Problem>) => commit(rowsRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Changed elsewhere (another tab, an import, a reload): follow it, unless mid-edit.
  useEffect(() => {
    if (pending.current || saving.current) return;
    if (round.problems === rowsRef.current) return;
    if (JSON.stringify(round.problems) === JSON.stringify(rowsRef.current)) return;
    rowsRef.current = round.problems;
    setRowsState(round.problems);
    setEpoch((e) => e + 1);
  }, [round.problems]);

  // Leaving the page or the round saves what is waiting.
  useEffect(() => {
    const out = () => flushRef.current();
    window.addEventListener('beforeunload', out);
    return () => {
      window.removeEventListener('beforeunload', out);
      if (timer.current) clearTimeout(timer.current);
      if (!pending.current) return;
      let list = rowsRef.current;
      if (!guts && hasDuplicates(list)) {
        list = renumberRows(kind, list);
        toast(`${round.name}: problems renumbered 1 to ${list.length}`, 'Two had the same number, and each needs its own to be saved.');
      }
      pending.current = false;
      void saveKey(round.id, list);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 15000);
    return () => clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (!flash.size) return;
    const t = setTimeout(() => setFlash(new Set()), 1400);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    document.body.classList.toggle('has-bulk', selected.size > 0);
    return () => document.body.classList.remove('has-bulk');
  }, [selected.size]);

  const setKeyOnly = (on: boolean) => {
    setKeyOnlyState(on);
    try { localStorage.setItem(keyOnlyKey(round.id), on ? '1' : '0'); } catch { /* this visit only */ }
  };

  // ---- what the grid shows
  const cols: Col[] = useMemo(() => {
    const c: Col[] = guts ? [] : ['number'];
    if (!keyOnly) c.push('text');
    c.push('answers', 'type', 'points');
    if (guts) c.push('set');
    return c;
  }, [guts, keyOnly]);
  const check = useMemo(() => checkKey(kind, rows, { needsText: online }), [kind, rows, online]);
  const labels = useMemo(() => new Map(rows.map((p) => [p.id, labelOf(kind, rows, p)])), [kind, rows]);
  const ghost: Problem = useMemo(() => {
    const set = guts ? nextSet(rows) : undefined;
    const prev = (guts ? rows.find((p) => p.set === set) : undefined) ?? rows[rows.length - 1];
    return { ...newProblem({ ...round, problems: rows }, set), id: phantom, points: prev?.points ?? (kind === 'team' ? 5 : 1) };
  }, [rows, phantom, guts]); // eslint-disable-line react-hooks/exhaustive-deps
  const ghostLabel = guts ? `${ghost.set}.${rows.filter((p) => p.set === ghost.set).length + 1}` : String(ghost.number);
  const shown = [...rows, ghost];
  const current = rows.find((p) => p.id === active) ?? rows[0];
  const answered = rows.filter(isAnswered).length;

  // ---- moving around like a spreadsheet
  const focusCell = (r: number, c: number) => {
    const el = grid.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-cell="${r}:${c}"]`);
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    else if (el instanceof HTMLInputElement) el.select();
    return true;
  };
  const focusRow = (id: string, col: Col = 'answers') => {
    // After the next render, when a row just added is there.
    requestAnimationFrame(() => {
      const el = grid.current?.querySelector<HTMLElement>(`tr[data-row="${id}"] [data-cell$=":${Math.max(0, cols.indexOf(col))}"]`);
      const at = el?.dataset.cell?.split(':').map(Number);
      if (at) focusCell(at[0], at[1]);
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement;
    const at = el.dataset.cell;
    if (!at || e.nativeEvent.isComposing) return;
    const [r, c] = at.split(':').map(Number);
    const last = shown.length - 1;
    const select = el instanceof HTMLSelectElement;
    const area = el instanceof HTMLTextAreaElement;
    const box = el as HTMLInputElement | HTMLTextAreaElement;
    const caretAt = (pos: 'start' | 'end') => {
      if (select) return true;
      const s = box.selectionStart ?? 0;
      const end = box.selectionEnd ?? 0;
      if (s !== end) return false;
      return pos === 'start' ? s === 0 : s === box.value.length;
    };
    const go = (nr: number, nc: number) => {
      e.preventDefault();
      if (nr < 0 || nr > last) return;
      focusCell(nr, Math.max(0, Math.min(cols.length - 1, nc)));
    };
    switch (e.key) {
      case 'Enter':
        if (area && (e.altKey || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          return;
        }
        return go(e.shiftKey ? r - 1 : r + 1, c);
      case 'Tab':
        if (e.shiftKey) {
          if (c > 0) return go(r, c - 1);
          if (r > 0) return go(r - 1, cols.length - 1);
          return;
        }
        if (c < cols.length - 1) return go(r, c + 1);
        if (r < last) return go(r + 1, 0);
        return;
      case 'ArrowDown':
        if (area && box.value.slice(box.selectionEnd ?? 0).includes('\n')) return;
        if (e.altKey && select) return;
        return go(r + 1, c);
      case 'ArrowUp':
        if (area && box.value.slice(0, box.selectionStart ?? 0).includes('\n')) return;
        if (e.altKey && select) return;
        return go(r - 1, c);
      case 'ArrowLeft':
        if (caretAt('start')) return go(r, c - 1);
        return;
      case 'ArrowRight':
        if (caretAt('end')) return go(r, c + 1);
        return;
    }
  };

  const onCellBlur = (e: React.FocusEvent) => {
    if (!grid.current?.contains(e.relatedTarget as Node | null)) flush();
  };

  // ---- editing one cell
  const createFromGhost = (patch: Partial<Problem>) => {
    const p: Problem = { ...ghost, ...patch };
    setPhantom(newProblem({ ...round, problems: [...rowsRef.current, p] }).id);
    setActive(p.id);
    commit(guts ? sortGuts([...rowsRef.current, p]) : [...rowsRef.current, p]);
  };
  const edit = (p: Problem, isGhost: boolean, patch: Partial<Problem>) => (isGhost ? createFromGhost(patch) : change(p.id, patch));

  const onEdit = (p: Problem, isGhost: boolean, col: Col, raw: string) => {
    const v = raw.trim();
    if (col === 'number') { if (/^\d+$/.test(v) && Number(v) > 0) edit(p, isGhost, { number: Number(v) }); return; }
    if (col === 'text') return edit(p, isGhost, { text: raw });
    if (col === 'answers') return edit(p, isGhost, { answers: readAnswers(raw) });
    if (col === 'points') { if (/^\d+(\.\d+)?$/.test(v)) edit(p, isGhost, { points: Number(v) }); return; }
    if (col === 'set' && isGhost && /^\d+$/.test(v) && Number(v) > 0) createFromGhost({ set: Number(v) });
  };
  const onDone = (p: Problem, col: Col, raw: string, before: string) => {
    const now = rowsRef.current.find((x) => x.id === p.id);
    if (!now) return;
    // A first answer that is not a whole number makes the problem an expression.
    if (col === 'answers' && !before.trim() && now.answerType === 'integer') {
      const a = readAnswers(raw).filter(Boolean);
      if (a.length && a.some((x) => !isWhole(x))) change(p.id, { answerType: 'expression' });
    }
    if (col === 'set') {
      const v = raw.trim();
      if (/^\d+$/.test(v) && Number(v) > 0 && Number(v) !== (now.set ?? 1)) commit(moveToSet(rowsRef.current, p.id, Number(v)), { reset: true });
    }
  };

  // ---- paste a block from a spreadsheet
  const pasteBlock = (text: string, r: number, col: Col) => {
    const data = parseTsv(text);
    if (!data.length) return;
    const shape = pasteShape(data, guts, col, cols);
    const before = rowsRef.current;
    const res = applyPaste(kind, before, data, shape, Math.min(r, before.length), make);
    if (!res.changed && !res.added) {
      toast('Nothing pasted', 'The block had no values the grid could use.');
      return;
    }
    commit(res.rows, { reset: true, now: true });
    setFlash(new Set(res.ids));
    const lines = data.length - (shape.header ? 1 : 0);
    const what = [res.changed && `${plural(res.changed, 'problem')} changed`, res.added && `${res.added} added`].filter(Boolean).join(', ');
    setUndo({ rows: before, label: `Pasted ${plural(lines, 'row')}` });
    toast(`Pasted ${plural(lines, 'row')}`, `Read as ${describeShape(shape)}${shape.keyed ? ', matched by number' : ''}: ${what}.`, 'g');
  };
  const pasteRef = useRef(pasteBlock);
  pasteRef.current = pasteBlock;

  const onPaste = (e: React.ClipboardEvent) => {
    const el = e.target as HTMLElement;
    const at = el.dataset.cell;
    if (!at) return;
    const text = e.clipboardData.getData('text/plain');
    if (!isBlock(text)) return;
    const [r, c] = at.split(':').map(Number);
    // Several lines without tabs in the text cell: a problem statement with line breaks.
    if (cols[c] === 'text' && !text.includes('\t')) return;
    e.preventDefault();
    pasteBlock(text, r, cols[c]);
  };

  // A block pasted with nothing selected lands in the grid too.
  useEffect(() => {
    const onDocPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .modal')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      pasteRef.current(text, 0, 'answers');
    };
    document.addEventListener('paste', onDocPaste);
    return () => document.removeEventListener('paste', onDocPaste);
  }, []);

  // ---- bulk changes
  const withUndo = (next: Problem[], label: string, ids: string[] = []) => {
    setUndo({ rows: rowsRef.current, label });
    commit(next, { reset: true, now: true });
    if (ids.length) setFlash(new Set(ids));
  };
  const add = (count: number, newSets = false) => {
    const { rows: next, ids } = addBlank(kind, rowsRef.current, count, make, newSets);
    commit(next, { reset: true });
    setFlash(new Set(ids));
    if (ids[0]) { setActive(ids[0]); focusRow(ids[0]); }
  };
  const renumber = () => withUndo(renumberRows(kind, rowsRef.current), `Renumbered 1 to ${rowsRef.current.length}`);
  const applyFix = (fix: Fix, ids: string[]) => {
    if (fix === 'renumber') return renumber();
    const type: AnswerType = fix === 'expression' ? 'expression' : 'integer';
    withUndo(rowsRef.current.map((p) => (ids.includes(p.id) ? { ...p, answerType: type } : p)), `${plural(ids.length, 'problem')} set to ${type === 'integer' ? 'Integer' : 'Expression'}`, ids);
  };
  const setType = (ids: string[], type: AnswerType) => {
    withUndo(rowsRef.current.map((p) => (ids.includes(p.id) ? { ...p, answerType: type } : p)), `${plural(ids.length, 'problem')} set to ${type === 'integer' ? 'Integer' : 'Expression'}`, ids);
  };
  const remove = (ids: string[]) => {
    const before = rowsRef.current;
    const clean = before.every((p, i) => p.number === i + 1);
    let next = before.filter((p) => !ids.includes(p.id));
    // Numbers that ran 1..n keep running 1..n.
    if (guts) next = sortGuts(next);
    else if (clean) next = renumberRows(kind, next);
    setUndo({ rows: before, label: `Removed ${plural(ids.length, 'problem')}` });
    commit(next, { reset: true, now: true });
    setSelected(new Set());
    setRemoving(null);
    if (ids.includes(active ?? '')) setActive(next[0]?.id ?? null);
  };
  const askRemove = (ids: string[]) => {
    const list = rowsRef.current.filter((p) => ids.includes(p.id));
    if (list.every((p) => !p.text.trim() && !isAnswered(p))) remove(ids);
    else setRemoving(ids);
  };
  const restore = () => {
    if (!undo) return;
    commit(undo.rows, { reset: true, now: true });
    setUndo(null);
    toast('Undone', undo.label);
  };
  const copyKey = async () => {
    const lines = [['Number', 'Text', 'Answers', 'Type', 'Points', ...(guts ? ['Set'] : [])], ...rows.map((p) => [labels.get(p.id) ?? '', p.text.replace(/\s*\n\s*/g, ' '), answersText(p), p.answerType, String(p.points), ...(guts ? [String(p.set ?? 1)] : [])])];
    try {
      await navigator.clipboard.writeText(lines.map((l) => l.join('\t')).join('\n'));
      toast('Answer key copied', 'Paste it into Google Sheets or Excel.', 'g');
    } catch {
      toast('Could not copy', 'Your browser did not allow it.', 'r');
    }
  };

  const allChecked: boolean | 'mixed' = selected.size === 0 ? false : selected.size === rows.length ? true : 'mixed';
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const points = [...new Set(rows.map((p) => p.points))];
  const pointsText = !rows.length ? '' : points.length === 1 ? `${plural(points[0], 'point')} each` : `${Math.min(...points)} to ${Math.max(...points)} points`;
  const sel = [...selected].filter((id) => rows.some((p) => p.id === id));

  return (
    <div className="pr">
      <div className={`pr-layout ${rows.length ? '' : 'empty'}`}>
        <section className="card flush pr-sheet">
          <div className="pr-head">
            <div className="pr-head-main">
              <RoundClock round={round} contest={contest} />
              <span className="pr-meta">
                {plural(rows.length, 'problem')}
                {pointsText && <> · {pointsText}</>}
                {rows.length > answered && <> · <span className="pr-amber">{rows.length - answered} without an answer</span></>}
              </span>
              <SaveMark state={save} />
            </div>
            <div className="pr-head-tools">
              <label className="pr-switch" title="Hide the problem text column: for paper rounds, the key is all MathCloud needs">
                <input type="checkbox" role="switch" checked={keyOnly} onChange={(e) => setKeyOnly(e.target.checked)} />
                <span className="pr-switch-track" aria-hidden="true"><i /></span>
                Answer key only
              </label>
              <AddMenu guts={guts} size={guts ? setSize(rows) : 0} onAdd={add} />
              <Menu label="More" icon="more">
                {(close) => (
                  <>
                    <button type="button" role="menuitem" className="menu-item" disabled={!rows.length} onClick={() => { close(); renumber(); }}>
                      <span className="row"><Icon name="refresh" />{guts ? 'Put the sets in order' : `Renumber 1 to ${rows.length}`}</span><small>in row order</small>
                    </button>
                    <button type="button" role="menuitem" className="menu-item" disabled={!rows.length} onClick={() => { close(); setSelected(new Set(rows.map((p) => p.id))); }}>
                      <span className="row"><Icon name="checklist" />Select all</span>
                    </button>
                    <button type="button" role="menuitem" className="menu-item" disabled={!rows.length} onClick={() => { close(); void copyKey(); }}>
                      <span className="row"><Icon name="copy" />Copy the key as a table</span>
                    </button>
                  </>
                )}
              </Menu>
            </div>
          </div>

          {undo && (
            <div className="pr-undo" role="status">
              <Icon name="undo" size={14} />
              <span>{undo.label}.</span>
              <button type="button" className="linkbtn" onClick={restore}>Undo</button>
            </div>
          )}

          <Issues issues={check.issues} roundState={roundState(round)} labels={labels} onJump={(id) => { setActive(id); focusRow(id); }} onFix={applyFix} held={save === 'held'} />

          {!rows.length ? (
            <EmptyState
              icon="sigma"
              title={`No problems in ${round.name} yet`}
              action={
                <>
                  <button className="btn btn-primary" type="button" onClick={() => add(guts ? 24 : kind === 'team' ? 10 : 20, guts)}>
                    <Icon name="plus" />{guts ? 'Add 6 sets of 4' : `Add ${kind === 'team' ? 10 : 20} problems`}
                  </button>
                  <Link className="btn" to={`/staff/import?type=problems&round=${round.id}`}><Icon name="upload" />Import a file</Link>
                </>
              }
            >
              Start with empty rows and type the answers, or copy the number and answer columns from Google Sheets or Excel and paste them anywhere on this page.
            </EmptyState>
          ) : (
            <div className="pr-scroll">
              <table className={`pr-grid ${keyOnly ? 'key-only' : ''} ${guts ? 'guts' : ''}`} ref={grid} onKeyDown={onKey} onPaste={onPaste} role="grid" aria-label={`${round.name} answer key`}>
                <thead>
                  <tr>
                    <th className="pr-c-cb"><Checkbox checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((p) => p.id)))} label="Select all problems" /></th>
                    <th className="pr-c-num" title={guts ? 'Set and place in the set' : undefined}>No.</th>
                    {!keyOnly && <th className="pr-c-text" title="Optional on paper. Maths between $…$. Alt+Enter for a new line.">Problem text <span className="pr-opt">{online ? '' : 'optional'}</span></th>}
                    <th className="pr-c-ans" title="Any one of these is marked correct. Separate forms with |">Accepted answers</th>
                    <th className="pr-c-type">Type</th>
                    <th className="pr-c-pts">Points</th>
                    {guts && <th className="pr-c-set">Set</th>}
                    <th className="pr-c-act"><span className="sr">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p, r) => {
                    const isGhost = p.id === phantom && !rows.some((x) => x.id === p.id);
                    const issues = isGhost ? {} : check.cells.get(p.id) ?? {};
                    const label = isGhost ? ghostLabel : labels.get(p.id) ?? '';
                    const cell = (col: Col, value: string, extra: Partial<CellProps> = {}) => {
                      const c = cols.indexOf(col);
                      return (
                        <Cell
                          key={col} id={p.id} r={r} c={c} col={col} value={value} epoch={epoch} issue={issues[col]}
                          label={`${col === 'answers' ? 'Answers' : col === 'text' ? 'Text' : col === 'points' ? 'Points' : col === 'set' ? 'Set' : 'Number'} for problem ${label}${isGhost ? ' (new)' : ''}`}
                          onFocus={() => !isGhost && setActive(p.id)} onBlur={onCellBlur}
                          onEdit={(v) => onEdit(p, isGhost, col, v)} onDone={(v, before) => !isGhost && onDone(p, col, v, before)}
                          {...extra}
                        />
                      );
                    };
                    return (
                      <tr
                        key={p.id}
                        data-row={p.id}
                        className={[isGhost ? 'ghost' : '', !isGhost && current?.id === p.id ? 'on' : '', selected.has(p.id) ? 'sel' : '', flash.has(p.id) ? 'flash' : ''].join(' ')}
                        onMouseDown={() => !isGhost && setActive(p.id)}
                      >
                        <td className="pr-c-cb">{!isGhost && <Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} label={`Select problem ${label}`} />}</td>
                        {guts ? (
                          <td className="pr-c-num"><span className="pr-label mono">{label}</span></td>
                        ) : (
                          cell('number', isGhost ? '' : String(p.number), { numeric: true, placeholder: isGhost ? String(p.number) : '', className: 'pr-c-num' })
                        )}
                        {!keyOnly && cell('text', p.text, { area: true, placeholder: isGhost ? (rows.length ? 'Type here to add a problem' : 'Problem text') : online ? 'Text students read' : 'Optional', className: 'pr-c-text' })}
                        {cell('answers', answersText(p), { placeholder: isGhost ? 'New answer' : 'No answer yet', chips: answersOf(p), int: p.answerType === 'integer', className: 'pr-c-ans' })}
                        <td className={`pr-c-type ${issues.type ? 'has-issue' : ''}`} title={issues.type}>
                          <select
                            className="pr-in" data-cell={`${r}:${cols.indexOf('type')}`} value={p.answerType} aria-label={`Answer type for problem ${label}`}
                            onFocus={() => !isGhost && setActive(p.id)} onBlur={onCellBlur}
                            onChange={(e) => edit(p, isGhost, { answerType: e.target.value as AnswerType })}
                          >
                            <option value="integer">Integer</option>
                            <option value="expression">Expression</option>
                          </select>
                        </td>
                        {cell('points', isGhost ? '' : String(p.points), { numeric: true, placeholder: isGhost ? String(p.points) : '0', className: 'pr-c-pts' })}
                        {guts && cell('set', isGhost ? '' : String(p.set ?? 1), { numeric: true, placeholder: String(p.set ?? 1), className: 'pr-c-set' })}
                        <td className="pr-c-act">
                          {!isGhost && (
                            <button type="button" className="icon-btn pr-del" tabIndex={-1} aria-label={`Remove problem ${label}`} title="Remove" onClick={() => askRemove([p.id])}>
                              <Icon name="trash" size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <p className="pr-foot">
              <Icon name="table" size={14} />
              <span>Separate accepted forms with | (3/8 | 0.375). Enter and Tab move between cells; type in the last row to add a problem. Paste columns from Google Sheets or Excel: number and answer, or number, text, answer and points.</span>
            </p>
          )}
        </section>

        {rows.length > 0 && <Preview round={round} p={current} label={current ? labels.get(current.id) ?? '' : ''} online={online} />}
      </div>

      <div className={`bulk ${sel.length ? 'show' : ''}`} role="toolbar" aria-label="Selected problems">
        <span className="n">{sel.length || 1} selected</span>
        <button type="button" onClick={() => setType(sel, 'integer')}>Integer</button>
        <button type="button" onClick={() => setType(sel, 'expression')}>Expression</button>
        <button type="button" className="pr-bulk-danger" onClick={() => askRemove(sel)}>Remove</button>
        <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>

      {removing && (
        <Modal
          title={removing.length === 1 ? `Remove problem ${labels.get(removing[0]) ?? ''}?` : `Remove ${removing.length} problems?`}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn btn-danger" type="button" onClick={() => remove(removing)}><Icon name="trash" size={14} />Remove {removing.length === 1 ? 'problem' : `${removing.length} problems`}</button>
            </>
          }
        >
          <p>
            {removing.length === 1 ? 'Its text and answers go' : `Problems ${listOf(removing.map((id) => labels.get(id) ?? ''), 8)} go, with their text and answers`}.
            Answers students already gave to {removing.length === 1 ? 'it' : 'them'} stop counting.
            {!guts && rows.every((p, i) => p.number === i + 1) ? ' The problems after move up a number.' : ''} You can undo straight after.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ cells

type CellProps = {
  id: string; r: number; c: number; col: Col; value: string; epoch: number; label: string;
  area?: boolean; numeric?: boolean; placeholder?: string; issue?: string; className?: string;
  /** Answers: shown as chips, drawn as maths, until the cell is being edited. */
  chips?: string[]; int?: boolean;
  onFocus: () => void; onBlur: (e: React.FocusEvent) => void;
  onEdit: (v: string) => void; onDone?: (v: string, before: string) => void;
};

/**
 * One cell: always an input, so moving and typing is instant. While it has
 * focus it keeps exactly what was typed ("3/8 |" stays as typed); the round
 * hears each change, and the cell shows the saved value again when it is left.
 */
function Cell({ r, c, col, value, epoch, label, area, numeric, placeholder, issue, className, chips, int, onFocus, onBlur, onEdit, onDone }: CellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const before = useRef('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = draft ?? value;

  // A paste or an undo while this cell is open: show the new value.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setDraft((d) => {
      if (d === null) return d;
      before.current = value;
      return value;
    });
  }, [epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // The text cell grows with what is in it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [shown, draft === null]);

  const common = {
    className: 'pr-in',
    'data-cell': `${r}:${c}`,
    value: shown,
    placeholder,
    'aria-label': label,
    'aria-invalid': issue ? true : undefined,
    title: issue,
    spellCheck: col === 'text',
    autoComplete: 'off',
    onFocus: () => { before.current = value; setDraft(value); onFocus(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(e.target.value); onEdit(e.target.value); },
    onBlur: (e: React.FocusEvent) => { if (draft !== null) onDone?.(draft, before.current); setDraft(null); onBlur(e); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && draft !== null && draft !== before.current) {
        e.stopPropagation();
        setDraft(before.current);
        onEdit(before.current);
      }
    },
  };
  const masked = !!chips?.length && draft === null;
  return (
    <td className={`${className ?? ''} ${issue ? 'has-issue' : ''}`}>
      {area ? (
        <textarea {...common} ref={ref} rows={1} />
      ) : (
        <input {...common} inputMode={numeric ? 'decimal' : undefined} className={`pr-in ${masked ? 'masked' : ''}`} />
      )}
      {masked && (
        <span className="pr-chips" aria-hidden="true">
          {chips!.map((a, i) => (
            <span key={i} className={`pr-chip ${int && !isWhole(a) ? 'warn' : ''}`}>
              {/^-?\d+$/.test(a) ? <span className="mono">{a}</span> : <AnswerPreview value={a} />}
            </span>
          ))}
        </span>
      )}
    </td>
  );
}

// ------------------------------------------------------------ the rest

function SaveMark({ state }: { state: SaveState }) {
  if (state === 'held') return <span className="pr-save held" title="Each problem needs its own number before the key can be saved"><Icon name="alert" size={14} />Not saved yet</span>;
  if (state === 'pending') return <span className="pr-save pending"><i />Saving…</span>;
  if (state === 'saved') return <span className="pr-save saved" key="saved"><Icon name="check" size={14} />Saved</span>;
  return <span className="pr-save idle">Saves as you type</span>;
}

function RoundClock({ round, contest }: { round: Round; contest: Contest }) {
  const now = useNow(1000);
  const state = roundState(round, now);
  const ends = roundEnds(round);
  if (state === 'open' && ends) return <State tone="go">Open · {duration(ends - now)} left</State>;
  if (state === 'closed') return <State tone="ok">Finished</State>;
  return <State tone="off">Starts {clockIn(round.startsAt, contest.timeZone)}</State>;
}

function Issues({ issues, roundState: state, labels, onJump, onFix, held }: {
  issues: ReturnType<typeof checkKey>['issues']; roundState: 'scheduled' | 'open' | 'closed'; labels: Map<string, string>;
  onJump: (id: string) => void; onFix: (fix: Fix, ids: string[]) => void; held: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = open ? issues : issues.slice(0, 4);
  const FIX: Record<Fix, string> = { renumber: 'Renumber', expression: 'Change to Expression', integer: 'Change to Integer' };
  if (!issues.length && state === 'scheduled') return null;
  return (
    <div className="pr-issues">
      {state !== 'scheduled' && (
        <p className="pr-issue info">
          <Icon name="info" size={14} />
          <span>{state === 'open' ? 'This round is open. A changed answer re-marks every answer given so far, straight away.' : 'This round is over. A changed answer re-marks the answers already given.'}</span>
        </p>
      )}
      {list.map((i) => (
        <p key={i.key} className={`pr-issue ${i.tone}`}>
          <Icon name={i.tone === 'warn' ? 'alert' : 'info'} size={14} />
          <span>
            {i.text}.{i.key === 'dup' && held && <b> Not saved until each has its own number.</b>}{' '}
            {i.ids.length > 0 && i.key !== 'order' && (
              <button type="button" className="linkbtn" onClick={() => onJump(i.ids[0])}>Go to {labels.get(i.ids[0])}</button>
            )}
          </span>
          {i.fix && <button type="button" className="btn btn-sm" onClick={() => onFix(i.fix!, i.ids)}>{FIX[i.fix]}</button>}
        </p>
      ))}
      {issues.length > 4 && (
        <button type="button" className="linkbtn small pr-more" onClick={() => setOpen((o) => !o)}>{open ? 'Show fewer' : `Show ${issues.length - 4} more`}</button>
      )}
    </div>
  );
}

/** The selected problem, drawn the way the student portal draws it. */
function Preview({ round, p, label, online }: { round: Round; p: Problem | undefined; label: string; online: boolean }) {
  if (!p) return null;
  const answers = answersOf(p);
  return (
    <aside className="card pr-preview" aria-label="Preview of the selected problem">
      <div className="pr-pv-head">
        <span className="label"><Icon name="eye" size={14} />As students see it</span>
        <Link className="small" to={`/staff/preview/${round.id}`}>Whole round<Icon name="arrow-up-right" size={13} /></Link>
      </div>
      <div className="pr-pv-q" key={p.id}>
        <span className="pr-pv-num mono">{label}</span>
        <div className="pr-pv-text">
          {p.text.trim() ? <MathText text={p.text} /> : <span className="muted">{online ? 'No text yet: online students would see nothing here.' : 'No text: on paper, students read it from the booklet.'}</span>}
        </div>
        <div className="pr-pv-box"><span>Answer</span></div>
      </div>
      <div className="pr-pv-key">
        <span className="label">Marked correct</span>
        {answers.length ? (
          <span className="pr-pv-chips">
            {answers.map((a, i) => (
              <span key={i} className={`pr-chip ${p.answerType === 'integer' && !isWhole(a) ? 'warn' : ''}`}>
                <span className="mono">{a}</span>
                {!/^-?\d+$/.test(a) && <AnswerPreview value={a} />}
              </span>
            ))}
          </span>
        ) : <span className="pr-none">No answer yet</span>}
        <p className="muted tiny">
          {plural(p.points, 'point')} · {p.answerType === 'integer'
            ? 'Integer: leading zeros and 1,000-style commas still match.'
            : 'Expression: spaces and LaTeX are tidied before matching; list other forms (0.375) as extra answers.'}
        </p>
      </div>
    </aside>
  );
}

function AddMenu({ guts, size, onAdd }: { guts: boolean; size: number; onAdd: (n: number, newSets?: boolean) => void }) {
  const [n, setN] = useState('');
  const counts = [...new Set(guts ? [1, size, size * 2] : [1, 5, 10, 20])];
  return (
    <Menu label="Add problems" icon="plus" text="Add">
      {(close) => (
        <>
          {counts.map((k) => (
            <button key={k} type="button" role="menuitem" className="menu-item" onClick={() => { close(); onAdd(k, guts && k > 1); }}>
              <span>{guts && k > 1 ? `${k / size === 1 ? 'A set' : `${k / size} sets`} of ${size}` : plural(k, 'problem')}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <form className="pr-add-n" onSubmit={(e) => { e.preventDefault(); const k = Math.min(200, Math.floor(Number(n))); if (k > 0) { close(); onAdd(k); setN(''); } }}>
            <input className="input input-sm" type="number" min={1} max={200} value={n} onChange={(e) => setN(e.target.value)} placeholder="How many" aria-label="How many problems to add" />
            <button className="btn btn-sm" type="submit" disabled={!(Number(n) > 0)}>Add</button>
          </form>
        </>
      )}
    </Menu>
  );
}

/** A small menu (same look as the user menu). */
function Menu({ label, icon, text, children }: { label: string; icon: 'more' | 'plus'; text?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`menu-wrap pr-menu ${open ? 'is-open' : ''}`} ref={ref}>
      {text ? (
        <button type="button" className="btn btn-sm" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name={icon} size={14} />{text}<Icon name="chevron" size={13} /></button>
      ) : (
        <button type="button" className="icon-btn" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name={icon} size={17} /></button>
      )}
      {open && <div className="menu down" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
