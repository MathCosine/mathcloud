import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Moment } from '../lib/demo/seed';
import { enterAs, homeFor, ROLE_LABEL, useUser } from '../lib/session';
import { loadMoment, useAllDB } from '../lib/store';
import { toast } from './ui';

const ACCOUNTS = ['u-director', 'u-grader', 'u-proctor', 'u-coach', 'u-c16A', 'u-c05A'];
const MOMENTS: { key: Moment; label: string; hint: string }[] = [
  { key: 'before', label: 'The week before', hint: 'registration open' },
  { key: 'morning', label: 'Contest morning', hint: 'Individual open' },
  { key: 'guts', label: 'Guts is live', hint: 'board moving' },
  { key: 'after', label: 'After the contest', hint: 'grade, publish' },
];

/** The demo's own controls: who you are and which moment of the day it is. */
export function DemoMenu({ placement = 'up' }: { placement?: 'up' | 'down' }) {
  const db = useAllDB();
  const user = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const as = (id: string) => {
    enterAs(id);
    setOpen(false);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Demo
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
      </button>
      {open && (
        <div className={`menu ${placement}`} role="menu">
          <div className="menu-title">Sign in as</div>
          {ACCOUNTS.map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map((u) => (
            <button key={u!.id} type="button" role="menuitem" className={`menu-item ${user?.id === u!.id ? 'on' : ''}`} onClick={() => as(u!.id)}>
              {u!.name}
              <small>{ROLE_LABEL[u!.role]}</small>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-title">Moment of the contest day</div>
          {MOMENTS.map((m) => (
            <button key={m.key} type="button" role="menuitem" className={`menu-item ${db.moment === m.key ? 'on' : ''}`} onClick={() => { loadMoment(m.key); setOpen(false); navigate(homeFor(user)); toast(m.label, 'The demo has been reset to this moment.'); }}>
              {m.label}
              <small>{m.hint}</small>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { enterAs(null); setOpen(false); navigate('/sign-in'); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
