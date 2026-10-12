import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, ROLE_LABEL, useUser } from '../lib/session';
import { currentMoment, loadMoment, setSession, useDB } from '../lib/store';
import { toast } from './ui';

/**
 * The demo's own controls: switch account, jump between moments of the
 * contest day, start over. Kept in one corner so the app itself stays real.
 */
export function DemoPill() {
  const db = useDB();
  const user = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const moment = currentMoment();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const switchTo = (id: string) => {
    setSession(id);
    const u = db.users.find((x) => x.id === id) ?? null;
    navigate(homeFor(u));
    setOpen(false);
  };

  const jump = (m: 'morning' | 'after') => {
    loadMoment(m);
    setOpen(false);
    toast(m === 'morning' ? 'Contest morning' : 'After the contest', m === 'morning' ? 'The Individual round has just opened. Online students are partway through.' : 'Every round is over and keyed in. Results are ready to check and publish.');
  };

  const accounts = db.users.filter((u) => ['u-director', 'u-grader', 'u-proctor', 'u-coach', 'u-c16A', 'u-c05A'].includes(u.id));

  return (
    <div className="demo-pill" ref={ref}>
      {open && (
        <div className="popover" role="menu">
          <div className="pop-title">Demo · signed in as</div>
          {accounts.map((u) => (
            <button key={u.id} type="button" className={`pop-item ${user?.id === u.id ? 'on' : ''}`} onClick={() => switchTo(u.id)}>
              <span>{u.name}</span>
              <small>{ROLE_LABEL[u.role]}</small>
            </button>
          ))}
          <div className="pop-sep" />
          <div className="pop-title">Moment of the contest day</div>
          <button type="button" className={`pop-item ${moment === 'morning' ? 'on' : ''}`} onClick={() => jump('morning')}>
            <span>Contest morning</span>
            <small>tests open</small>
          </button>
          <button type="button" className={`pop-item ${moment === 'after' ? 'on' : ''}`} onClick={() => jump('after')}>
            <span>After the contest</span>
            <small>grading, results</small>
          </button>
          <div className="pop-sep" />
          <button type="button" className="pop-item" onClick={() => { setSession(null); setOpen(false); navigate('/sign-in'); }}>
            <span>Sign out</span>
          </button>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dot" />
        Demo{user ? ` · ${user.name.split(' ')[0]}, ${ROLE_LABEL[user.role].toLowerCase()}` : ''}
      </button>
    </div>
  );
}
