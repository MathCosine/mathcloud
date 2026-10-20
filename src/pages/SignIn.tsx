import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import '../styles/public.css';
import { sendPasswordReset, signIn } from '../lib/actions';
import { DEMO_PASSWORD, SHOW_DEMO, demoAccounts, type DemoAccount } from '../lib/public';
import { enterAs, homeFor, initials, useUser } from '../lib/session';
import { REMOTE, useAllDB } from '../lib/store';
import { Logo } from '../components/art';
import { Icon, type IconName } from '../components/icons';
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
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const me = useUser();

  const go = (id: string) => {
    enterAs(id);
    navigate(homeFor(db.users.find((u) => u.id === id) ?? null));
  };

  const fail = (why: string) => {
    setError(why);
    setTries((n) => n + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return fail('Type your email or username and your password.');
    setError('');
    setInfo('');
    setBusy(true);
    const r = await signIn(login, password);
    if ('error' in r) {
      setBusy(false);
      return fail(r.error);
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
    if (r.error) return fail(r.error);
    setInfo(`If ${l} has an account, a link to set a new password is on its way. It opens your account page.`);
  };

  const fill = (a: DemoAccount & { signIn: string }) => {
    setLogin(a.signIn);
    setPassword(DEMO_PASSWORD);
    setError('');
    setInfo('');
    submitRef.current?.focus();
  };

  const capsKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  if (me) return <Navigate to={homeFor(me)} replace />;
  return (
    <div className="au">
      <div className="au-main">
        <Link to="/" className="brand"><Logo size={28} /><span>MathCloud</span></Link>
        <div className="au-form">
          <div>
            <h1>Sign in</h1>
            <p className="au-lede">Organisers, graders, proctors, coaches and students all sign in here.</p>
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
              <div className="au-pw">
                <input id="password" className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={capsKey} onKeyDown={capsKey} onBlur={() => setCaps(false)} autoComplete="current-password" />
                <button type="button" className="icon-btn au-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  <Icon name={show ? 'lock' : 'eye'} size={16} />
                </button>
              </div>
              {caps && <span className="au-caps"><Icon name="warning" size={13} />Caps Lock is on</span>}
            </div>
            {error && <div key={tries} className="note red au-msg" role="alert">{error}</div>}
            {info && <div className="note blue au-msg calm" role="status">{info}</div>}
            <button ref={submitRef} className="btn btn-primary btn-lg au-submit" type="submit" disabled={busy}>
              {busy ? <><span className="spinner" />Signing in</> : <>Sign in<Icon name="arrow" /></>}
            </button>
          </form>
          <div className="au-links">
            <span>New to MathCloud? <Link to="/sign-up">Create an account</Link></span>
            {!REMOTE && <Link to="/register/sfmo-2027" className="row"><Icon name="plus" size={14} />Register a team for SFMO 2027</Link>}
            <Link to="/practice" className="row"><Icon name="pencil" size={14} />Students: try a practice test first</Link>
          </div>
        </div>
        <p className="au-foot">Younger students sign in with the username their coach set up.</p>
      </div>

      <aside className="au-side">
        {SHOW_DEMO ? (
          <div className="au-side-in">
            <div>
              <h2>{REMOTE ? 'Demo accounts' : 'Try the demo'}</h2>
              <p className="au-side-lede">
                {REMOTE
                  ? <>SFMO 2027 is a made-up contest, run in person in San Francisco and online. Pick someone to fill in the form; every password is <span className="mono">{DEMO_PASSWORD}</span>.</>
                  : <>SFMO 2027 runs in person in San Francisco and online. Everyone here is invented and nothing leaves your browser. Open a second tab as someone else to watch changes arrive.</>}
              </p>
            </div>
            {GROUPS.map((g) => {
              const list = accounts.filter((a) => a.group === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="au-group">
                  <h3>{g.key === 'staff' ? g.title : <ModeChip mode={g.key} />}</h3>
                  <div className="au-list">
                    {list.map((a) => (
                      <button key={a.id} type="button" className={`au-acct ${login === a.signIn ? 'picked' : ''}`} onClick={() => (REMOTE ? fill(a) : go(a.id))}>
                        <span className="avatar">{initials(a.name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <b>{a.name}</b> <span className="muted small">{a.role}</span>
                          <small>{REMOTE ? <span className="mono">{a.signIn}</span> : a.what}</small>
                        </span>
                        <span className="au-go">{REMOTE ? (login === a.signIn ? <><Icon name="check" size={13} />Filled in</> : 'Use') : <>Sign in<Icon name="arrow" size={13} /></>}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="au-note">
              {REMOTE
                ? 'Demo data is shared by everyone trying it, so others may be changing things too.'
                : `Every demo password is “${DEMO_PASSWORD}”. Once inside, the menu under your name switches people and jumps between the week before, the morning, Guts and afterwards.`}
            </p>
          </div>
        ) : (
          <div className="au-side-in">
            <div>
              <h2>Where you land</h2>
              <p className="au-side-lede">Everyone signs in here and goes straight to their own page.</p>
            </div>
            <ul className="au-roles">
              {LANDS.map((r) => (
                <li key={r.title}>
                  <span className="lp-ic"><Icon name={r.icon} size={17} /></span>
                  <span><b>{r.title}</b><small>{r.text}</small></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

const LANDS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'overview', title: 'Organisers and staff', text: 'The contest overview: what needs you, most urgent first.' },
  { icon: 'roster', title: 'Coaches', text: 'Your teams, their waivers and, afterwards, every student’s report.' },
  { icon: 'student', title: 'Students', text: 'Your ID, your room or Zoom link, and your rounds.' },
];
