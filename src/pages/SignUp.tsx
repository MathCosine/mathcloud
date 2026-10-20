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
  { icon: 'overview', title: 'Run a contest', text: 'Name your organisation, then set up the contest: rounds, rooms, the day’s schedule.' },
  { icon: 'roster', title: 'Coach a team', text: 'Pick a contest with registration open and register your team.' },
  { icon: 'student', title: 'Compete', text: 'Type the join code your coach gave you to take your place on the team.' },
];

export function SignUp() {
  const me = useUser();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const fail = (why: string) => {
    setError(why);
    setTries((n) => n + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return fail('Type your name, as organisers and coaches should see it.');
    if (!EMAIL.test(form.email.trim())) return fail('That does not look like an email address.');
    if (form.password.length < 8) return fail('Use a password of at least 8 characters.');
    setError('');
    setBusy(true);
    const r = await signUp(form);
    setBusy(false);
    if (r.error) return fail(r.error);
    if (r.needsConfirm) return setSentTo(form.email.trim());
    navigate('/welcome');
  };

  if (me) return <Navigate to={homeFor(me)} replace />;
  return (
    <div className="au">
      <div className="au-main">
        <Link to="/" className="brand"><Logo size={28} /><span>MathCloud</span></Link>
        {sentTo ? (
          <div className="au-form" key="sent">
            <ArtEmpty kind="mail" className="auth-art" />
            <div>
              <h1>Check your inbox</h1>
              <p className="au-lede">We sent a link to <b>{sentTo}</b>. Open it on this device to confirm your email; you will come back here signed in.</p>
            </div>
            <p className="small muted">Nothing after a few minutes? Look in spam, or <button type="button" className="linkbtn" onClick={() => setSentTo(null)}>try another address</button>.</p>
          </div>
        ) : (
          <div className="au-form">
            <div>
              <h1>Create an account</h1>
              <p className="au-lede">For organisers, coaches and students with their own email. Younger students get a username from their coach instead.</p>
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
                <div className="field">
                  <label htmlFor="new-password">Password</label>
                  <div className="au-pw">
                    <input id="new-password" className="input" type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} autoComplete="new-password" />
                    <button type="button" className="icon-btn au-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                      <Icon name={show ? 'lock' : 'eye'} size={16} />
                    </button>
                  </div>
                  <small className={form.password.length >= 8 ? 'ok' : ''}>{form.password.length >= 8 ? 'Long enough.' : 'At least 8 characters.'}</small>
                </div>
                {error && <div key={tries} className="note red au-msg" role="alert">{error}</div>}
                <button className="btn btn-primary btn-lg au-submit" type="submit" disabled={busy}>
                  {busy ? <><span className="spinner" />Creating your account</> : <>Create account<Icon name="arrow" /></>}
                </button>
              </form>
            ) : (
              <div className="stack">
                <div className="note blue">
                  This copy is the sandbox: it runs in your browser with a made-up contest and a fixed set of demo accounts, so there are no new
                  accounts to create. Connect a Supabase project to make real ones.
                </div>
                <div><Link className="btn btn-primary btn-lg au-submit" to="/sign-in">Use a demo account<Icon name="arrow" /></Link></div>
              </div>
            )}
            <div className="au-links"><span>Already have an account? <Link to="/sign-in">Sign in</Link></span></div>
          </div>
        )}
        <p className="au-foot">You choose what you are here for after signing up.</p>
      </div>
      <aside className="au-side">
        <div className="au-side-in">
          <div>
            <h2>After you sign up</h2>
            <p className="au-side-lede">You choose what you are here for. You can do more than one later: an organiser can also coach a team at someone else’s contest.</p>
          </div>
          <ul className="au-roles">
            {NEXT.map((n) => (
              <li key={n.title}>
                <span className="lp-ic"><Icon name={n.icon} size={17} /></span>
                <span><b>{n.title}</b><small>{n.text}</small></span>
              </li>
            ))}
          </ul>
          {SHOW_DEMO && <p className="au-note">Just looking? <Link to="/sign-in">Sign in with a demo account</Link> instead.</p>}
        </div>
      </aside>
    </div>
  );
}
