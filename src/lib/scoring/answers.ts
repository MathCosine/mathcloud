/**
 * Turning what someone typed into something comparable.
 *
 * Automatic grading only ever says "this matches the key". Everything else
 * is listed once per distinct answer for a director to rule on, so
 * normalisation stays conservative: it removes differences of typing (spaces,
 * dollar signs, \dfrac vs \frac, a leading +), never differences of maths.
 */
import type { AnswerType, Problem, Ruling } from '../model';

export type GradeStatus = 'correct' | 'incorrect' | 'blank' | 'unreviewed';

/** Strip one balanced {...} group starting at `i` (which must be '{'). */
function readGroup(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return null;
}

/** A command argument: a {group}, or a single character as in \frac12. */
function readArg(s: string, i: number): [string, number] | null {
  while (s[i] === ' ') i++;
  if (s[i] === '{') return readGroup(s, i);
  return i < s.length ? [s[i], i + 1] : null;
}

/** Wrap in parentheses unless it is a single number or letter run. */
function atom(s: string): string {
  return /^[-]?[\w.]+$/.test(s) ? s : `(${s})`;
}

function latexToPlain(input: string): string {
  let s = input;
  s = s.replace(/\\[dt]frac/g, '\\frac');
  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\\cdot|\\times/g, '*');
  s = s.replace(/\\pi/g, 'pi');
  // \frac{a}{b} -> a/b and \sqrt{x} -> sqrt(x), innermost first
  for (let guard = 0; guard < 20; guard++) {
    const f = s.indexOf('\\frac');
    const r = s.indexOf('\\sqrt');
    if (f === -1 && r === -1) break;
    if (f !== -1 && (r === -1 || f < r)) {
      const a = readArg(s, f + 5);
      const b = a && readArg(s, a[1]);
      if (!a || !b) break;
      s = s.slice(0, f) + `${atom(latexToPlain(a[0]))}/${atom(latexToPlain(b[0]))}` + s.slice(b[1]);
    } else {
      const a = readArg(s, r + 5);
      if (!a) break;
      s = s.slice(0, r) + `sqrt(${latexToPlain(a[0])})` + s.slice(a[1]);
    }
  }
  s = s.replace(/\^\{([^{}]*)\}/g, (_, e: string) => `^${atom(e)}`);
  s = s.replace(/[{}]/g, '');
  return s;
}

export function normalize(raw: string, type: AnswerType): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^\$+|\$+$/g, '');
  s = s.replace(/[−–]/g, '-');
  s = latexToPlain(s);
  s = s.replace(/\s+/g, '').toLowerCase();
  s = s.replace(/^\+/, '');
  if (type === 'integer') {
    const grouped = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s;
    if (/^-?\d+$/.test(grouped)) {
      const negative = grouped.startsWith('-');
      const digits = grouped.replace(/^-/, '').replace(/^0+(?=\d)/, '');
      return negative && digits !== '0' ? `-${digits}` : digits;
    }
  }
  return s;
}

/** rulings indexed as `${problemId}|${normalized}` → correct */
export type RulingIndex = Map<string, boolean>;

export function indexRulings(rulings: Ruling[]): RulingIndex {
  const m: RulingIndex = new Map();
  for (const r of rulings) m.set(`${r.problemId}|${r.normalized}`, r.correct);
  return m;
}

export function keyMatches(problem: Problem, normalized: string): boolean {
  return problem.answers.some((a) => normalize(a, problem.answerType) === normalized);
}

export function gradeAnswer(problem: Problem, raw: string | undefined, rulings: RulingIndex): GradeStatus {
  const n = normalize(raw ?? '', problem.answerType);
  if (!n) return 'blank';
  if (keyMatches(problem, n)) return 'correct';
  const ruled = rulings.get(`${problem.id}|${n}`);
  if (ruled === true) return 'correct';
  if (ruled === false) return 'incorrect';
  // A clean integer that is not the key is simply wrong; only odd forms
  // (fractions, expressions, words) wait for a person.
  if (problem.answerType === 'integer' && /^-?\d+$/.test(n)) return 'incorrect';
  // A plain number or fraction whose value differs from every key is wrong.
  // One with the same value in another form (0.375 for 3/8, 6/8 for 3/4)
  // is a question about accepted forms, so a person decides.
  const value = rationalValue(n);
  if (value !== null) {
    const keys = problem.answers.map((a) => rationalValue(normalize(a, problem.answerType)));
    if (keys.every((k) => k !== null && Math.abs(k - value) > 1e-9)) return 'incorrect';
  }
  return 'unreviewed';
}

/** The value of `7`, `-7`, `0.375`, `3/4`, `-3/4` or `(-3)/4`; null for anything else. */
export function rationalValue(n: string): number | null {
  const m = /^(-?)\(?(-?\d*\.?\d+)\)?(?:\/(\d+))?$/.exec(n);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const num = Number(m[2]);
  const den = m[3] ? Number(m[3]) : 1;
  return den === 0 || !Number.isFinite(num) ? null : (sign * num) / den;
}
