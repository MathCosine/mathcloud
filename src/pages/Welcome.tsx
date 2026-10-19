import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import '../styles/public.css';
import { createOrganization } from '../lib/actions';
import { EMAIL, fetchOpenContests, firstName, type OpenContest } from '../lib/public';
import { contestInitials, homeFor, useUser } from '../lib/session';
import { REMOTE, useAllDB } from '../lib/store';
import * as W from '../lib/remote/write';
import { currentUid, reload } from '../lib/remote/live';
import { TopBar } from '../layouts/StaffLayout';
import { ArtEmpty } from '../components/art';
import { Icon } from '../components/icons';

type Pick = 'run' | 'coach' | 'student';

/** A new account that is not yet anyone's organiser, coach or student: choose a way in. */
export function Welcome() {
  const user = useUser();
  const [pick, setPick] = useState<Pick | null>(null);

  if (user && user.role !== 'guest') return <Navigate to={homeFor(user)} replace />;
  if (REMOTE && !user) {
    // Just signed up: the account is still loading.
    if (currentUid()) return <div className="booting" role="status"><span className="spinner" />Loading</div>;
    return <Navigate to="/sign-in" replace />;
  }

  const cards: { key: Pick; title: string; text: string; art: ReactNode }[] = [
    { key: 'run', title: 'I run a contest', text: 'Create your organisation, then set up a contest: in person, online, or both.', art: <RunArt /> },
    { key: 'coach', title: 'I coach a team', text: 'Register a team for a contest that is taking sign-ups, and add your students.', art: <CoachArt /> },
    { key: 'student', title: 'I’m a student', text: 'Join your team with the code your coach gave you.', art: <StudentArt /> },
  ];

  return (
    <div className="app">
      <TopBar />
      <main className="page narrow welcome">
        {!REMOTE && (
          <div className="note blue" style={{ marginBottom: 20 }}>
            Sandbox preview. New accounts land here when MathCloud is connected to Supabase; the sandbox only has its demo accounts, so nothing here is saved.
          </div>
        )}
        <div className="page-head">
          <div>
            <h1 className="page-title">{user ? `Welcome, ${firstName(user.name)}` : 'Welcome to MathCloud'}</h1>
            <p className="page-sub">What are you here for? You can add the others later.</p>
          </div>
        </div>
        <div className="wl-cards" role="radiogroup" aria-label="What brings you here">
          {cards.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={pick === c.key} className="wl-card" onClick={() => setPick(c.key)}>
              <span className="wl-art">{c.art}</span>
              <span className="wl-text">
                <b>{c.title}</b>
                <small>{c.text}</small>
              </span>
              <span className="wl-tick"><Icon name="check" size={13} /></span>
            </button>
          ))}
        </div>
        {pick === 'run' && <RunPanel />}
        {pick === 'coach' && <CoachPanel />}
        {pick === 'student' && <StudentPanel defaultName={user?.name ?? ''} />}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ panels

function RunPanel() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) return setError('Give your organisation a name of at least three letters.');
    setBusy(true);
    const err = await createOrganization(name);
    setBusy(false);
    if (err) return setError(err);
    navigate('/staff/new');
  };
  return (
    <section className="card wl-panel reveal">
      <h2>Your organisation</h2>
      <p className="soft">The club, school or society that runs the contest. It owns your contests, your email keys and your staff.</p>
      {REMOTE ? (
        <form className="wl-form" onSubmit={submit} noValidate>
          <label className="field grow">
            <span>Organisation name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bay Area Math Circle" autoFocus />
            <small>Shown on your contest pages and in emails. You can change it later.</small>
          </label>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create and set up a contest'}</button></div>
          {error && <div className="note red" role="alert">{error}</div>}
        </form>
      ) : (
        <SandboxNote login="director@sfmo.demo">The sandbox already has an organisation, SF Math Initiative. Sign in as its director, Jordan Lee, to see the organiser’s side.</SandboxNote>
      )}
    </section>
  );
}

