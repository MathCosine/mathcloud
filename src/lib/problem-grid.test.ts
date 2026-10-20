import { describe, expect, it } from 'vitest';
import type { Problem } from './model';
import {
  addBlank, applyPaste, checkKey, isBlock, labelOf, moveToSet, needsParking, parseTsv, pasteShape, readNumber, renumberRows, type Make,
} from './problem-grid';

let n = 0;
const p = (number: number, answers: string[], extra: Partial<Problem> = {}): Problem =>
  ({ id: `p${number}-${n++}`, number, text: '', answers, answerType: 'integer', points: 1, ...extra });
const make: Make = (list, set) => ({ id: `new-${n++}`, number: Math.max(0, ...list.map((x) => x.number)) + 1, set, text: '', answers: [''], answerType: 'integer', points: list[list.length - 1]?.points ?? 1 });
const ind = (k: number) => Array.from({ length: k }, (_, i) => p(i + 1, [String(i + 10)]));
const gutsRows = () => Array.from({ length: 8 }, (_, i) => p(i + 1, [String(i)], { set: Math.floor(i / 4) + 1, points: Math.floor(i / 4) + 4 }));

describe('parseTsv', () => {
  it('reads cells copied from a spreadsheet, quotes and all', () => {
    expect(parseTsv('1\t8\r\n2\t"3 | ""x"""\r\n')).toEqual([['1', '8'], ['2', '3 | "x"']]);
    expect(parseTsv('1\t"two\nlines"\t5\n\n')).toEqual([['1', 'two\nlines', '5']]);
  });
  it('tells a block from a single value', () => {
    expect(isBlock('3/8')).toBe(false);
    expect(isBlock('3/8\n')).toBe(false);
    expect(isBlock('8\n9')).toBe(true);
    expect(isBlock('1\t8')).toBe(true);
  });
});

describe('readNumber', () => {
  it('reads problem numbers, and Guts set.place', () => {
    expect(readNumber('7.', false)).toEqual({ n: 7 });
    expect(readNumber('P12', false)).toEqual({ n: 12 });
    expect(readNumber('2.3', true)).toEqual({ set: 2, k: 3 });
    expect(readNumber('3/8', false)).toBeNull();
  });
});

describe('pasteShape', () => {
  const cols = ['number', 'text', 'answers', 'type', 'points'] as const;
  it('number, answer', () => {
    expect(pasteShape(parseTsv('1\t8\n2\t3/8'), false, 'answers', [...cols])).toEqual({ cols: ['number', 'answers'], keyed: true, header: false });
  });
  it('number, text, answer, points', () => {
    expect(pasteShape(parseTsv('1\tWhat is $2+2$?\t4\t1'), false, 'number', [...cols]).cols).toEqual(['number', 'text', 'answers', 'points']);
  });
  it('number, answer, points versus number, text, answer', () => {
    expect(pasteShape(parseTsv('1\t8\t2\n2\t3/8\t2'), false, 'number', [...cols]).cols).toEqual(['number', 'answers', 'points']);
    expect(pasteShape(parseTsv('1\tCompute 2 + 6.\t8\n2\tHow many?\t9'), false, 'number', [...cols]).cols).toEqual(['number', 'text', 'answers']);
  });
  it('a header names the columns, and "Problem" over numbers is the number', () => {
    const s = pasteShape(parseTsv('Problem\tAnswer\tPoints\n1\t8\t1'), false, 'answers', [...cols]);
    expect(s).toEqual({ cols: ['number', 'answers', 'points'], keyed: true, header: true });
  });
  it('one column, or answers that repeat, fill down from the selected cell', () => {
    expect(pasteShape(parseTsv('8\n8\n9'), false, 'answers', [...cols])).toEqual({ cols: ['answers'], keyed: false, header: false });
    expect(pasteShape(parseTsv('8\t1\n8\t1'), false, 'answers', [...cols]).cols).toEqual(['answers', 'type']);
  });
});

