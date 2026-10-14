import { useEffect, useRef, useState } from 'react';

/**
 * A field that saves when the typing stops, not on every key: connected to
 * the database, each save is a request. Returns [value, set, flush]; call
 * flush on blur so leaving the field saves at once.
 */
export function useDraft<T>(value: T, commit: (v: T) => void, ms = 600): [T, (v: T) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const { v } = pending.current;
      pending.current = null;
      commitRef.current(v);
    }
  };
  // Changed somewhere else (another tab, an import): follow it, unless mid-typing.
  useEffect(() => {
    if (!pending.current) setDraft(value);
  }, [value]);
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: T) => {
    setDraft(v);
    pending.current = { v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, ms);
  };
  return [draft, set, flush];
}
