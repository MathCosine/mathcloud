import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from '../lib/actions';
import { homeFor, initials, ROLE_LABEL } from '../lib/session';
import { setSession, useDB } from '../lib/store';

const WHAT: Record<string, string> = {
  'u-director': 'Runs the contest',
  'u-grader': 'Keys paper answer sheets',
  'u-proctor': 'Watches Zoom Room 1',
  'u-coach': 'Coaches teams 16 and 21',
  'u-c16A': 'Online, team 16',
  'u-c05A': 'In person, team 05, username sign-in',
};

export function SignIn() {
  const db = useDB();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const go = (id: string) => {
    setSession(id);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = signIn(login, password);
    // One message for both failures, so it never says which half was wrong.
    if (!u) return setError('That email and password do not match an account.');
    go(u.id);
  };

  return (
    <div className="signin">
      <div className="signin-form">
        <span className="brand">MathCloud</span>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Sign in</h1>
          <p className="soft">SFMO 2027 · San Francisco Math Initiative</p>
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
        <p className="muted small" style={{ marginTop: 'auto' }}>
          Younger students sign in with the username their coach or guardian set up.
        </p>
      </div>
      <div className="signin-demo">
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Try the demo</h2>
          <p className="soft" style={{ maxWidth: '56ch' }}>
            Everyone here is invented, and nothing leaves your browser. Open a second tab as someone else to watch changes arrive live.
          </p>
        </div>
        <div className="accounts">
          {Object.keys(WHAT).map((id) => {
            const u = db.users.find((x) => x.id === id);
            if (!u) return null;
            return (
              <button key={id} type="button" className="account" onClick={() => go(id)}>
                <span className="avatar">{initials(u.name)}</span>
                <span>
                  <b>{u.name}</b>
                  <small>{ROLE_LABEL[u.role]} · {WHAT[id]}</small>
                </span>
                <span className="go">Sign in →</span>
              </button>
            );
          })}
        </div>
        <p className="muted small">Every demo password is “demo”.</p>
      </div>
    </div>
  );
}
