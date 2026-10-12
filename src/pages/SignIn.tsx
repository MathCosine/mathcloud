import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from '../lib/actions';
import { homeFor, ROLE_LABEL } from '../lib/session';
import { setSession, useDB } from '../lib/store';
import { Mark } from '../components/ui';

const WHAT: Record<string, string> = {
  'u-director': 'Runs SFMO 2027: roster, rounds, proctoring, grading, results, certificates, email.',
  'u-grader': 'Keys paper answer sheets for the rounds they are assigned. Sees no contact details.',
  'u-proctor': 'Watches Zoom Room 1: who is in the test, who left the tab, questions to answer.',
  'u-coach': 'Coaches two online teams: rosters, waivers, schedule, Zoom rooms, results.',
  'u-c16A': 'Online competitor on team 16. Takes the tests in the browser while on Zoom.',
  'u-c05A': 'In-person competitor with a managed account: a username instead of an email.',
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
    // One message for both failures: never say which half was wrong.
    if (!u) return setError('That email and password were not accepted.');
    go(u.id);
  };

  const accounts = ['u-director', 'u-grader', 'u-proctor', 'u-coach', 'u-c16A', 'u-c05A']
    .map((id) => db.users.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  return (
    <div className="signin">
      <div className="signin-left">
        <div className="brand">
          <Mark />
          MathCloud
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="sub2" style={{ marginTop: 6 }}>Directors, graders, proctors, coaches and students each have their own account.</p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email or username</span>
            <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" placeholder="you@school.org" />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="callout red">{error}</div>}
          <button className="btn btn-primary btn-lg" type="submit">Sign in</button>
          <p className="sub" style={{ fontSize: 12.5 }}>
            Students under 13 sign in with a username their coach or guardian set up. No email is collected from them.
          </p>
        </form>
        <div className="callout amber" style={{ marginTop: 'auto' }}>
          <span>
            <b>This is a demo.</b> Every person, team and answer in it is invented. It runs entirely in your browser, and nothing you do here is sent anywhere.
          </span>
        </div>
      </div>
      <div className="signin-right">
        <div>
          <div className="eyebrow">SFMO 2027 demo accounts · password “demo”</div>
          <p className="sub2" style={{ marginTop: 6, maxWidth: 560 }}>
            Open two tabs to see it live: a student in one, the director or proctor in the other. Answers, flags and questions appear in both as they happen.
          </p>
        </div>
        <div className="account-list">
          {accounts.map((u) => (
            <button key={u.id} type="button" className="account" onClick={() => go(u.id)}>
              <span className="role">{ROLE_LABEL[u.role]}</span>
              <span>
                <b>{u.name}</b>
                <small>{WHAT[u.id]}</small>
                <br />
                <small className="mono">{u.email}</small>
              </span>
              <span className="go" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
