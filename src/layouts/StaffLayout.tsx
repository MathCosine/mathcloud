import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import { useStandings } from '../lib/hooks';
import { contestInitials, homeFor, useUser } from '../lib/session';
import { setActiveContest, useAllDB, useDB } from '../lib/store';
import { duration, roundEnds, roundState } from '../lib/time';
import { Logo } from '../components/art';
import { CommandPalette, openCommandPalette, STAFF_PAGES } from '../components/CommandPalette';
import { Icon } from '../components/icons';
import { UserMenu } from '../components/UserMenu';
import { useNow } from '../components/ui';

/**
 * The organisers' frame. A sidebar on the grey frame is the map of the
 * contest, in the order the day happens (before, on the day, after); the page
 * sits on a white sheet beside it. ⌘K jumps anywhere.
 */
export function StaffLayout() {
  const db = useDB();
  const user = useUser();
  const location = useLocation();

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!['director', 'staff', 'grader', 'proctor'].includes(user.role)) return <Navigate to={homeFor(user)} replace />;

  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
  const director = user.role === 'director' || user.role === 'staff';
  if (!contest && director && location.pathname !== '/staff/new') return <Navigate to="/staff/new" replace />;
  return <Frame />;
}

function Frame() {
  const db = useDB();
  const user = useUser()!;
  const location = useLocation();
  const now = useNow(1000);
  const [sideOpen, setSideOpen] = useState(false);
  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
  const open = contest?.rounds.find((r) => roundState(r, now) === 'open');
  const ends = open ? roundEnds(open) : null;
  const page = STAFF_PAGES.find((p) => (p.to === '/staff' ? location.pathname === '/staff' : location.pathname.startsWith(p.to)));
  const title = location.pathname === '/staff/new' ? 'New contest' : page?.label ?? '';

  useEffect(() => setSideOpen(false), [location.pathname]);

  return (
    <div className={`shell ${sideOpen ? 'side-open' : ''}`}>
      <aside className="side" aria-label="Contest">
        <div className="side-top">
          <Link to={homeFor(user)} className="brand"><Logo size={24} /><span>MathCloud</span></Link>
          <button type="button" className="icon-btn menu-btn" aria-label="Close menu" onClick={() => setSideOpen(false)}><Icon name="close" /></button>
        </div>
        {(user.role === 'director' || user.role === 'staff') ? <ContestSwitcher /> : contest && <ContestBadge />}
        <button type="button" className="find" onClick={openCommandPalette}>
          <Icon name="search" size={15} />
          Search or jump to…
          <span className="kbd">⌘K</span>
        </button>
        {contest && <SideNav />}
        <div className="side-foot">
          <UserMenu wide />
        </div>
      </aside>
      <button type="button" className="side-scrim" aria-label="Close menu" onClick={() => setSideOpen(false)} />
      <div className="main">
        <div className="sheet">
          <header className="sheet-head">
            <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setSideOpen(true)}><Icon name="menu" size={18} /></button>
            <nav className="crumbs" aria-label="You are here">
              {contest && <span className="hide-sm">{contest.short}</span>}
              {contest && title && <Icon name="chevron-right" size={14} className="hide-sm" />}
              <b>{title}</b>
            </nav>
            <span className="grow" />
            {open && ends && (
              <Link to="/staff/live" className="live-pill">
                <span className="hide-sm">{open.name}</span>
                <span className="mono">{duration(ends - now)}</span>
              </Link>
            )}
            {contest && (user.role === 'director' || user.role === 'staff') && (
              <Link className="icon-btn" to={`/c/${contest.slug}`} title="Public contest page" aria-label="Public contest page"><Icon name="external" /></Link>
            )}
          </header>
          <main className="page enter" key={location.pathname}>
            <Outlet key={contest?.id} />
          </main>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}

