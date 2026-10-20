/**
 * The answer-key grid on the Problems page, kept apart from the screen so it
 * can be tested: what each row is called, what is wrong with a key, and how a
 * block copied from Google Sheets or Excel lands in the grid.
 *
 * Nothing here saves. Every function takes the round's rows and returns new ones.
 */
import katex from 'katex';
import type { Problem, RoundKind } from './model';
import { guessProblemMap, inferType, readAnswerType, splitAnswers } from './importers';
import { normalize } from './scoring/answers';

/** The grid's columns, in the order they appear. */
export type Col = 'number' | 'text' | 'answers' | 'type' | 'points' | 'set';

/** Makes a new, empty problem for a list (newProblem, bound to the round). */
export type Make = (list: Problem[], set?: number) => Problem;

// ------------------------------------------------------------------ reading

export const answersOf = (p: Pick<Problem, 'answers'>) => p.answers.map((a) => a.trim()).filter(Boolean);
export const isAnswered = (p: Pick<Problem, 'answers'>) => p.answers.some((a) => a.trim() !== '');
export const answersText = (p: Pick<Problem, 'answers'>) => answersOf(p).join(' | ');
/** "3/8 | 0.375" → ['3/8', '0.375']. Empty stays [''], as a new problem has. */
export const readAnswers = (v: string) => {
  const a = splitAnswers(v);
  return a.length ? a : [''];
};

/** Guts problems go by set: "2.3" is the third problem of set 2. */
export function labelOf(kind: RoundKind, list: Problem[], p: Problem): string {
  if (kind !== 'guts') return String(p.number);
  const set = p.set ?? 1;
  const k = list.filter((x) => (x.set ?? 1) === set).findIndex((x) => x.id === p.id);
  return `${set}.${k + 1}`;
}

/** How many problems a Guts set holds here: the first set's size once a second set exists, else 4. */
export function setSize(list: Problem[]): number {
  const sets = new Set(list.map((p) => p.set ?? 1));
  if (sets.size < 2) return Math.max(4, list.length);
  return list.filter((p) => (p.set ?? 1) === Math.min(...sets)).length || 4;
}

/** The set a new Guts problem goes into: the last one, or the next once the last is full. */
export function nextSet(list: Problem[]): number {
  if (!list.length) return 1;
  const last = Math.max(...list.map((p) => p.set ?? 1));
  return list.filter((p) => (p.set ?? 1) === last).length >= setSize(list) ? last + 1 : last;
}

/** An answer as the student portal draws it: "3/8" as a fraction, LaTeX as itself. */
export const texOf = (a: string) => (a.includes('\\') ? a : a.replace(/^(-?\d+)\/(\d+)$/, '\\frac{$1}{$2}').replace(/sqrt\(([^)]*)\)/g, '\\sqrt{$1}'));

/** Whether an answer reads as a whole number the way the marker reads one ("08", "1,000", "$12$"). */
export const isWhole = (a: string) => /^-?\d+$/.test(normalize(a, 'integer'));

