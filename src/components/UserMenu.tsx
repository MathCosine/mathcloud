import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from '../lib/actions';
import type { Moment } from '../lib/demo/seed';
import { enterAs, homeFor, initials, ROLE_LABEL, useUser } from '../lib/session';
import { loadMoment, REMOTE, useAllDB } from '../lib/store';
import { Icon } from './icons';
import { toast } from './ui';

const SANDBOX_ACCOUNTS = ['u-director', 'u-grader', 'u-proctor', 'u-coach', 'u-c16A', 'u-c05A'];
const MOMENTS: { key: Moment; label: string; hint: string }[] = [
  { key: 'before', label: 'The week before', hint: 'registration open' },
  { key: 'morning', label: 'Contest morning', hint: 'Individual open' },
  { key: 'guts', label: 'Guts is live', hint: 'board moving' },
  { key: 'after', label: 'After the contest', hint: 'grade, publish' },
];

/** Who you are, and the way out. In the sandbox it also switches people and moments of the day. */
export function UserMenu({ wide }: { wide?: boolean } = {}) {
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

  if (!user) return <Link className="btn btn-sm" to="/sign-in">Sign in</Link>;

  const as = (id: string) => {
    enterAs(id);
    setOpen(false);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };
  const out = async () => {
    setOpen(false);
    await signOut();
    enterAs(null);
    navigate('/');
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={`user-btn ${wide ? 'wide' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(user.name)}</span>
        {wide ? (
          <span style={{ lineHeight: 1.25 }}>
            <b style={{ display: 'block', fontWeight: 600 }}>{user.name}</b>
            <small className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[user.role]}</small>
          </span>
        ) : (
          <span className="hide-sm">{user.name.split(' ')[0]}</span>
        )}
        <Icon name={wide ? 'more' : 'chevron'} size={15} />
      </button>
      {open && (
        <div className={`menu ${wide ? 'up' : 'down'}`} role="menu" style={wide ? { width: '100%', minWidth: 248 } : undefined}>
          <div className="menu-head">
            <b>{user.name}</b>
            <small>{ROLE_LABEL[user.role]}{user.email && !user.managed ? ` · ${user.email}` : user.managed ? ` · ${user.email}` : ''}</small>
          </div>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate(homeFor(user)); }}><span className="row" style={{ gap: 10 }}><Icon name="home" />Your home</span></button>
          {REMOTE && <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate('/account'); }}><span className="row" style={{ gap: 10 }}><Icon name="user" />Account and password</span></button>}
          {!REMOTE && (
            <>
              <div className="menu-sep" />
              <div className="menu-title">Sandbox: sign in as</div>
              {SANDBOX_ACCOUNTS.map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map((u) => (
                <button key={u!.id} type="button" role="menuitem" className={`menu-item ${user.id === u!.id ? 'on' : ''}`} onClick={() => as(u!.id)}>
                  {u!.name}
                  <small>{ROLE_LABEL[u!.role]}</small>
                </button>
              ))}
              <div className="menu-sep" />
              <div className="menu-title">Sandbox: moment of the day</div>
              {MOMENTS.map((m) => (
                <button key={m.key} type="button" role="menuitem" className={`menu-item ${db.moment === m.key ? 'on' : ''}`} onClick={() => { loadMoment(m.key); setOpen(false); navigate(homeFor(user)); toast(m.label, 'The sandbox has been reset to this moment.'); }}>
                  {m.label}
                  <small>{m.hint}</small>
                </button>
              ))}
            </>
          )}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={out}><span className="row" style={{ gap: 10 }}><Icon name="logout" />Sign out</span></button>
        </div>
      )}
    </div>
  );
}
