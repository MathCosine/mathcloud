import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Link, useNavigate } from 'react-router-dom';
import { signIn } from '../lib/actions';
import type { DivisionMode } from '../lib/model';
import { enterAs, homeFor, initials, useUser } from '../lib/session';
import { REMOTE, useAllDB } from '../lib/store';
import { Icon } from '../components/icons';
import { ModeChip } from '../components/ui';

type Group = { title: string; mode?: DivisionMode; accounts: [id: string, what: string][] };

const GROUPS: Group[] = [
  {
    title: 'Running the contest',
    accounts: [
      ['u-director', 'Director: sets up contests, chooses in person or online, imports teams'],
      ['u-grader', 'Grader: keys paper answer sheets'],
      ['u-proctor', 'Proctor: watches Zoom Room 1'],
    ],
  },
  { title: 'In person', mode: 'in_person', accounts: [['u-c05A', 'Student, team 05, signs in with a username']] },
  {
    title: 'Online',
    mode: 'online',
    accounts: [
      ['u-c16A', 'Student, team 16, in Austin on Central time'],
      ['u-coach', 'Coach of teams 16 and 21; can switch a team to in person'],
    ],
  },
];

export function SignIn() {
  const db = useAllDB();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const me = useUser();

  const go = (id: string) => {
    enterAs(id);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await signIn(login, password);
    if ('error' in r) return setError(r.error);
    if (!REMOTE) go(r.userId);
  };

  if (me) return <Navigate to={homeFor(me)} replace />;
  return (
    <div className="signin">
      <div className="signin-form">
        <span className="brand"><span className="tile" style={{ width: 28, height: 28, fontSize: 11, borderRadius: 8 }}>MC</span>MathCloud</span>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Sign in</h1>
          <p className="soft">Organisers, graders, proctors, coaches and students all sign in here.</p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email or username</span>
            <input id="login" className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="note red">{error}</div>}
          <button className="btn btn-primary btn-lg" type="submit">Sign in</button>
        </form>
        <div className="stack" style={{ gap: 8 }}>
          <Link to="/register/sfmo-2027" className="row small" style={{ gap: 8 }}><Icon name="plus" size={14} />Register a team for SFMO 2027</Link>
        </div>
        <p className="muted small" style={{ marginTop: 'auto' }}>
          Younger students sign in with the username their coach set up.
        </p>
      </div>
      <div className="signin-demo">
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Try the demo</h2>
          <p className="soft" style={{ maxWidth: '60ch' }}>
            SFMO 2027 runs in person in San Francisco and online at the same moment. Everyone here is invented, and nothing leaves your browser. Open a second tab as someone else to watch changes arrive live.
          </p>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="who-group">
            <h3>{g.mode ? <ModeChip mode={g.mode} /> : g.title}</h3>
            <div className="card accounts">
              {g.accounts.map(([id, what]) => {
                const u = db.users.find((x) => x.id === id);
                if (!u) return null;
                return (
                  <button key={id} type="button" className="account" onClick={() => go(id)}>
                    <span className="avatar">{initials(u.name)}</span>
                    <span>
                      <b>{u.name}</b>
                      <small>{what}</small>
                    </span>
                    <span className="go">Sign in →</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="muted small">Every demo password is “demo”. The Demo menu inside switches people and jumps between the week before, the morning, Guts and afterwards.</p>
      </div>
    </div>
  );
}