export function readsAsMath(a: string): boolean {
  try {
    katex.renderToString(texOf(a), { throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

/** "7", "7.", "P7", "#7", "Problem 7"; in Guts also "2.3" (set 2, third problem). */
export function readNumber(v: string, guts: boolean): { n?: number; set?: number; k?: number } | null {
  const s = v.trim();
  if (guts) {
    const g = s.match(/^(?:set\s*)?(\d+)\s*[.-]\s*(\d+)$/i);
    if (g) return { set: Number(g[1]), k: Number(g[2]) };
  }
  const m = s.match(/^(?:problem|question|p|q|#|no\.?)?\s*(\d+)\s*[.):]?$/i);
  return m && Number(m[1]) > 0 ? { n: Number(m[1]) } : null;
}

// ------------------------------------------------------------------- checks

export type Fix = 'renumber' | 'expression' | 'integer';

export type KeyIssue = {
  key: string;
  /** 'warn' needs doing before the round; 'note' is worth a look. */
  tone: 'warn' | 'note';
  text: string;
  /** The problems it is about, to jump to. */
  ids: string[];
  fix?: Fix;
};

export type KeyCheck = {
  issues: KeyIssue[];
  /** What is wrong in one cell, for its outline and tooltip. */
  cells: Map<string, Partial<Record<Col, string>>>;
  /** Two problems share a number: the database keeps one per number, so nothing saves until fixed. */
  duplicates: boolean;
};

/** "4", "4 and 7", "4, 7 and 12", "4, 7, 12 and 5 more". */
export function listOf(items: string[], max = 6): string {
  if (items.length <= 1) return items.join('');
  if (items.length > max) return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** needsText: online students read the problem on screen, so it must have its text. On paper it is optional. */
export function checkKey(kind: RoundKind, rows: Problem[], opts: { needsText?: boolean } = {}): KeyCheck {
  const issues: KeyIssue[] = [];
  const cells = new Map<string, Partial<Record<Col, string>>>();
  const mark = (id: string, col: Col, why: string) => cells.set(id, { ...cells.get(id), [col]: why });
  const label = (p: Problem) => labelOf(kind, rows, p);

  const empty = rows.filter((p) => !isAnswered(p));
  empty.forEach((p) => mark(p.id, 'answers', 'No answer yet'));
  if (empty.length) {
    issues.push({
      key: 'empty', tone: 'warn', ids: empty.map((p) => p.id),
      text: `${empty.length === 1 ? 'Problem' : 'Problems'} ${listOf(empty.map(label))} ${empty.length === 1 ? 'has' : 'have'} no answer yet`,
    });
  }

  let duplicates = false;
  if (kind !== 'guts' && rows.length) {
    const count = new Map<number, number>();
    rows.forEach((p) => count.set(p.number, (count.get(p.number) ?? 0) + 1));
    const twice = [...count].filter(([, n]) => n > 1).map(([k]) => k).sort((a, b) => a - b);
    if (twice.length) {
      duplicates = true;
      const ids = rows.filter((p) => twice.includes(p.number)).map((p) => p.id);
      ids.forEach((id) => mark(id, 'number', 'Another problem has this number'));
      issues.push({
        key: 'dup', tone: 'warn', ids, fix: 'renumber',
        text: twice.length === 1 ? `Two problems are numbered ${twice[0]}` : `Numbers ${listOf(twice.map(String))} are each used more than once`,
      });
    } else if (rows.some((p, i) => p.number !== i + 1)) {
      const have = new Set(rows.map((p) => p.number));
      const missing = rows.map((_, i) => i + 1).filter((n) => !have.has(n));
      const off = rows.filter((p, i) => p.number !== i + 1);
      issues.push({
        key: 'order', tone: 'note', ids: off.map((p) => p.id), fix: 'renumber',
        text: missing.length
          ? `Numbers do not run 1 to ${rows.length}: ${listOf(missing.map(String))} ${missing.length === 1 ? 'is' : 'are'} missing`
          : `Numbers are out of order: students see the problems in the order of the rows`,
      });
    }
  }

  const notWhole = rows.filter((p) => p.answerType === 'integer' && answersOf(p).some((a) => !isWhole(a)));
  notWhole.forEach((p) => {
    const bad = answersOf(p).find((a) => !isWhole(a))!;
    mark(p.id, 'answers', `${bad} is not a whole number, but the answer type is Integer`);
    mark(p.id, 'type', 'The answers are not all whole numbers');
  });
  if (notWhole.length) {
    issues.push({
      key: 'int', tone: 'warn', ids: notWhole.map((p) => p.id), fix: 'expression',
      text: notWhole.length === 1
        ? `Problem ${label(notWhole[0])} is typed Integer, but its answer ${answersOf(notWhole[0]).find((a) => !isWhole(a))} is not a whole number`
        : `Problems ${listOf(notWhole.map((p) => `${label(p)} (${answersOf(p).find((a) => !isWhole(a))})`), 4)} are typed Integer, but their answers are not whole numbers`,
    });
  }

  const unreadable = rows.filter((p) => p.answerType === 'expression' && answersOf(p).some((a) => !readsAsMath(a)));
  unreadable.forEach((p) => mark(p.id, 'answers', `${answersOf(p).find((a) => !readsAsMath(a))} does not read as maths`));
  if (unreadable.length) {
    issues.push({
      key: 'tex', tone: 'warn', ids: unreadable.map((p) => p.id),
      text: `${listOf(unreadable.map((p) => `${label(p)} (${answersOf(p).find((a) => !readsAsMath(a))})`), 4)}: the answer does not read as maths; check the braces and backslashes`,
    });
  }

  const wholeExpr = rows.filter((p) => p.answerType === 'expression' && answersOf(p).length > 0 && answersOf(p).every(isWhole));
  if (wholeExpr.length) {
    issues.push({
      key: 'expr', tone: 'note', ids: wholeExpr.map((p) => p.id), fix: 'integer',
      text: `${listOf(wholeExpr.map(label))}: whole-number ${wholeExpr.length === 1 ? 'answer' : 'answers'} typed as Expression. Integer also accepts 08 and 1,000`,
    });
  }

  if (opts.needsText) {
    const bare = rows.filter((p) => !p.text.trim());
    bare.forEach((p) => mark(p.id, 'text', 'Online students need the text to see this problem'));
    if (bare.length) {
      issues.push({
        key: 'text', tone: 'warn', ids: bare.map((p) => p.id),
        text: `No text for ${listOf(bare.map(label))}: online students would see an empty problem`,
      });
    }
  }

  const dollars = rows.filter((p) => (p.text.match(/\$/g)?.length ?? 0) % 2 === 1);
  dollars.forEach((p) => mark(p.id, 'text', 'Unpaired $: some maths will not show'));
  if (dollars.length) {
    issues.push({
      key: 'dollar', tone: 'warn', ids: dollars.map((p) => p.id),
      text: `Unpaired $ in the text of ${listOf(dollars.map(label))}: some maths will not show`,
    });
  }

  return { issues, cells, duplicates };
}

// ------------------------------------------------------------- bulk changes

/** Guts: sets kept together in set order, numbered 1..n through the round. */
export function sortGuts(rows: Problem[]): Problem[] {
  const sorted = rows.map((p, i) => ({ p, i })).sort((a, b) => (a.p.set ?? 1) - (b.p.set ?? 1) || a.i - b.i).map((x) => x.p);
  return sorted.map((p, i) => (p.number === i + 1 ? p : { ...p, number: i + 1 }));
}

/** Numbers 1..n in the order of the rows (Guts: in set order). */
export function renumberRows(kind: RoundKind, rows: Problem[]): Problem[] {
  if (kind === 'guts') return sortGuts(rows);
  return rows.map((p, i) => (p.number === i + 1 ? p : { ...p, number: i + 1 }));
}

/** `count` empty problems at the end. Guts: filling the last set, or (newSets) starting new sets of the usual size. */
export function addBlank(kind: RoundKind, rows: Problem[], count: number, make: Make, newSets = false): { rows: Problem[]; ids: string[] } {
  let list = [...rows];
  const ids: string[] = [];
  const size = setSize(rows);
  const first = Math.max(0, ...rows.map((p) => p.set ?? 1)) + 1;
  for (let i = 0; i < count; i++) {
    const set = kind !== 'guts' ? undefined : newSets ? first + Math.floor(i / size) : nextSet(list);
    const prev = kind === 'guts' ? list.find((p) => p.set === set) : undefined;
    const p = { ...make(list, set), ...(prev ? { points: prev.points } : {}) };
    list = [...list, p];
    ids.push(p.id);
  }
  return { rows: kind === 'guts' ? sortGuts(list) : list, ids };
}

/** Guts: a problem moved into another set goes to the end of that set. */
export function moveToSet(rows: Problem[], id: string, set: number): Problem[] {
  const p = rows.find((x) => x.id === id);
  if (!p || (p.set ?? 1) === set) return rows;
  const rest = rows.filter((x) => x.id !== id);
  const at = rest.map((x) => x.set ?? 1).lastIndexOf(set);
  const next = [...rest];
  next.splice(at < 0 ? rest.length : at + 1, 0, { ...p, set });
  return sortGuts(next);
}

// -------------------------------------------------------------------- paste

/** Cells copied from Google Sheets or Excel: tabs between cells, quotes round a cell with a tab, quote or line break. */
export function parseTsv(text: string): string[][] {
  const s = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}

/** Whether text on the clipboard is a block of cells (rather than something to paste into one cell). */
export const isBlock = (text: string) => /\t/.test(text) || /\n./.test(text.replace(/\r/g, '').replace(/\n+$/, ''));

export type PasteShape = {
  /** What each pasted column fills; null leaves it out. */
  cols: (Col | null)[];
  /** Rows matched to problems by their number (a number column), rather than filled down from the selected cell. */
  keyed: boolean;
  header: boolean;
};

const COL_WORD: Record<Col, string> = { number: 'number', text: 'text', answers: 'answer', type: 'type', points: 'points', set: 'set' };
export const describeShape = (s: PasteShape) => s.cols.filter((c): c is Col => !!c).map((c) => COL_WORD[c]).join(', ');

/**
 * What a pasted block means. A header row names its columns; a first column of
 * distinct problem numbers means "number, answer" (or "number, text, answer,
 * points"); anything else fills the grid from the selected cell, across the
 * columns on screen.
 */
export function pasteShape(data: string[][], guts: boolean, from: Col, visible: Col[]): PasteShape {
  const width = Math.max(0, ...data.map((r) => r.length));
  const head = data[0] ?? [];
  const named = head.some((c) => /answer|problem|question|^\s*(#|no\.?|number|num)\s*$|points?|pts|^\s*text|key|^\s*set\b|type/i.test(c));
  if (named && data.length > 1 && !readNumber(head[0] ?? '', guts)) {
    const m = guessProblemMap(head);
    const cols: (Col | null)[] = head.map(() => null);
    if (m.number !== undefined) cols[m.number] = 'number';
    if (m.text !== undefined) cols[m.text] = 'text';
    if (m.answers !== undefined) cols[m.answers] = 'answers';
    if (m.points !== undefined) cols[m.points] = 'points';
    if (m.type !== undefined) cols[m.type] = 'type';
    if (m.set !== undefined && guts) cols[m.set] = 'set';
    // "Problem" over a column of 1, 2, 3 is the number, not the text.
    if (!cols.includes('number')) {
      const i = cols.findIndex((c, k) => c !== 'answers' && c !== 'points' && data.slice(1).every((r) => !(r[k] ?? '').trim() || readNumber(r[k], guts)));
      if (i >= 0) cols[i] = 'number';
    }
    if (cols.some(Boolean)) return { cols, keyed: cols.includes('number'), header: true };
  }
  if (width >= 2) {
    const firsts = data.map((r) => (r[0] ?? '').trim()).filter(Boolean);
    const nums = firsts.map((f) => readNumber(f, guts));
    const keys = nums.map((n) => (n ? (n.n !== undefined ? `${n.n}` : `${n.set}.${n.k}`) : ''));
    if (firsts.length === data.length && nums.every(Boolean) && new Set(keys).size === keys.length) {
      let cols: Col[];
      if (width === 2) cols = ['number', 'answers'];
      else if (width === 3) {
        const second = data.map((r) => (r[1] ?? '').trim()).filter(Boolean);
        const third = data.map((r) => (r[2] ?? '').trim()).filter(Boolean);
        const pointsLike = third.length > 0 && third.every((v) => /^\d{1,3}(\.\d+)?$/.test(v));
        const answerLike = second.every((v) => v.length <= 12 || !/\s/.test(v));
        cols = pointsLike && answerLike ? ['number', 'answers', 'points'] : ['number', 'text', 'answers'];
      } else cols = width === 4 ? ['number', 'text', 'answers', 'points'] : ['number', 'text', 'answers', 'points', 'type'];
      return { cols, keyed: true, header: false };
    }
  }
  const start = Math.max(0, visible.indexOf(from));
  return { cols: Array.from({ length: width }, (_, i) => visible[start + i] ?? null), keyed: false, header: false };
}

export type PasteResult = { rows: Problem[]; changed: number; added: number; ids: string[] };

/** Put one pasted value into a problem. Empty cells change nothing. */
function put(p: Problem, col: Col, raw: string, typed: boolean): Problem {
  const v = raw.trim();
  if (!v) return p;
  switch (col) {
    case 'number': return /^\d+$/.test(v) && Number(v) > 0 ? { ...p, number: Number(v) } : p;
    case 'text': return { ...p, text: v };
    case 'answers': {
      const answers = readAnswers(v);
      return typed ? { ...p, answers } : { ...p, answers, answerType: inferType(answers.filter(Boolean)) };
    }
    case 'type': return { ...p, answerType: readAnswerType(v) ?? p.answerType };
    case 'points': return /^\d+(\.\d+)?$/.test(v) ? { ...p, points: Number(v) } : p;
    case 'set': return /^\d+$/.test(v) && Number(v) > 0 ? { ...p, set: Number(v) } : p;
  }
}

/**
 * The rows after a paste. Keyed: each pasted row goes to the problem with its
 * number (new problems are made for numbers not in the round yet). Otherwise
 * rows fill down from row `at`, making problems past the last one.
 */
export function applyPaste(kind: RoundKind, rows: Problem[], data: string[][], shape: PasteShape, at: number, make: Make): PasteResult {
  const guts = kind === 'guts';
  const body = shape.header ? data.slice(1) : data;
  const typed = shape.cols.includes('type');
  let list = [...rows];
  const touched = new Set<string>();
  const made = new Set<string>();

  body.forEach((line, i) => {
    if (line.every((c) => !c.trim())) return;
    let target: Problem | undefined;
    let fresh: Problem | null = null;
    if (shape.keyed) {
      const ni = shape.cols.indexOf('number');
      const num = readNumber(line[ni] ?? '', guts);
      if (!num) return;
      const setCol = shape.cols.indexOf('set');
      const setGiven = setCol >= 0 ? Number((line[setCol] ?? '').trim()) || undefined : undefined;
      if (guts && num.set !== undefined) {
        target = list.filter((p) => (p.set ?? 1) === num.set)[num.k! - 1];
        if (!target) fresh = make(list, num.set);
      } else {
        target = list.find((p) => p.number === num.n);
        if (!target) {
          fresh = guts ? make(list, setGiven ?? Math.floor((num.n! - 1) / setSize(list)) + 1) : { ...make(list), number: num.n! };
        }
      }
    } else {
      target = list[at + i];
      if (!target) fresh = guts ? make(list, nextSet(list)) : make(list);
    }
    let p = target ?? fresh!;
    if (fresh && guts) {
      const prev = list.find((x) => x.set === fresh.set);
      if (prev) p = { ...p, points: prev.points };
    }
    const before = p;
    shape.cols.forEach((col, c) => {
      if (!col || (shape.keyed && col === 'number')) return;
      if (col === 'number' && guts) return;
      p = put(p, col, line[c] ?? '', typed);
    });
    if (fresh) {
      if (!guts) {
        // Keep numbers in order: a new number goes before the first larger one.
        const pos = shape.keyed ? list.findIndex((x) => x.number > p.number) : -1;
        list = pos < 0 ? [...list, p] : [...list.slice(0, pos), p, ...list.slice(pos)];
      } else list = [...list, p];
      made.add(p.id);
      touched.add(p.id);
    } else if (p !== before) {
      list = list.map((x) => (x.id === p.id ? p : x));
      touched.add(p.id);
    }
  });

  if (guts) list = sortGuts(list);
  return { rows: list, changed: [...touched].filter((id) => !made.has(id)).length, added: made.size, ids: [...touched] };
}

// ------------------------------------------------------------------ saving

/**
 * Connected, the database keeps one problem per number in a round and checks
 * it row by row as a save goes in. Returns the problems to park on unused
 * numbers first, or none when saving `next` in order is safe.
 */
export function needsParking(before: Problem[], next: Problem[]): Problem[] {
  const kept = new Set(next.map((p) => p.id));
  const was = new Map(before.map((p) => [p.id, p.number]));
  const holder = new Map<number, string>();
  for (const p of before) if (kept.has(p.id)) holder.set(p.number, p.id);
  const moved: Problem[] = [];
  let clash = false;
  for (const p of next) {
    const old = was.get(p.id);
    if (old === p.number) continue;
    if (old !== undefined) moved.push(p);
    const h = holder.get(p.number);
    if (h && h !== p.id) clash = true;
    if (old !== undefined && holder.get(old) === p.id) holder.delete(old);
    holder.set(p.number, p.id);
  }
  return clash ? moved : [];
}