describe('applyPaste', () => {
  it('keyed: changes the problems with those numbers and adds the rest in order', () => {
    const rows = ind(3);
    const data = parseTsv('2\t3/8\n5\t42\n4\t7');
    const res = applyPaste('individual', rows, data, pasteShape(data, false, 'number', ['number', 'answers']), 0, make);
    expect(res.changed).toBe(1);
    expect(res.added).toBe(2);
    expect(res.rows.map((x) => `${x.number}:${x.answers.join('|')}:${x.answerType}`)).toEqual(['1:10:integer', '2:3/8:expression', '3:12:integer', '4:7:integer', '5:42:integer']);
  });
  it('positional: fills down from the row, making problems past the end', () => {
    const rows = ind(2);
    const data = parseTsv('a\nb\nc');
    const res = applyPaste('individual', rows, data, pasteShape(data, false, 'answers', ['number', 'answers']), 1, make);
    expect(res.rows.map((x) => x.answers[0])).toEqual(['10', 'a', 'b', 'c']);
    expect(res.added).toBe(2);
  });
  it('Guts: set.place goes to that problem; new places join their set', () => {
    const rows = gutsRows();
    const data = parseTsv('2.1\t99\n3.1\t5');
    const res = applyPaste('guts', rows, data, pasteShape(data, true, 'answers', ['answers', 'points', 'set']), 0, make);
    expect(res.rows[4].answers).toEqual(['99']);
    expect(res.rows).toHaveLength(9);
    expect(res.rows[8]).toMatchObject({ set: 3, number: 9, answers: ['5'], points: 5 });
  });
});

describe('checkKey', () => {
  it('finds missing answers, shared numbers and answers that do not fit the type', () => {
    const rows = [p(1, ['8']), p(1, ['']), p(3, ['3/8'])];
    const c = checkKey('individual', rows);
    expect(c.duplicates).toBe(true);
    expect(c.issues.map((i) => i.key)).toEqual(['empty', 'dup', 'int']);
    expect(c.cells.get(rows[2].id)?.answers).toMatch(/not a whole number/);
  });
  it('notes numbers that skip, and text online students need', () => {
    const c = checkKey('individual', [p(1, ['1']), p(3, ['2'])], { needsText: true });
    expect(c.duplicates).toBe(false);
    expect(c.issues.map((i) => i.key)).toEqual(['order', 'text']);
    expect(c.issues[0].text).toMatch(/2 is missing/);
  });
  it('accepts whole numbers the marker accepts', () => {
    expect(checkKey('individual', [p(1, ['1,000', '08'])]).issues).toEqual([]);
  });
});

describe('bulk changes', () => {
  it('labels Guts problems by set', () => {
    const rows = gutsRows();
    expect(labelOf('guts', rows, rows[5])).toBe('2.2');
  });
  it('adds new sets, and moves a problem to the end of another set', () => {
    const rows = gutsRows();
    const added = addBlank('guts', rows, 4, make, true);
    expect(added.rows.slice(8).map((x) => x.set)).toEqual([3, 3, 3, 3]);
    const moved = moveToSet(rows, rows[0].id, 2);
    expect(moved[7].id).toBe(rows[0].id);
    expect(moved.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('renumbers in row order', () => {
    expect(renumberRows('individual', [p(3, ['1']), p(3, ['2']), p(9, ['3'])]).map((x) => x.number)).toEqual([1, 2, 3]);
  });
});

describe('needsParking', () => {
  it('parks when a number is handed over before its holder moves', () => {
    const [a, b] = ind(2);
    expect(needsParking([a, b], [{ ...a, number: 2 }, { ...b, number: 1 }]).map((x) => x.id)).toEqual([a.id, b.id]);
  });
  it('does not when numbers only move down after a removal', () => {
    const [a, b, c] = ind(3);
    expect(needsParking([a, b, c], [a, { ...c, number: 2 }])).toEqual([]);
  });
});
