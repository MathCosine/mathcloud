import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import '../styles/public.css';
import { sendPasswordReset, signIn } from '../lib/actions';
import { DEMO_PASSWORD, SHOW_DEMO, demoAccounts, type DemoAccount } from '../lib/public';
import { enterAs, homeFor, initials, useUser } from '../lib/session';
import { REMOTE, useAllDB } from '../lib/store';
import { ArtLaptop, Logo } from '../components/art';
import { Icon } from '../components/icons';
import { ModeChip } from '../components/ui';

const GROUPS: { key: DemoAccount['group']; title: string }[] = [
  { key: 'staff', title: 'Running the contest' },
  { key: 'in_person', title: 'In person' },
  { key: 'online', title: 'Online' },
];

export function SignIn() {
  const db = useAllDB();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const accounts = demoAccounts(db);
  const asked = params.get('login') ?? '';
  const [login, setLogin] = useState(asked);
  const [password, setPassword] = useState(asked && accounts.some((a) => a.signIn === asked) ? DEMO_PASSWORD : '');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const me = useUser();

  const go = (id: string) => {
    enterAs(id);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return setError('Type your email or username and your password.');
    setError('');
    setInfo('');
    setBusy(true);
    const r = await signIn(login, password);
    if ('error' in r) {
      setBusy(false);
      return setError(r.error);
    }
    // Connected, the app loads this person's contests and then this page moves on by itself.
    if (!REMOTE) go(r.userId);
  };

  const forgot = async () => {
    setError('');
    if (!REMOTE) return setInfo(`The sandbox sends no email. Every demo account’s password is “${DEMO_PASSWORD}”.`);
    const l = login.trim();
    if (!l) return setInfo('Type your email above, then press “Forgot password?” again.');
    if (!l.includes('@')) return setInfo('Accounts with a username are managed by a coach. Ask them to make you a new password.');
    const r = await sendPasswordReset(l);
    if (r.error) return setError(r.error);
    setInfo(`If ${l} has an account, a link to set a new password is on its way. It opens your account page.`);
  };

  const fill = (a: DemoAccount & { signIn: string }) => {
    setLogin(a.signIn);
    setPassword(DEMO_PASSWORD);
    setError('');
    setInfo('');
    submitRef.current?.focus();
  };

  if (me) return <Navigate to={homeFor(me)} replace />;
  return (
    <div className="signin">
      <div className="signin-form">
        <Link to="/" className="brand"><Logo size={28} /><span>MathCloud</span></Link>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Sign in</h1>
          <p className="soft">Organisers, graders, proctors, coaches and students all sign in here.</p>
        </div>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Email or username</span>
            <input id="login" className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!asked} />
          </label>
          <div className="field">
            <span className="row" style={{ justifyContent: 'space-between' }}>
              <label htmlFor="password">Password</label>
              <button type="button" className="linkbtn small" onClick={forgot}>Forgot password?</button>
            </span>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <div className="note red" role="alert">{error}</div>}
          {info && <div className="note blue" role="status">{info}</div>}
          <button ref={submitRef} className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="stack" style={{ gap: 10 }}>
          <span className="small soft">New to MathCloud? <Link to="/sign-up">Create an account</Link></span>
          {!REMOTE && <Link to="/register/sfmo-2027" className="row small" style={{ gap: 8 }}><Icon name="plus" size={14} />Register a team for SFMO 2027</Link>}
        </div>
        <p className="muted small" style={{ marginTop: 'auto' }}>
          Younger students sign in with the username their coach set up.
        </p>
      </div>

      {SHOW_DEMO ? (
        <div className="signin-demo">
          <div className="stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>{REMOTE ? 'Demo accounts' : 'Try the demo'}</h2>
            <p className="soft" style={{ maxWidth: '60ch' }}>
              {REMOTE
                ? <>SFMO 2027 is a made-up contest, run in person in San Francisco and online at the same moment. Pick someone to fill in the form; every password is <span className="mono">{DEMO_PASSWORD}</span>.</>
                : <>SFMO 2027 runs in person in San Francisco and online at the same moment. Everyone here is invented, and nothing leaves your browser. Open a second tab as someone else to watch changes arrive live.</>}
            </p>
          </div>
          {GROUPS.map((g) => {
            const list = accounts.filter((a) => a.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="who-group">
                <h3>{g.key === 'staff' ? g.title : <ModeChip mode={g.key} />}</h3>
                <div className="card accounts">
                  {list.map((a) => (
                    <button key={a.id} type="button" className={`account ${login === a.signIn ? 'picked' : ''}`} onClick={() => (REMOTE ? fill(a) : go(a.id))}>
                      <span className="avatar">{initials(a.name)}</span>
                      <span>
                        <b>{a.name}</b> <span className="muted small">{a.role}</span>
                        <small>{a.what}</small>
                        {REMOTE && <small className="mono">{a.signIn}</small>}
                      </span>
                      <span className="go">{REMOTE ? (login === a.signIn ? 'Filled in' : 'Use →') : 'Sign in →'}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="muted small">
            {REMOTE
              ? 'Demo data is shared by everyone trying it, so others may be changing things too.'
              : `Every demo password is “${DEMO_PASSWORD}”. The Demo menu inside switches people and jumps between the week before, the morning, Guts and afterwards.`}
          </p>
        </div>
      ) : (
        <div className="signin-demo signin-about">
          <ArtLaptop className="signin-art" />
          <ul className="signin-who">
            <li><Icon name="overview" size={16} /><span><b>Organisers and staff</b> land on the contest overview.</span></li>
            <li><Icon name="roster" size={16} /><span><b>Coaches</b> see their teams, waivers and score reports.</span></li>
            <li><Icon name="people" size={16} /><span><b>Students</b> see their ID, room or Zoom link, and their rounds.</span></li>
          </ul>
        </div>
      )}
    </div>
  );
}
