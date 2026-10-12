import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import { initials, ROLE_LABEL, useUser } from '../lib/session';
import { useDB } from '../lib/store';
import { roundState } from '../lib/time';
import { Mark } from '../components/ui';
import { useSimulation } from '../lib/demo/simulate';

type Item = { to: string; label: string; count?: string | number; tone?: 'warn' | 'live'; end?: boolean };

export function StaffLayout() {
  const db = useDB();
  const user = useUser();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ y: number; show: boolean }>({ y: 0, show: false });
  useSimulation(!!user && ['director', 'staff', 'proctor', 'grader'].includes(user.role));

  useLayoutEffect(() => {
    const a = navRef.current?.querySelector<HTMLElement>('a.active');
    setIndicator(a ? { y: a.offsetTop, show: true } : { y: 0, show: false });
  }, [location.pathname, user?.role]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!['director', 'staff', 'grader', 'proctor'].includes(user.role)) return <Navigate to="/" replace />;

  const contest = contestOf(db);
  const live = db.teams.filter((t) => t.status !== 'withdrawn');
  const openRounds = contest.rounds.filter((r) => roundState(r) === 'open');
  const unanswered = db.clarifications.filter((c) => !c.answer).length;
  const queued = db.sends.filter((s) => s.status === 'queued').length;
  const isDirector = user.role === 'director' || user.role === 'staff';

  const groups: { label: string; items: Item[] }[] = isDirector
    ? [
        {
          label: 'Before',
          items: [
            { to: '/staff', label: 'Overview', end: true },
            { to: '/staff/roster', label: 'Roster', count: live.length },
            { to: '/staff/check-in', label: 'Check-in' },
            { to: '/staff/people', label: 'People & access' },
          ],
        },
        {
          label: 'On the day',
          items: [
            { to: '/staff/rounds', label: 'Rounds', count: openRounds.length ? `${openRounds.length} open` : undefined, tone: 'live' },
            { to: '/staff/proctoring', label: 'Proctoring', count: unanswered || undefined, tone: 'warn' },
            { to: '/staff/grading', label: 'Grading' },
          ],
        },
        {
          label: 'After',
          items: [
            { to: '/staff/results', label: 'Results', count: contest.resultsPublished ? 'live' : undefined, tone: 'live' },
            { to: '/staff/certificates', label: 'Certificates' },
            { to: '/staff/emails', label: 'Emails', count: queued ? `${queued} queued` : undefined, tone: 'warn' },
          ],
        },
      ]
    : user.role === 'grader'
      ? [{ label: 'Your work', items: [{ to: '/staff/grading', label: 'Grading' }] }]
      : [{ label: 'Your work', items: [{ to: '/staff/proctoring', label: 'Proctoring', count: unanswered || undefined, tone: 'warn' }] }];

  const allItems = groups.flatMap((g) => g.items);

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Contest navigation">
        <div className="org">
          <span className="org-mark">SF</span>
          <span>
            <span className="org-name">{db.orgs[0].name}</span>
            <br />
            <span className="org-sub">{ROLE_LABEL[user.role]}</span>
          </span>
        </div>
        <div className="contest-pick">
          <span>
            <b>{contest.short}</b>
            <small>{contest.dateLabel.replace('Saturday ', '')}</small>
          </span>
        </div>
        <nav className="nav" ref={navRef}>
          <span className="nav-indicator" style={{ transform: `translateY(${indicator.y}px)`, opacity: indicator.show ? 1 : 0 }} />
          {groups.map((g) => (
            <div key={g.label} style={{ display: 'contents' }}>
              <span className="nav-label">{g.label}</span>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {it.label}
                  {it.count !== undefined && <span className={`count ${it.tone ?? ''}`}>{it.count}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span className="me">
            <span className="avatar">{initials(user.name)}</span>
            {user.name}
          </span>
          <span className="platform">
            <Mark />
            MathCloud
          </span>
        </div>
      </aside>
      <main className="main">
        <div className="mobile-top">
          <span className="org-mark">SF</span>
          {allItems.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {it.label}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
