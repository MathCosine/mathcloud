import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Print only some sheets: they are rendered into a node directly under
 * <body>, everything else is hidden by the print stylesheet (reports.css),
 * and the node goes away once the print dialog closes.
 */
export function usePrint() {
  const [job, setJob] = useState<ReactNode | null>(null);
  useEffect(() => {
    if (!job) return;
    document.body.classList.add('mc-printing');
    const done = () => {
      document.body.classList.remove('mc-printing');
      setJob(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    // Let the sheets lay out (and fonts settle) before the dialog opens.
    const id = window.setTimeout(() => window.print(), 120);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('mc-printing');
    };
  }, [job]);
  const portal = job ? createPortal(<div className="print-root">{job}</div>, document.body) : null;
  return { print: (node: ReactNode) => setJob(node), portal };
}
