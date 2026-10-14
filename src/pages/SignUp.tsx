import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import '../styles/public.css';
import { signUp } from '../lib/actions';
import { EMAIL, SHOW_DEMO } from '../lib/public';
import { homeFor, useUser } from '../lib/session';
import { REMOTE } from '../lib/store';
import { ArtEmpty, Logo } from '../components/art';
import { Icon, type IconName } from '../components/icons';

const NEXT: { icon: IconName; title: string; text: string }[] = [
  { icon: 'overview', title: 'Run a contest', text: 'Name your organisation, then set up the contest: divisions, rounds, the day’s schedule.' },
  { icon: 'roster', title: 'Coach a team', text: 'Pick a contest with registration open and register your team.' },
  { icon: 'people', title: 'Compete', text: 'Type the join code your coach gave you to take your place on the team.' },
];

export function SignUp() {
  const me = useUser();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setError('Type your name, as organisers and coaches should see it.');
    if (!EMAIL.test(form.email.trim())) return setError('That does not look like an email address.');
    if (form.password.length < 8) return setError('Use a password of at least 8 characters.');
    setError('');
    setBusy(true);
    const r = await signUp(form);
    setBusy(false);
    if (r.error) return setError(r.error);
    if (r.needsConfirm) return setSentTo(form.email.trim());
    navigate('/welcome');
  };

  if (me) return <Navigate to={homeFor(me)} replace />;
  return (
    <div className="signin">
      <div className="signin-form">
        <Link to="/" className="brand"><Logo size={28} /><span>MathCloud</span></Link>
        {sentTo ? (
          <div className="stack reveal" style={{ gap: 14 }}>
            <ArtEmpty kind="mail" className="auth-art" />
            <h1 className="page-title">Check your inbox</h1>
            <p className="soft">We sent a link to <b>{sentTo}</b>. Open it on this device to confirm your email; you will come back here signed in.</p>
            <p className="small muted">Nothing after a few minutes? Look in spam, or <button type="button" className="linkbtn" onClick={() => setSentTo(null)}>try another address</button>.</p>
          </div>
        ) : (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="page-title">Create an account</h1>
              <p className="soft">For organisers, coaches and students with their own email. Younger students get a username from their coach instead.</p>
            </div>
            {REMOTE ? (
              <form onSubmit={submit} noValidate>
                <label className="field">
                  <span>Your name</span>
                  <input className="input" value={form.name} onChange={set('name')} autoComplete="name" autoFocus />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" autoCapitalize="none" spellCheck={false} />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
                  <small>At least 8 characters.</small>
                </label>
                {error && <div className="note red" role="alert">{error}</div>}
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
              </form>
            ) : (
              <div className="stack">
                <div className="note blue">
                  This copy is the sandbox: it runs in your browser with a made-up contest and a fixed set of demo accounts, so there are no new
                  accounts to create. Connect a Supabase project to make real ones.
                </div>
                <div><Link className="btn btn-primary" to="/sign-in">Use a demo account</Link></div>
              </div>
            )}
            <span className="small soft">Already have an account? <Link to="/sign-in">Sign in</Link></span>
          </>
        )}
      </div>
      <div className="signin-demo">
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>After you sign up</h2>
          <p className="soft" style={{ maxWidth: '60ch' }}>You choose what you are here for. You can do more than one later: an organiser can also coach a team at someone else’s contest.</p>
        </div>
        <ul className="auth-next">
          {NEXT.map((n) => (
            <li key={n.title} className="card">
              <span className="auth-next-ic"><Icon name={n.icon} size={18} /></span>
              <span>
                <b>{n.title}</b>
                <small>{n.text}</small>
              </span>
            </li>
          ))}
        </ul>
        {SHOW_DEMO && <p className="muted small">Just looking? <Link to="/sign-in">Sign in with a demo account</Link> instead.</p>}
      </div>
    </div>
  );
}
