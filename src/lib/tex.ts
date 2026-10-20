/**
 * KaTeX, loaded the first time maths is on screen rather than with every
 * page: the landing page, sign-in and most organiser screens never need its
 * 260 KB. Test pages ask for it early (loadTex) so problems appear typeset.
 */
import { useEffect, useState } from 'react';

type Katex = typeof import('katex').default;

let lib: Katex | null = null;
let loading: Promise<Katex> | null = null;
const waiting = new Set<() => void>();

export function loadTex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    lib = m.default;
    waiting.forEach((w) => w());
    return lib;
  });
  return loading;
}

/** KaTeX once it has loaded; null until then (the caller shows the plain text). */
export function useTex(): Katex | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (lib) return;
    const w = () => redraw((n) => n + 1);
    waiting.add(w);
    void loadTex();
    return () => {
      waiting.delete(w);
    };
  }, []);
  return lib;
}
