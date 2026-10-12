import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import { initials, ROLE_LABEL, useUser } from '../lib/session';
import { useDB } from '../lib/store';
import { roundState } from '../lib/time';
import { DemoMenu } from '../components/DemoMenu';
import { useNow } from '../components/ui';

type Item = { to: string; label: string; badge?: number | 'live'; end?: boolean } | 'gap';

export function StaffLayout() {
  const db = useDB();
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const now = useNow(5000);
  const nav = useRef<HTMLElement>(null);
  const [slide, setSlide] = useState<{ y: number; on: boolean }>({ y: 0, on: false });

  useLayoutEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>('a.active');
    setSlide(a ? { y: a.offsetTop, on: true } : { y: 0, on: false });
  }, [location.pathname, user?.role]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!['director', 'staff', 'grader', 'proctor'].includes(user.role)) return <Navigate to="/" replace />;

  const contest = contestOf(db);
  const live = contest.rounds.some((r) => roundState(r, now) === 'open');
  const waiting = db.clarifications.filter((c) => !c.answer).length + db.attempts.filter((a) => a.locked && !a.submittedAt).length;
  const director = user.role === 'director' || user.role === 'staff';

  const items: Item[] = director
    ? [
        { to: '/staff', label: 'Overview', end: true },
        { to: '/staff/roster', label: 'Roster' },
        { to: '/staff/rounds', label: 'Rounds' },
        'gap',
        { to: '/staff/live', label: 'Live', badge: waiting || (live ? 'live' : undefined) },
        { to: '/staff/grading', label: 'Grading' },
        'gap',
        { to: '/staff/results', label: 'Results' },
        { to: '/staff/certificates', label: 'Certificates' },
        { to: '/staff/email', label: 'Email' },
        'gap',
        { to: '/staff/settings', label: 'People and access' },
      ]
    : user.role === 'grader'
      ? [{ to: '/staff/grading', label: 'Grading' }]
      : [{ to: '/staff/live', label: 'Live', badge: waiting || (live ? 'live' : undefined) }];
  const links = items.filter((i): i is Exclude<Item, 'gap'> => i !== 'gap');

  return (
    <div className="shell">
      <aside className="side" aria-label="Contest">
        <div className="side-contest">
          <b>{contest.short}</b>
          <span>{db.orgs[0].name}</span>
        </div>
        <nav className="side-nav" ref={nav}>
          <span className="pill-slide" style={{ transform: `translateY(${slide.y}px)`, opacity: slide.on ? 1 : 0 }} />
          {items.map((it, i) =>
            it === 'gap' ? (
              <span key={`g${i}`} className="gap" />
            ) : (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {it.label}
                {it.badge === 'live' ? <span className="badge live">Live</span> : it.badge ? <span className="badge">{it.badge}</span> : null}
              </NavLink>
            ),
          )}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="avatar">{initials(user.name)}</span>
            <span className="grow">
              <b>{user.name}</b>
              <span className="role">{ROLE_LABEL[user.role]}</span>
            </span>
          </div>
          <DemoMenu />
        </div>
      </aside>
      <div>
        <div className="mobile-bar">
          <b>{contest.short}</b>
          <select className="select input-sm" aria-label="Go to" value={links.find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.to} onChange={(e) => navigate(e.target.value)}>
            {links.map((l) => <option key={l.to} value={l.to}>{l.label}</option>)}
          </select>
          <DemoMenu placement="down" />
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
