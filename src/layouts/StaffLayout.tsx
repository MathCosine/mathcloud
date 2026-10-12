import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { contestOf, offers } from '../lib/actions';
import { contestInitials, initials, ROLE_LABEL, useUser } from '../lib/session';
import { setActiveContest, useAllDB, useDB } from '../lib/store';
import { duration, roundEnds, roundState } from '../lib/time';
import { DemoMenu } from '../components/DemoMenu';
import { Icon, type IconName } from '../components/icons';
import { ModeChip, useNow } from '../components/ui';

type Item = { to: string; label: string; icon: IconName; badge?: number | 'live'; end?: boolean } | { group: string };

const TITLES: [string, string][] = [
  ['/staff/new', 'New contest'],
  ['/staff/setup', 'Setup'],
  ['/staff/roster/import', 'Import teams'],
  ['/staff/roster', 'Roster'],
  ['/staff/rounds', 'Rounds'],
  ['/staff/live', 'Live'],
  ['/staff/grading', 'Grading'],
  ['/staff/results', 'Results'],
  ['/staff/certificates', 'Certificates'],
  ['/staff/email', 'Email'],
  ['/staff/settings', 'People and access'],
  ['/staff', 'Overview'],
];

export function StaffLayout() {
  const db = useDB();
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const now = useNow(1000);
  const nav = useRef<HTMLElement>(null);
  const [slide, setSlide] = useState<{ y: number; on: boolean }>({ y: 0, on: false });

  useLayoutEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>('a.active');
    setSlide(a ? { y: a.offsetTop, on: true } : { y: 0, on: false });
  }, [location.pathname, user?.role, db.contests.length]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!['director', 'staff', 'grader', 'proctor'].includes(user.role)) return <Navigate to="/" replace />;

  const contest = contestOf(db);
  const open = contest.rounds.find((r) => roundState(r, now) === 'open');
  const ends = open ? roundEnds(open) : null;
  const waiting = db.clarifications.filter((c) => !c.answer).length + db.attempts.filter((a) => a.locked && !a.submittedAt).length;
  const director = user.role === 'director' || user.role === 'staff';
  const liveBadge = waiting || (open ? 'live' : undefined);

  const items: Item[] = director
    ? [
        { to: '/staff', label: 'Overview', icon: 'overview', end: true },
        { group: 'Before' },
        { to: '/staff/setup', label: 'Setup', icon: 'setup' },
        { to: '/staff/roster', label: 'Roster', icon: 'roster' },
        { to: '/staff/rounds', label: 'Rounds', icon: 'rounds' },
        { group: 'On the day' },
        { to: '/staff/live', label: 'Live', icon: 'live', badge: liveBadge },
        { to: '/staff/grading', label: offers(contest, 'in_person') ? 'Grading' : 'Review answers', icon: 'grading' },
        { group: 'After' },
        { to: '/staff/results', label: 'Results', icon: 'results' },
        { to: '/staff/certificates', label: 'Certificates', icon: 'certificate' },
        { to: '/staff/email', label: 'Email', icon: 'mail' },
        { group: 'Organisation' },
        { to: '/staff/settings', label: 'People and access', icon: 'people' },
      ]
    : user.role === 'grader'
      ? [{ to: '/staff/grading', label: 'Grading', icon: 'grading' }]
      : [{ to: '/staff/live', label: 'Live', icon: 'live', badge: liveBadge }];
  const links = items.filter((i): i is Extract<Item, { to: string }> => 'to' in i);
  const title = TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] ?? '';

  return (
    <div className="shell">
      <aside className="side" aria-label="Contest">
        {director ? <ContestSwitcher /> : (
          <div className="switcher" style={{ cursor: 'default' }}>
            <span className="tile">{contestInitials(contest.short)}</span>
            <span style={{ minWidth: 0 }}><b>{contest.short}</b><small>{db.orgs[0].name}</small></span>
          </div>
        )}
        <nav className="side-nav" ref={nav}>
          <span className="pill-slide" style={{ transform: `translateY(${slide.y}px)`, opacity: slide.on ? 1 : 0 }} />
          {items.map((it, i) =>
            'group' in it ? (
              <span key={`g${i}`} className="group">{it.group}</span>
            ) : (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={it.icon} />
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
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <b>{contest.short}</b>
          <select className="select input-sm" aria-label="Go to" value={links.find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.to} onChange={(e) => navigate(e.target.value)}>
            {links.map((l) => <option key={l.to} value={l.to}>{l.label}</option>)}
          </select>
          <DemoMenu placement="down" />
        </div>
        <header className="topbar">
          <div className="crumbs">
            <span>{contest.short}</span>
            <span aria-hidden="true">/</span>
            <b>{title}</b>
          </div>
          <span className="grow" />
          {contest.divisions.map((d) => <ModeChip key={d.id} mode={d.mode} />)}
          {open && ends && (
            <Link to="/staff/live" className="live-pill">
              {open.name} · <span className="mono">{duration(ends - now)}</span>
            </Link>
          )}
        </header>
        <main className="main">
          <Outlet key={contest.id} />
        </main>
      </div>
    </div>
  );
}

function ContestSwitcher() {
  const all = useAllDB();
  const db = useDB();
  const navigate = useNavigate();
  const contest = contestOf(db);
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

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="switcher" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tile">{contestInitials(contest.short)}</span>
        <span style={{ minWidth: 0 }}><b>{contest.short}</b><small>{contest.dateLabel.replace(/^\w+day /, '')}</small></span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="menu down" role="menu" style={{ left: 0, right: 'auto', width: 280 }}>
          <div className="menu-title">{all.orgs[0].name}</div>
          {all.contests.map((c) => {
            const teams = all.teams.filter((t) => t.contestId === c.id && t.status !== 'withdrawn').length;
            return (
              <button key={c.id} type="button" role="menuitem" className={`menu-item ${c.id === contest.id ? 'on' : ''}`} onClick={() => { setActiveContest(c.id); setOpen(false); navigate('/staff'); }}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="tile" style={{ width: 26, height: 26, fontSize: 10, borderRadius: 7 }}>{contestInitials(c.short)}</span>
                  <span>{c.short}</span>
                </span>
                <small>{teams} {teams === 1 ? 'team' : 'teams'}</small>
              </button>
            );
          })}
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
