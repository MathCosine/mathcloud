import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import { useStandings } from '../lib/hooks';
import { contestInitials, homeFor, useUser } from '../lib/session';
import { setActiveContest, useAllDB, useDB } from '../lib/store';
import { duration, roundEnds, roundState } from '../lib/time';
import { Logo } from '../components/art';
import { Icon, type IconName } from '../components/icons';
import { UserMenu } from '../components/UserMenu';
import { ModeChip, useNow } from '../components/ui';

type Tab = { to: string; label: string; icon: IconName; count?: number | 'live'; end?: boolean };

/**
 * The organisers' frame: a top bar (MathCloud, the contest, you) and the
 * contest's own header with one tab per part of the job, left to right in
 * the order a contest happens.
 */
export function StaffLayout() {
  const db = useDB();
  const user = useUser();
  const location = useLocation();

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!['director', 'staff', 'grader', 'proctor'].includes(user.role)) return <Navigate to={homeFor(user)} replace />;

  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
  const director = user.role === 'director' || user.role === 'staff';
  if (!contest) {
    if (director && location.pathname !== '/staff/new') return <Navigate to="/staff/new" replace />;
    return (
      <div className="app">
        <TopBar />
        <main className="page">{director ? <Outlet /> : <p className="soft">You have no contests yet. An organiser adds you to one.</p>}</main>
      </div>
    );
  }
  if (location.pathname === '/staff/new') {
    return (
      <div className="app">
        <TopBar />
        <main className="page"><Outlet /></main>
      </div>
    );
  }
  return <ContestFrame director={director} role={user.role} />;
}

function ContestFrame({ director, role }: { director: boolean; role: string }) {
  const db = useDB();
  const now = useNow(1000);
  const standings = useStandings();
  const contest = contestOf(db);
  const open = contest.rounds.find((r) => roundState(r, now) === 'open');
  const ends = open ? roundEnds(open) : null;
  const waiting = db.clarifications.filter((c) => !c.answer && !c.broadcast).length + db.attempts.filter((a) => a.locked && !a.submittedAt).length;
  const missing = db.competitors.filter((c) => !c.waiverSignedAt && db.teams.find((t) => t.id === c.teamId)?.status !== 'withdrawn').length;
  const toRule = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);

  const tabs: Tab[] = director
    ? [
        { to: '/staff', label: 'Overview', icon: 'overview', end: true },
        { to: '/staff/teams', label: 'Teams', icon: 'roster', count: db.teams.filter((t) => t.status !== 'withdrawn').length },
        { to: '/staff/people', label: 'People', icon: 'people' },
        { to: '/staff/waivers', label: 'Waivers', icon: 'file', count: missing || undefined },
        { to: '/staff/rounds', label: 'Rounds', icon: 'rounds' },
        { to: '/staff/live', label: 'Live', icon: 'live', count: waiting || (open ? 'live' : undefined) },
        { to: '/staff/grading', label: 'Grading', icon: 'grading', count: toRule || undefined },
        { to: '/staff/results', label: 'Results', icon: 'results' },
        { to: '/staff/reports', label: 'Reports', icon: 'certificate' },
        { to: '/staff/email', label: 'Email', icon: 'mail' },
        { to: '/staff/settings', label: 'Settings', icon: 'setup' },
      ]
    : role === 'grader'
      ? [{ to: '/staff/grading', label: 'Grading', icon: 'grading', count: toRule || undefined }]
      : [{ to: '/staff/live', label: 'Live', icon: 'live', count: waiting || (open ? 'live' : undefined) }];

  return (
    <div className="app">
      <TopBar />
      <header className="contest-head">
        <div className="contest-head-in">
          <div className="contest-title">
            <div className="row" style={{ gap: 12, minWidth: 0 }}>
              <span className="tile">{contestInitials(contest.short)}</span>
              <div style={{ minWidth: 0 }}>
                <h1>{contest.name}</h1>
                <p className="row wrap" style={{ gap: 8 }}>
                  <span>{contest.dateLabel}</span>
                  {contest.divisions.map((d) => <ModeChip key={d.id} mode={d.mode} />)}
                </p>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {open && ends && (
                <Link to="/staff/live" className="live-pill">
                  {open.name} · <span className="mono">{duration(ends - now)}</span>
                </Link>
              )}
              {director && <Link className="btn btn-sm hide-sm" to={`/c/${contest.slug}`}><Icon name="link" />Public page</Link>}
            </div>
          </div>
          <nav className="tabs-nav" aria-label="Contest">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'on' : '')}>
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.count === 'live' ? <span className="dot-live" aria-label="live" /> : t.count ? <span className="count">{t.count}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet key={contest.id} />
      </main>
    </div>
  );
}

/** MathCloud, which contest, and who you are. Shared by every signed-in screen. */
export function TopBar({ children }: { children?: ReactNode }) {
  const user = useUser();
  return (
    <div className="topbar">
      <div className="topbar-in">
        <Link to={user ? homeFor(user) : '/'} className="brand"><Logo size={26} /><span>MathCloud</span></Link>
        {user && (user.role === 'director' || user.role === 'staff') && <ContestSwitcher />}
        <span className="grow" />
        {children}
        <UserMenu />
      </div>
    </div>
  );
}

function ContestSwitcher() {
  const all = useAllDB();
  const db = useDB();
  const navigate = useNavigate();
  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
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
  const org = all.orgs.find((o) => o.id === contest?.orgId) ?? all.orgs[0];

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="ctx" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="muted hide-sm">{org?.name ?? 'Your organisation'}</span>
        <span className="slash hide-sm">/</span>
        <b>{contest?.short ?? 'No contest yet'}</b>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="menu down" role="menu" style={{ left: 0, right: 'auto', width: 300 }}>
          <div className="menu-title">{org?.name}</div>
          {all.contests.map((c) => (
            <button key={c.id} type="button" role="menuitem" className={`menu-item ${c.id === contest?.id ? 'on' : ''}`} onClick={() => { setActiveContest(c.id); setOpen(false); navigate('/staff'); }}>
              <span className="row" style={{ gap: 10 }}>
                <span className="tile" style={{ width: 26, height: 26, fontSize: 10, borderRadius: 7 }}>{contestInitials(c.short)}</span>
                <span>{c.short}</span>
              </span>
              <small>{c.dateLabel.replace(/^\w+day /, '')}</small>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate('/staff/new'); }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="tile new" style={{ width: 26, height: 26, borderRadius: 7 }}><Icon name="plus" size={14} /></span>
              <span>New contest</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