function CoachPanel() {
  const all = useAllDB();
  const [remote, setRemote] = useState<{ contests: OpenContest[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!REMOTE) return;
    let live = true;
    void fetchOpenContests().then((r) => live && setRemote(r));
    return () => {
      live = false;
    };
  }, []);

  const list: (OpenContest & { open: boolean })[] = REMOTE
    ? (remote?.contests ?? []).map((c) => ({ ...c, open: true }))
    : all.contests.map((c) => ({ id: c.id, name: c.name, short: c.short, slug: c.slug, dateLabel: c.dateLabel, closesLabel: c.registration.closesLabel, open: c.registration.open }));

  return (
    <section className="card wl-panel reveal">
      <h2>Contests taking registrations</h2>
      <p className="soft">Registering a team makes you its coach. If an organiser sent you a link to their form, that link works too.</p>
      {REMOTE && !remote ? (
        <p className="muted row"><span className="spinner" />Looking for open contests</p>
      ) : remote?.error ? (
        <div className="note red">{remote.error}</div>
      ) : list.length === 0 ? (
        <div className="wl-empty">
          <ArtEmpty kind="search" />
          <p className="soft">No contest is taking registrations right now. Ask the organisers for their registration link.</p>
        </div>
      ) : (
        <ul className="wl-contests">
          {list.map((c) => (
            <li key={c.id}>
              <span className="tile" style={{ width: 34, height: 34, fontSize: 11 }}>{contestInitials(c.short)}</span>
              <span className="grow">
                <b>{c.name}</b>
                <small>{c.dateLabel}{c.open && c.closesLabel ? ` · registration closes ${c.closesLabel}` : ''}</small>
              </span>
              <Link className="btn btn-sm btn-quiet hide-sm" to={`/c/${c.slug}`}>Contest page</Link>
              {c.open ? (
                <Link className="btn btn-sm btn-primary" to={`/register/${c.slug}`}>Register a team</Link>
              ) : (
                <span className="state-closed small">Registration closed</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!REMOTE && <p className="small muted">In the sandbox registration opens in the “week before” moment (the menu under your name). The coach Megan Hughes already has two teams.</p>}
    </section>
  );
}

function StudentPanel({ defaultName }: { defaultName: string }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ code: '', name: defaultName, grade: '', guardian: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = f.code.trim().toUpperCase();
    if (code.length < 4) return setError('Type the join code your coach sent you. It has six letters and digits, like 3FA9C2.');
    if (f.name.trim().length < 2) return setError('Type your full name, as your coach would write it.');
    if (f.guardian.trim() && !EMAIL.test(f.guardian.trim())) return setError('That guardian email does not look right.');
    setError('');
    setBusy(true);
    const r = await W.joinTeam(code, f.name.trim(), f.grade ? Number(f.grade) : null, f.guardian.trim());
    if (r.error) {
      setBusy(false);
      return setError(r.error);
    }
    await reload(null);
    navigate('/me');
  };
  return (
    <section className="card wl-panel reveal">
      <h2>Join your team</h2>
      <p className="soft">Your coach has a six-character join code on their team page. If they already added you by name, you take that place.</p>
      {REMOTE ? (
        <form className="wl-form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field">
              <span>Join code</span>
              <input className="input mono wl-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="3FA9C2" autoCapitalize="characters" spellCheck={false} maxLength={12} autoFocus />
            </label>
            <label className="field">
              <span>Your full name</span>
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
            </label>
            <label className="field">
              <span>Grade</span>
              <select className="select" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>
                <option value="">Choose</option>
                {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => <option key={g} value={g}>Grade {g}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Parent or guardian’s email</span>
              <input className="input" type="email" value={f.guardian} onChange={(e) => setF({ ...f, guardian: e.target.value })} placeholder="Optional" />
              <small>The waiver link goes here.</small>
            </label>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join team'}</button></div>
          {error && <div className="note red" role="alert">{error}</div>}
        </form>
      ) : (
        <SandboxNote login="student@sfmo.demo">The sandbox’s students are already on their teams. Sign in as Carter Hughes (online) or Hannah Kim (in person) to see a student’s page.</SandboxNote>
      )}
    </section>
  );
}

function SandboxNote({ children, login }: { children: ReactNode; login: string }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="note">{children}</div>
      <div><Link className="btn btn-sm" to={`/sign-in?login=${encodeURIComponent(login)}`}>Go to the demo account <Icon name="arrow" size={13} /></Link></div>
    </div>
  );
}

// ---------------------------------------------------------------- drawings

function RunArt() {
  return (
    <svg viewBox="0 0 160 96" aria-hidden="true">
      <rect x="22" y="8" width="116" height="80" rx="7" fill="var(--bg)" stroke="var(--line-2)" />
      <rect x="22" y="8" width="116" height="18" rx="7" fill="var(--bg-2)" />
      <text x="32" y="21" fontSize="9" fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">Rounds</text>
      {[['9:20', 'Individual', 'var(--green)'], ['10:35', 'Team', 'var(--green)'], ['12:00', 'Guts', 'var(--blue)']].map(([t, n, c], i) => (
        <g key={t} transform={`translate(32 ${38 + i * 16})`}>
          <text x="0" y="4" fontSize="8" fill="var(--ink-3)" fontFamily="var(--mono)">{t}</text>
          <rect x="28" y="-3" width="4" height="8" rx="2" fill={c} />
          <text x="38" y="4" fontSize="8.5" fontWeight="600" fill="var(--ink-2)" fontFamily="var(--sans)">{n}</text>
          <rect x="80" y="-2" width="16" height="6" rx="3" fill="var(--bg-3)" />
        </g>
      ))}
    </svg>
  );
}

function CoachArt() {
  return (
    <svg viewBox="0 0 160 96" aria-hidden="true">
      <rect x="22" y="8" width="116" height="80" rx="7" fill="var(--bg)" stroke="var(--line-2)" />
      <text x="32" y="25" fontSize="9" fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">Team 22</text>
      <rect x="96" y="15" width="32" height="13" rx="6.5" fill="var(--blue-soft)" />
      <text x="112" y="24" fontSize="7.5" fontWeight="700" fill="var(--blue)" textAnchor="middle" fontFamily="var(--sans)">Online</text>
      {['A', 'B', 'C'].map((s, i) => (
        <g key={s} transform={`translate(32 ${40 + i * 15})`}>
          <circle cx="5" cy="0" r="5" fill="var(--blue-soft)" />
          <text x="5" y="3" fontSize="6.5" fontWeight="700" fill="var(--blue)" textAnchor="middle" fontFamily="var(--sans)">{s}</text>
          <rect x="16" y="-3" width={[48, 40, 52][i]} height="6" rx="3" fill="var(--bg-3)" />
          <circle cx="92" cy="0" r="4" fill={i < 2 ? 'var(--green)' : 'var(--amber)'} />
        </g>
      ))}
    </svg>
  );
}

function StudentArt() {
  return (
    <svg viewBox="0 0 160 96" aria-hidden="true">
      <rect x="44" y="6" width="72" height="84" rx="8" fill="var(--bg)" stroke="var(--line-2)" />
      <rect x="70" y="12" width="20" height="4" rx="2" fill="var(--bg-3)" />
      <text x="80" y="44" fontSize="20" fontWeight="700" fill="var(--ink)" textAnchor="middle" fontFamily="var(--mono)">16A</text>
      <rect x="56" y="52" width="48" height="5" rx="2.5" fill="var(--bg-3)" />
      <rect x="54" y="66" width="52" height="14" rx="7" fill="var(--green-soft)" />
      <text x="80" y="76" fontSize="7.5" fontWeight="700" fill="var(--green)" textAnchor="middle" fontFamily="var(--sans)">Waiver signed</text>
    </svg>
  );
}
