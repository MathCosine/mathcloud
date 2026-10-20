import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '../styles/public.css';
import { Logo } from '../components/art';
import { Icon, type IconName } from '../components/icons';
import { ModeChip } from '../components/ui';
import { DEMO_PASSWORD, SHOW_DEMO, demoAccounts } from '../lib/public';
import { REMOTE, useAllDB } from '../lib/store';
import { initials } from '../lib/session';
import { HeroMock, prefersReducedMotion, usePlaying } from './landing-mock';

/** The front page for someone signed out: what MathCloud does, shown rather than described, and a way in. */
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div className="pub lp" ref={root}>
      <PublicTop />
      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-copy">
            <a className="lp-pill" href="#how">
              <span className="lp-pill-dots"><i className="g" /><i className="b" /></span>
              In the room and online, on one clock
              <Icon name="arrow" size={13} />
            </a>
            <h1>Run your math contest<span> from one place.</span></h1>
            <p className="lp-sub">
              Registration, waivers, rounds on paper and in the browser, grading, a live Guts board and score reports.
              Built for the people who run the day.
            </p>
            <div className="lp-cta">
              <Link className="btn btn-primary btn-lg" to="/sign-up">Create an organisation<Icon name="arrow" /></Link>
              {SHOW_DEMO ? <a className="btn btn-lg" href="#demo">Try the demo</a> : <Link className="btn btn-lg" to="/sign-in">Sign in</Link>}
            </div>
          </div>
          <div className="lp-wrap lp-wide">
            <div className="lp-stage">
              <HeroMock />
            </div>
          </div>
        </section>

        <section className="lp-section lp-statement">
          <div className="lp-wrap">
            <p className="lp-big">
              <span className="lp-r">One roster.</span> <span className="lp-r" style={d(1)}>One answer key.</span> <span className="lp-r" style={d(2)}>One set of results.</span>
            </p>
            <ul className="lp-facts">
              {FACTS.map((f, i) => (
                <li key={f.text} className="lp-r" style={d(i + 3)}><span className="lp-ic"><Icon name={f.icon} size={16} /></span>{f.text}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <Head kicker="How it works" title="Five steps. Each one feeds the next." text="Nothing is copied between spreadsheets: a team that registers is on the check-in list, its answers are graded against the same key, and its report goes to the address it signed up with." />
            <ol className="lp-flow lp-r">
              {FLOW.map((s, i) => (
                <li key={s.title} style={d(i)}>
                  <span className="lp-flow-ic"><Icon name={s.icon} size={17} /></span>
                  <h3><span className="lp-flow-n">{i + 1}</span>{s.title}</h3>
                  <p>{s.text}</p>
                  <span className="lp-flow-eg mono">{s.eg}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-wrap">
            <Head kicker="What it does" title="The parts of a contest day that usually live in five tools and a group chat." />
            <div className="lp-bento">
              <Tile className="w3" title="Paper in the room, the browser at home" text="Graders key sheets by competitor ID. Online, students answer with a server clock and every answer saves as they type.">
                <PaperAndBrowser />
              </Tile>
              <Tile className="w3" title="Odd answers are ruled once, for everyone" text="An answer that is not in the key goes to a queue. Decide it once and every sheet with the same answer follows.">
                <Ruling />
              </Tile>
              <Tile className="w2" title="Imports that check every row" text="The same student twice, a missing guardian email, a full team: caught before anything is saved.">
                <ImportMini />
              </Tile>
              <Tile className="w2" title="Proctors see what the browser sees" text="Leaving the tab, pasting, a second device. Warn or lock from the Zoom room.">
                <IntegrityMini />
              </Tile>
              <Tile className="w2" title="Reports through your own keys" text="Each key sends up to its daily limit. What does not fit today waits for tomorrow.">
                <KeysMini />
              </Tile>
            </div>
          </div>
        </section>

        <section className="lp-section" id="who">
          <div className="lp-wrap">
            <Head kicker="Who it is for" title="Everyone signs in at the same place and lands on their own page." />
            <div className="lp-who">
              {WHO.map((w, i) => (
                <article key={w.id} id={w.id} className="lp-who-col lp-r" style={d(i)}>
                  <span className="lp-ic"><Icon name={w.icon} size={17} /></span>
                  <h3>{w.title}</h3>
                  <ul>{w.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {SHOW_DEMO && <DemoBlock />}

        <section className="lp-section lp-end">
          <div className="lp-wrap lp-r">
            <h2>Run your next contest on MathCloud.</h2>
            <div className="lp-cta">
              <Link className="btn btn-primary btn-lg" to="/sign-up">Create an organisation<Icon name="arrow" /></Link>
              <Link className="btn btn-lg" to="/sign-in">Sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

const d = (i: number) => ({ '--d': `${i * 70}ms` }) as CSSProperties;

/**
 * Sections rise into place the first time they scroll into view. Without
 * IntersectionObserver, with reduced motion, or in an automated browser
 * (screenshots), everything is simply there.
 */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>('.lp-r')];
    const show = (x: Element) => x.classList.add('in');
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined' || navigator.webdriver) {
      items.forEach(show);
      return;
    }
    el.classList.add('lp-anim');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        show(e.target);
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((x) => io.observe(x));
    return () => io.disconnect();
  }, [root]);
}

function Head({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <div className="lp-head lp-r">
      <span className="lp-kicker">{kicker}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function Tile({ title, text, children, className }: { title: string; text: string; children: ReactNode; className?: string }) {
  return (
    <article className={`lp-tile lp-r ${className ?? ''}`}>
      <div className="lp-tile-copy">
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div className="lp-tile-art" aria-hidden="true">{children}</div>
    </article>
  );
}

/** The bar on every public page. */
export function PublicTop({ nav = true }: { nav?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`pub-top ${scrolled ? 'scrolled' : ''}`}>
      <div className="lp-wrap pub-top-in">
        <Link to="/" className="brand"><Logo size={26} /><span>MathCloud</span></Link>
        {nav && (
          <nav className="pub-nav" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#who">Who it is for</a>
            {SHOW_DEMO && <a href="#demo">Demo</a>}
          </nav>
        )}
        <span className="grow" />
        <Link to="/sign-in" className="btn btn-quiet">Sign in</Link>
        <Link to="/sign-up" className="btn btn-primary"><span className="hide-sm">Create an organisation</span><span className="show-sm">Sign up</span></Link>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-foot">
      <div className="lp-wrap pub-foot-in">
        <span className="brand"><Logo size={22} /><span>MathCloud</span></span>
        <span className="muted small">Contest software for math competitions, in person and online.</span>
        <span className="grow" />
        <nav className="pub-foot-nav small">
          <Link to="/sign-in">Sign in</Link>
          <Link to="/sign-up">Create an organisation</Link>
          {!REMOTE && <Link to="/c/sfmo-2027">Example contest page</Link>}
        </nav>
      </div>
    </footer>
  );
}

const FACTS: { icon: IconName; text: string }[] = [
  { icon: 'globe', text: 'Each student sees the schedule in their own time zone' },
  { icon: 'key', text: 'Students without email sign in with a username' },
  { icon: 'mail', text: 'Reports go out through your own email keys' },
];

const FLOW: { title: string; text: string; eg: string; icon: IconName }[] = [
  { title: 'Register', icon: 'roster', text: 'Coaches sign up on your contest page, or you import a spreadsheet.', eg: '21 teams · 79 students' },
  { title: 'Waivers', icon: 'waivers', text: 'Guardians sign from an emailed link. Reminders go to the rest.', eg: '74 of 79 signed' },
  { title: 'Rounds', icon: 'rounds', text: 'Paper in rooms at the venue, the browser on Zoom at home.', eg: 'Guts at 12:00' },
  { title: 'Grading', icon: 'grading', text: 'Sheets keyed by ID, online answers checked as they arrive.', eg: '3 answers to rule on' },
  { title: 'Results', icon: 'results', text: 'Your weights and tie-breaks, then a report to every family.', eg: 'Published 14:05' },
];

const WHO: { id: string; title: string; icon: IconName; points: string[] }[] = [
  {
    id: 'organisers', title: 'Organisers', icon: 'overview',
    points: [
      'Rounds, rooms and the day’s schedule in one place',
      'Import teams, chase waivers, check people in',
      'Open rounds, watch answers arrive, rule once',
      'Publish results, send reports and certificates',
    ],
  },
  {
    id: 'coaches', title: 'Coaches', icon: 'roster',
    points: [
      'Register teams and add students',
      'See whose waiver is missing and resend it',
      'Make sign-ins for students without email',
      'Read every student’s report afterwards',
    ],
  },
  {
    id: 'students', title: 'Students', icon: 'student',
    points: [
      'Your ID, room or Zoom link, in your time zone',
      'A device check before the day',
      'Rounds in the browser with the clock in view',
      'Your own report, problem by problem',
    ],
  },
];

function DemoBlock() {
  const db = useAllDB();
  const accounts = demoAccounts(db);
  return (
    <section className="lp-section" id="demo">
      <div className="lp-wrap">
        <div className="lp-demo lp-r">
          <div className="lp-demo-copy">
            <span className="lp-kicker">Demo</span>
            <h2>Try it as anyone on the day.</h2>
            <p>
              {REMOTE
                ? 'A made-up contest, SFMO 2027, with teams in person and online. Sign in as anyone here.'
                : 'This copy runs entirely in your browser with a made-up contest, SFMO 2027. Nothing leaves this tab; open a second tab as someone else to watch changes arrive.'}
            </p>
            <p className="small muted">Password for every account: <span className="mono">{DEMO_PASSWORD}</span></p>
            <div><Link className="btn btn-primary" to="/sign-in">Go to sign in<Icon name="arrow" /></Link></div>
          </div>
          <ul className="lp-demo-list">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link to={`/sign-in?login=${encodeURIComponent(a.signIn)}`} className="lp-demo-row">
                  <span className="avatar">{initials(a.name)}</span>
                  <span className="grow">
                    <b>{a.name}</b> <span className="muted small">{a.role}</span>
                    <small className="mono">{a.signIn}</small>
                  </span>
                  {a.mode && <ModeChip mode={a.mode} />}
                  <Icon name="arrow" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------- small drawings

function PaperAndBrowser() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlaying(ref);
  const [n, setN] = useState(5);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setN((x) => (x >= 10080 ? 5 : x === 5 ? 1008 : 10080)), 1500);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <div className="mi-pair" ref={ref}>
      <div className="mi-card mi-paper">
        <div className="mi-row-head"><ModeChip mode="in_person">Paper</ModeChip><span className="mono muted">05A</span></div>
        {[['1', '210', 'ok'], ['2', '10080', 'ok'], ['3', '25', 'ok'], ['4', '7/12', 'wait'], ['5', '12', 'bad']].map(([k, v, t]) => (
          <div key={k} className={`mi-key ${t}`}><span className="mono">{k}</span><span className="mono">{v}</span></div>
        ))}
      </div>
      <div className="mi-card mi-browser">
        <div className="mi-row-head"><ModeChip mode="online">Browser</ModeChip><span className="mono">37:36</span></div>
        <i className="mi-time"><em /></i>
        <p className="mi-q"><span className="mono">2</span>How many minutes are in a week?</p>
        <div className="mi-answer mono">{n === 5 ? '' : String(n)}<i className="mk-caret" /></div>
        <span className="mi-saved"><i />Saved</span>
      </div>
    </div>
  );
}

function Ruling() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlaying(ref);
  const [pick, setPick] = useState<0 | 1 | 2>(1);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPick((p) => (p === 1 ? 0 : p === 0 ? 2 : 1)), 1700);
    return () => clearInterval(id);
  }, [playing]);
  const rows: [string, string, number][] = [['3/8', '0.375', 6], ['√12', '2√3', 4], ['x = 4', '4', 2]];
  return (
    <div className="mi-card mi-rule" ref={ref}>
      {rows.map(([a, key, n], i) => (
        <div key={a} className={`mi-rule-row ${i === 0 ? 'on' : ''}`}>
          <span className="mono mi-code">{a}</span>
          <span className="muted small">key {key} · {n} sheets</span>
          <span className="grow" />
          {i === 0 ? (
            <span className="mi-verdict">
              <span className="mi-thumb" style={{ transform: `translateX(${pick === 2 ? 64 : 0}px)`, opacity: pick === 0 ? 0 : 1 }} data-tone={pick === 2 ? 'no' : 'yes'} />
              <span className={pick === 1 ? 'on' : ''}>Correct</span>
              <span className={pick === 2 ? 'on' : ''}>Wrong</span>
            </span>
          ) : (
            <span className={`state ${i === 1 ? 'ok' : 'bad'}`}>{i === 1 ? 'Correct' : 'Wrong'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ImportMini() {
  const rows: [string, string, string, '' | 'dup' | 'miss'][] = [
    ['22', 'Ava Chen', 'l.chen@…', ''],
    ['23', 'Hannah Kim', 'j.kim@…', 'dup'],
    ['23', 'Leo Garcia', '', 'miss'],
    ['23', 'Mia Novak', 'p.novak@…', ''],
  ];
  return (
    <div className="mi-card mi-import">
      <div className="mi-row-head"><b className="small">teams.csv</b><span className="muted tiny">4 rows</span></div>
      {rows.map(([t, n, e, f]) => (
        <div key={n} className={`mi-csv ${f}`}>
          <span className="mono muted">{t}</span>
          <span className="mi-csv-name">{n}</span>
          <span className={f === 'miss' ? 'bad' : 'muted'}>{f === 'dup' ? 'On team 05' : e || 'No email'}</span>
        </div>
      ))}
      <div className="mi-foot"><span className="small"><b className="ok">2 ready</b> · <b className="wait">1 duplicate</b></span><span className="btn btn-sm btn-primary">Import 2</span></div>
    </div>
  );
}

function IntegrityMini() {
  const rows: [string, string, string, string][] = [
    ['10:42', '16B', 'Left the tab', '0:14'],
    ['10:39', '21C', 'Pasted into problem 7', ''],
    ['10:31', '16A', 'Left fullscreen', '0:03'],
  ];
  return (
    <div className="mi-card mi-log">
      <div className="mi-row-head"><b className="small">Zoom Room 1</b><span className="state go">Live</span></div>
      {rows.map(([t, id, what, ms]) => (
        <div key={t} className="mi-log-row">
          <span className="mono muted">{t}</span>
          <span className="mono">{id}</span>
          <span className="grow">{what}{ms && <span className="muted"> · {ms}</span>}</span>
        </div>
      ))}
      <div className="mi-foot"><span className="muted small">16B, 3 events</span><span className="row" style={{ gap: 6 }}><span className="btn btn-sm">Warn</span><span className="btn btn-sm">Lock</span></span></div>
    </div>
  );
}

function KeysMini() {
  const keys: [string, number, number][] = [['Resend · main', 100, 100], ['Resend · second', 38, 100], ['Gmail relay', 0, 400]];
  return (
    <div className="mi-card mi-keys">
      {keys.map(([label, used, limit]) => (
        <div key={label} className="mi-meter">
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="small">{label}</span><span className="mono muted tiny">{used}/{limit}</span></div>
          <i><em className={used >= limit ? 'full' : ''} style={{ '--w': `${(used / limit) * 100}%` } as CSSProperties} /></i>
        </div>
      ))}
      <div className="mi-foot"><span className="small"><b>138 sent</b></span><span className="muted small">0 waiting</span></div>
    </div>
  );
}