/** The pages of the contest, grouped by when they matter. A white pill glides to the one you are on. */
function SideNav() {
  const db = useDB();
  const user = useUser()!;
  const now = useNow(5000);
  const standings = useStandings();
  const location = useLocation();
  const contest = contestOf(db);
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; on: boolean }>({ y: 0, on: false });

  const live = db.teams.filter((t) => t.status !== 'withdrawn');
  const waiting = db.clarifications.filter((c) => !c.answer && !c.broadcast).length + db.attempts.filter((a) => a.locked && !a.submittedAt).length;
  const missing = db.competitors.filter((c) => !c.waiverSignedAt && live.some((t) => t.id === c.teamId)).length;
  const toRule = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);
  const isLive = contest.rounds.some((r) => roundState(r, now) === 'open');
  const counts: Record<string, { n?: number; hot?: boolean; live?: boolean }> = {
    '/staff/teams': { n: live.length },
    '/staff/waivers': { n: missing || undefined, hot: missing > 0 },
    '/staff/live': { n: waiting || undefined, hot: waiting > 0, live: isLive && !waiting },
    '/staff/grading': { n: toRule || undefined, hot: toRule > 0 },
  };
  const pages = STAFF_PAGES.filter((p) => p.roles.includes(user.role));

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('a.on');
    setPill(el ? { y: el.offsetTop, on: true } : (p) => ({ ...p, on: false }));
  }, [location.pathname, pages.length]);

  return (
    <nav className="nav" ref={navRef}>
      <span className="nav-pill" style={{ transform: `translateY(${pill.y}px)`, opacity: pill.on ? 1 : 0 }} aria-hidden="true" />
      {pages.map((p, i) => {
        const c = counts[p.to] ?? {};
        const head = p.group && p.group !== pages[i - 1]?.group && pages.length > 2;
        return (
          <Fragment key={p.to}>
            {head && <div className="nav-label">{p.group === 'Settings' ? ' ' : p.group}</div>}
            <NavLink to={p.to} end={p.to === '/staff'} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon name={p.icon} size={16} />
              {p.label}
              {c.live ? <span className="count"><span className="dot-live" style={{ display: 'inline-block' }} aria-label="live" /></span> : c.n ? <span className={`count ${c.hot ? 'hot' : ''}`}>{c.n}</span> : null}
            </NavLink>
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Graders and proctors: which contest they are working on. */
function ContestBadge() {
  const db = useDB();
  const contest = contestOf(db);
  return (
    <div className="ctx" style={{ cursor: 'default' }}>
      <span className="tile">{contestInitials(contest.short)}</span>
      <span style={{ minWidth: 0 }}><b>{contest.short}</b><small>{contest.dateLabel}</small></span>
    </div>
  );
}

/** Coaches, students and account pages: MathCloud, the contest, you. */
export function TopBar({ children }: { children?: ReactNode }) {
  const user = useUser();
  return (
    <div className="topbar">
      <div className="topbar-in">
        <Link to={user ? homeFor(user) : '/'} className="brand"><Logo size={24} /><span>MathCloud</span></Link>
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
        <span className="tile">{contest ? contestInitials(contest.short) : <Icon name="plus" size={14} />}</span>
        <span style={{ minWidth: 0 }}>
          <b>{contest?.short ?? 'No contest yet'}</b>
          <small>{org?.name ?? 'Your organisation'}</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      {open && (
        <div className="menu down" role="menu" style={{ left: 0, right: 'auto', width: '100%', minWidth: 240 }}>
          <div className="menu-title">{org?.name}</div>
          {all.contests.map((c) => (
            <button key={c.id} type="button" role="menuitem" className={`menu-item ${c.id === contest?.id ? 'on' : ''}`} onClick={() => { setActiveContest(c.id); setOpen(false); navigate('/staff'); }}>
              <span className="row" style={{ gap: 10 }}>
                <span className="tile" style={{ width: 24, height: 24, fontSize: 9.5, borderRadius: 7 }}>{contestInitials(c.short)}</span>
                <span>{c.short}</span>
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate('/staff/new'); }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="tile new" style={{ width: 24, height: 24, borderRadius: 7 }}><Icon name="plus" size={13} /></span>
              <span>New contest</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
