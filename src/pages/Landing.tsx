import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '../styles/public.css';
import { Logo, ArtBoard, ArtLaptop, ArtSheet } from '../components/art';
import { Icon, type IconName } from '../components/icons';
import { ModeChip } from '../components/ui';
import { DEMO_PASSWORD, SHOW_DEMO, demoAccounts } from '../lib/public';
import { REMOTE, useAllDB } from '../lib/store';
import { initials } from '../lib/session';

/** The front page for someone signed out: what MathCloud does, concretely, and a way in. */
export function Landing() {
  return (
    <div className="pub">
      <PublicTop />
      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-in">
            <div className="lp-hero-copy">
              <span className="kicker">For people who run math contests</span>
              <h1>Run your math contest in person and online, from one place.</h1>
              <p className="lp-lede">
                One roster, one answer key, one set of results. Teams in the room write on paper and graders key the sheets; teams at home
                take the same rounds in the browser on Zoom, at the same moment. MathCloud handles the registration, waivers, grading,
                the live Guts board and the score reports in between.
              </p>
              <div className="actions lp-cta">
                <Link className="btn btn-primary btn-lg" to="/sign-up">Create an organisation</Link>
                {SHOW_DEMO ? <a className="btn btn-lg" href="#demo">Try it with demo accounts</a> : <Link className="btn btn-lg" to="/sign-in">Sign in</Link>}
              </div>
              <ul className="lp-facts">
                <li><Icon name="check" size={14} />Each student sees the schedule in their own time zone</li>
                <li><Icon name="check" size={14} />Students without email sign in with a username</li>
              </ul>
            </div>
            <div className="lp-hero-art">
              <HeroArt />
            </div>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2>How a contest runs</h2>
              <p>Five steps, the same for both divisions. Each one feeds the next, so nothing is copied between spreadsheets.</p>
            </div>
            <ol className="lp-flow">
              {FLOW.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-flow-n">{i + 1}</span>
                  <div>
                    <h3><Icon name={s.icon} size={15} />{s.title}</h3>
                    <p>{s.text}</p>
                    <span className="lp-flow-eg">{s.eg}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section lp-features" id="features">
          <div className="lp-wrap stack-lg">
            <div className="lp-head">
              <h2>What it does</h2>
              <p>The parts of a contest day that usually live in five tools and a group chat.</p>
            </div>

            <Feature
              title="Registration, with CSV import that checks for duplicates"
              art={<ImportArt />}
              points={[
                'Coaches register on your contest page and choose in person or online; each team gets a code and competitor IDs.',
                'Teams that signed up elsewhere come in from a spreadsheet. Every row is checked before anything is saved: the same student twice, a missing guardian email, a team that is already full.',
                'Waiver links go to guardians by email. The roster and the check-in desk both show who is still missing one.',
              ]}
            />

            <Feature
              flip
              title="Paper in the room, the browser at home, scored together"
              art={
                <div className="lp-pair">
                  <figure><ModeChip mode="in_person">In person · paper</ModeChip><ArtSheet className="lp-art" /></figure>
                  <figure><ModeChip mode="online">Online · on Zoom</ModeChip><ArtLaptop className="lp-art" /></figure>
                </div>
              }
              points={[
                'In person: graders key answer sheets by competitor ID. An answer that is not in the key goes to a ruling queue and is decided once for everyone.',
                'Online: students take the round in the browser with a server clock. Leaving the tab, pasting or a second device is logged for the proctor.',
                'Proctors each watch one Zoom room, with the integrity log for their students beside it. They can warn, lock and unlock.',
              ]}
            />

            <Feature
              title="A live Guts board for the projector"
              art={<ArtBoard className="lp-art" />}
              points={[
                'Scores update as sets are handed in or keyed, on paper and online alike.',
                'The board freezes in the last minutes, then you reveal it at awards.',
                'Online teams see the same board beside their questions.',
              ]}
            />

            <Feature
              flip
              title="Score reports, emailed through your own keys"
              art={<ReportArt />}
              points={[
                'Weights, best-three team scores and tie-breaks by harder problems are yours to set. Awards follow your rules: top 3, top 25%.',
                'Each student gets a report with every round and problem. Coaches get the team’s.',
                'Mail goes out through your own provider keys, each up to its daily limit; what does not fit today waits for tomorrow.',
              ]}
            />
          </div>
        </section>

        <section className="lp-section" id="who">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2>Who uses it</h2>
              <p>Everyone signs in at the same place and lands on their own page.</p>
            </div>
            <div className="lp-who">
              {WHO.map((w) => (
                <article key={w.id} id={w.id} className="lp-who-col">
                  <span className="lp-who-ic"><Icon name={w.icon} size={18} /></span>
                  <h3>{w.title}</h3>
                  <ul>
                    {w.points.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {SHOW_DEMO && <DemoBlock />}
      </main>
      <PublicFooter />
    </div>
  );
}

/** The bar on every public page. */
export function PublicTop({ nav = true }: { nav?: boolean }) {
  return (
    <header className="pub-top">
      <div className="lp-wrap pub-top-in">
        <Link to="/" className="brand"><Logo size={26} /><span>MathCloud</span></Link>
        {nav && (
          <nav className="pub-nav" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#organisers">For organisers</a>
            <a href="#coaches">For coaches</a>
            <a href="#students">For students</a>
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
        <nav className="row wrap small" style={{ gap: 18 }}>
          <Link to="/sign-in">Sign in</Link>
          <Link to="/sign-up">Create an organisation</Link>
          {!REMOTE && <Link to="/c/sfmo-2027">Example contest page</Link>}
        </nav>
      </div>
    </footer>
  );
}

const FLOW: { title: string; text: string; eg: string; icon: IconName }[] = [
  { title: 'Register', icon: 'roster', text: 'Coaches sign up on your contest page, or you import a spreadsheet.', eg: '21 teams · 79 students' },
  { title: 'Waivers', icon: 'file', text: 'Guardians get a link by email and sign with their name. Reminders go to the rest.', eg: '74 of 79 signed' },
  { title: 'Rounds', icon: 'rounds', text: 'Paper in rooms at the venue, the browser on Zoom at home, on one schedule.', eg: 'Individual 9:20 · Guts 12:00' },
  { title: 'Grading', icon: 'grading', text: 'Sheets keyed by ID, online answers checked as they arrive, odd answers ruled once.', eg: '3 answers to rule on' },
  { title: 'Results', icon: 'results', text: 'Standings with your weights and tie-breaks, then a score report to every family.', eg: 'Published 14:05' },
];

const WHO: { id: string; title: string; icon: IconName; points: string[] }[] = [
  {
    id: 'organisers', title: 'For organisers', icon: 'overview',
    points: [
      'Set up divisions, rounds, rooms and the day’s schedule in one place.',
      'Import teams, chase waivers, check people in.',
      'Open rounds, watch submissions arrive, rule on answers.',
      'Publish results and send score reports and certificates.',
    ],
  },
  {
    id: 'coaches', title: 'For coaches', icon: 'roster',
    points: [
      'Register teams and add students, with a join code for the ones who have email.',
      'See whose waiver is missing and resend the link.',
      'Make sign-ins for younger students who have no email.',
      'Read every student’s score report after results are out.',
    ],
  },
  {
    id: 'students', title: 'For students', icon: 'people',
    points: [
      'Your competitor ID, room or Zoom link and the schedule, in your own time zone.',
      'A device check before the day, if you compete online.',
      'Rounds in the browser with the clock and saved answers in view.',
      'Your own score report, problem by problem.',
    ],
  },
];

function Feature({ title, points, art, flip }: { title: string; points: string[]; art: ReactNode; flip?: boolean }) {
  return (
    <article className={`lp-feature ${flip ? 'flip' : ''}`}>
      <div className="lp-feature-copy">
        <h3>{title}</h3>
        <ul>
          {points.map((p) => <li key={p}><Icon name="check" size={14} /><span>{p}</span></li>)}
        </ul>
      </div>
      <div className="lp-feature-art">{art}</div>
    </article>
  );
}

function DemoBlock() {
  const db = useAllDB();
  const accounts = demoAccounts(db);
  return (
    <section className="lp-section" id="demo">
      <div className="lp-wrap">
        <div className="lp-demo card">
          <div className="lp-demo-copy">
            <h2>Try it with demo accounts</h2>
            <p className="soft">
              {REMOTE
                ? 'A made-up contest, SFMO 2027, with 21 teams in person and online. Sign in as anyone below.'
                : 'This copy runs entirely in your browser with a made-up contest, SFMO 2027. Nothing you do leaves this tab; open a second tab as someone else to watch changes arrive.'}
            </p>
            <p className="small muted">Password for every account: <span className="mono">{DEMO_PASSWORD}</span></p>
            <Link className="btn btn-primary" to="/sign-in">Go to sign in</Link>
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

// ------------------------------------------------------------------ drawings

const T = { fontFamily: 'var(--sans)' } as const;
const M = { fontFamily: 'var(--mono)' } as const;

/** The organiser's view at noon on contest day: both divisions, the rounds so far, Guts live. */
function HeroArt() {
  const board: [string, number, number, 'p' | 'o'][] = [
    ['Tidepool Theorems', 67, 5, 'p'], ['Moon Jellies', 62, 5, 'o'], ['Hydrothermal', 60, 4, 'p'], ['Blue Tangents', 56, 4, 'o'], ['Rip Current', 48, 3, 'p'],
  ];
  const rounds: [string, string, string, number][] = [
    ['Individual', 'Graded', 'var(--green)', 1], ['Mystery Dive', 'Keying 88%', 'var(--amber)', 0.88], ['Guts', 'Live · 37:41 left', 'var(--blue)', 0.38],
  ];
  return (
    <svg viewBox="0 0 560 430" role="img" aria-label="An organiser's overview during the Guts round: check-in for both divisions, round progress and the live board" className="lp-hero-svg">
      {/* window */}
      <rect x="8" y="8" width="520" height="372" rx="12" fill="var(--bg)" stroke="var(--line-2)" />
      <path d="M8 20a12 12 0 0 1 12-12h496a12 12 0 0 1 12 12v24H8z" fill="var(--bg-2)" />
      <rect x="8" y="44" width="520" height="1" fill="var(--line)" />
      <circle cx="28" cy="26" r="4" fill="var(--line-2)" /><circle cx="42" cy="26" r="4" fill="var(--line-2)" /><circle cx="56" cy="26" r="4" fill="var(--line-2)" />
      <text x="78" y="30" fontSize="12" fontWeight="700" fill="var(--ink)" {...T}>SFMO 2027</text>
      <text x="146" y="30" fontSize="11.5" fill="var(--ink-3)" {...T}>Saturday 23 January</text>
      <rect x="418" y="16" width="96" height="20" rx="10" fill="var(--blue-soft)" />
      <circle cx="431" cy="26" r="3.5" fill="var(--blue)" />
      <text x="441" y="30" fontSize="11" fontWeight="700" fill="var(--blue)" {...T}>Guts is live</text>

      {/* two divisions */}
      {[
        { x: 28, label: 'In person', sub: 'checked in', n: '52', of: '/ 52', c: 'var(--green)', soft: 'var(--green-soft)', frac: 1 },
        { x: 168, label: 'Online', sub: 'in Zoom rooms', n: '31', of: '/ 32', c: 'var(--blue)', soft: 'var(--blue-soft)', frac: 31 / 32 },
      ].map((d) => (
        <g key={d.label} transform={`translate(${d.x} 62)`}>
          <rect width="128" height="78" rx="9" fill="var(--bg)" stroke="var(--line)" />
          <rect x="12" y="12" width={d.label === 'Online' ? 54 : 66} height="18" rx="9" fill={d.soft} />
          {d.label === 'Online'
            ? <g stroke={d.c} strokeWidth="1.4" fill="none"><rect x="19" y="16.5" width="9" height="6.5" rx="1.2" /><path d="M21.5 25.5h4" /></g>
            : <g stroke={d.c} strokeWidth="1.4" fill="none"><path d="M23.5 27s-3.6-3.1-3.6-6a3.6 3.6 0 0 1 7.2 0c0 2.9-3.6 6-3.6 6z" /></g>}
          <text x="31" y="25" fontSize="10" fontWeight="700" fill={d.c} {...T}>{d.label}</text>
          <text x="12" y="56" fontSize="22" fontWeight="700" fill="var(--ink)" {...T}>{d.n}</text>
          <text x={d.n.length > 1 ? 41 : 30} y="56" fontSize="12" fill="var(--ink-3)" {...T}>{d.of} {d.sub}</text>
          <rect x="12" y="64" width="104" height="4" rx="2" fill="var(--bg-3)" />
          <rect x="12" y="64" width={104 * d.frac} height="4" rx="2" fill={d.c} />
        </g>
      ))}

      {/* rounds */}
      <text x="28" y="166" fontSize="11" fontWeight="700" fill="var(--ink-3)" {...T}>ROUNDS</text>
      {rounds.map(([name, state, c, frac], i) => (
        <g key={name} transform={`translate(28 ${178 + i * 36})`}>
          <text x="0" y="12" fontSize="12" fontWeight="600" fill="var(--ink)" {...T}>{name}</text>
          <text x="268" y="12" fontSize="11" fill={c} fontWeight="600" textAnchor="end" {...T}>{state}</text>
          <rect x="0" y="19" width="268" height="5" rx="2.5" fill="var(--bg-3)" />
          <rect x="0" y="19" width={268 * frac} height="5" rx="2.5" fill={c} />
        </g>
      ))}

      {/* activity */}
      <rect x="28" y="290" width="268" height="72" rx="9" fill="var(--bg-2)" />
      {[
        ['12:22', 'Moon Jellies handed in set 5', 'var(--blue)'],
        ['12:21', 'Sheet 05A keyed by Sam Ortega', 'var(--green)'],
        ['12:19', '“3/8” vs key “0.375”: ruled correct', 'var(--amber)'],
      ].map(([t, s, c], i) => (
        <g key={t} transform={`translate(40 ${306 + i * 19})`}>
          <circle cx="3" cy="0" r="3" fill={c} />
          <text x="12" y="4" fontSize="10.5" fill="var(--ink-3)" {...M}>{t}</text>
          <text x="50" y="4" fontSize="10.5" fill="var(--ink-2)" {...T}>{s}</text>
        </g>
      ))}

      {/* the board */}
      <rect x="314" y="62" width="196" height="300" rx="9" fill="#0D1117" />
      <text x="330" y="88" fontSize="13" fontWeight="700" fill="#F3F5F9" {...T}>Guts board</text>
      <text x="494" y="88" fontSize="13" fontWeight="600" fill="#F3F5F9" textAnchor="end" {...M}>37:41</text>
      <rect x="330" y="98" width="164" height="2" fill="#232A35" />
      <rect x="330" y="98" width="62" height="2" fill="#7C9BFF" />
      {board.map(([name, score, sets, mode], i) => (
        <g key={name} transform={`translate(330 ${118 + i * 44})`}>
          <text x="0" y="12" fontSize="11" fontWeight="700" fill={i < 3 ? '#F3F5F9' : '#9AA3B2'} {...T}>{i + 1}</text>
          <circle cx="16" cy="8" r="3" fill={mode === 'p' ? '#3CC48D' : '#7C9BFF'} />
          <text x="25" y="12" fontSize="11" fontWeight="600" fill="#F3F5F9" {...T}>{name}</text>
          <text x="164" y="12" fontSize="12" fontWeight="700" fill="#F3F5F9" textAnchor="end" {...T}>{score}</text>
          {Array.from({ length: 6 }, (_, k) => (
            <rect key={k} x={k * 18} y="22" width="15" height="5" rx="1.5" fill={k < sets - 1 ? '#3CC48D' : k === sets - 1 ? '#7C9BFF' : '#2A3240'} />
          ))}
        </g>
      ))}
      <circle cx="334" cy="346" r="3" fill="#3CC48D" /><text x="342" y="349" fontSize="9.5" fill="#9AA3B2" {...T}>In person</text>
      <circle cx="398" cy="346" r="3" fill="#7C9BFF" /><text x="406" y="349" fontSize="9.5" fill="#9AA3B2" {...T}>Online</text>

      {/* a paper sheet on the desk */}
      <g transform="translate(400 300)">
        <rect x="4" y="6" width="142" height="118" rx="6" fill="rgba(18,21,28,.08)" />
        <rect width="142" height="118" rx="6" fill="var(--bg)" stroke="var(--line-2)" />
        <text x="12" y="20" fontSize="10.5" fontWeight="700" fill="var(--ink)" {...T}>Guts · set 5</text>
        <text x="130" y="20" fontSize="10.5" fontWeight="700" fill="var(--ink-2)" textAnchor="end" {...M}>T05</text>
        {[['17', '144', 'g'], ['18', '7/12', 'g'], ['19', '2√3', 'a'], ['20', '', '']].map(([n, v, t], i) => (
          <g key={n} transform={`translate(12 ${32 + i * 20})`}>
            <text x="0" y="11" fontSize="9.5" fill="var(--ink-3)" {...M}>{n}</text>
            <rect x="20" y="0" width="98" height="15" rx="3" fill={t === 'g' ? 'var(--green-soft)' : t === 'a' ? 'var(--amber-soft)' : 'var(--bg-2)'} />
            <text x="27" y="11" fontSize="10" fontWeight="700" fill={t === 'g' ? 'var(--green)' : t === 'a' ? 'var(--amber)' : 'var(--ink-3)'} {...M}>{v}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** A spreadsheet coming in, with one row the import stops on. */
function ImportArt() {
  const rows: [string, string, string, string, '' | 'dup' | 'miss'][] = [
    ['22', 'Ava Chen', '8', 'l.chen@…', ''],
    ['22', 'Noah Patel', '7', 'r.patel@…', ''],
    ['23', 'Hannah Kim', '8', 'j.kim@…', 'dup'],
    ['23', 'Leo Garcia', '6', '', 'miss'],
    ['23', 'Mia Novak', '7', 'p.novak@…', ''],
  ];
  return (
    <svg viewBox="0 0 400 270" role="img" aria-label="A spreadsheet import with one duplicate student and one missing guardian email" className="lp-art">
      <rect x="6" y="6" width="388" height="258" rx="10" fill="var(--bg)" stroke="var(--line-2)" />
      <text x="22" y="32" fontSize="12.5" fontWeight="700" fill="var(--ink)" {...T}>teams-from-form.csv</text>
      <text x="378" y="32" fontSize="11" fill="var(--ink-3)" textAnchor="end" {...T}>5 rows</text>
      <rect x="6" y="44" width="388" height="24" fill="var(--bg-2)" />
      {['Team', 'Student', 'Grade', 'Guardian email'].map((h, i) => (
        <text key={h} x={[22, 66, 186, 232][i]} y="60" fontSize="10.5" fontWeight="700" fill="var(--ink-3)" {...T}>{h}</text>
      ))}
      {rows.map(([team, name, grade, email, flag], i) => {
        const y = 68 + i * 28;
        return (
          <g key={name}>
            {flag && <rect x="6" y={y} width="388" height="28" fill={flag === 'dup' ? 'var(--amber-soft)' : 'var(--red-soft)'} />}
            <rect x="6" y={y + 27.5} width="388" height="0.8" fill="var(--line)" />
            <text x="22" y={y + 18} fontSize="11" fill="var(--ink-2)" {...M}>{team}</text>
            <text x="66" y={y + 18} fontSize="11.5" fontWeight="600" fill="var(--ink)" {...T}>{name}</text>
            <text x="186" y={y + 18} fontSize="11" fill="var(--ink-2)" {...M}>{grade}</text>
            <text x="232" y={y + 18} fontSize="11" fill={email ? 'var(--ink-2)' : 'var(--red)'} {...T}>{email || 'missing'}</text>
            {flag === 'dup' && <text x="378" y={y + 18} fontSize="10.5" fontWeight="700" fill="var(--amber)" textAnchor="end" {...T}>Already on team 05</text>}
          </g>
        );
      })}
      <rect x="6" y="208" width="388" height="56" rx="0" fill="var(--bg-2)" />
      <path d="M6 252v2a10 10 0 0 0 10 10h368a10 10 0 0 0 10-10v-2z" fill="var(--bg-2)" />
      <text x="22" y="232" fontSize="11.5" fill="var(--ink-2)" {...T}><tspan fontWeight="700" fill="var(--green)">3 ready</tspan> · <tspan fontWeight="700" fill="var(--amber)">1 duplicate</tspan> · <tspan fontWeight="700" fill="var(--red)">1 needs an email</tspan></text>
      <rect x="282" y="218" width="96" height="26" rx="6" fill="var(--blue)" />
      <text x="330" y="235" fontSize="11.5" fontWeight="700" fill="#fff" textAnchor="middle" {...T}>Import 3</text>
    </svg>
  );
}

/** One student's report, and the pool of keys it went out through. */
function ReportArt() {
  const keys: [string, number, number][] = [['Resend · main', 100, 100], ['Resend · second', 38, 100], ['Gmail relay', 0, 400]];
  return (
    <svg viewBox="0 0 400 270" role="img" aria-label="A student's score report and the email keys that sent it" className="lp-art">
      <rect x="6" y="6" width="226" height="258" rx="10" fill="var(--bg)" stroke="var(--line-2)" />
      <text x="20" y="30" fontSize="10.5" fill="var(--ink-3)" {...T}>To: carter’s family</text>
      <text x="20" y="50" fontSize="13" fontWeight="700" fill="var(--ink)" {...T}>Your SFMO 2027 results</text>
      <rect x="20" y="62" width="198" height="1" fill="var(--line)" />
      <text x="20" y="88" fontSize="24" fontWeight="700" fill="var(--ink)" {...T}>6th</text>
      <text x="66" y="88" fontSize="11.5" fill="var(--ink-3)" {...T}>of 112 online</text>
      <rect x="20" y="98" width="102" height="18" rx="9" fill="var(--green-soft)" />
      <text x="71" y="111" fontSize="10.5" fontWeight="700" fill="var(--green)" textAnchor="middle" {...T}>Distinguished HM</text>
      {[['Individual', 34, 50], ['Mystery Dive', 21, 30], ['Guts', 56, 90]].map(([n, s, m], i) => (
        <g key={String(n)} transform={`translate(20 ${136 + i * 26})`}>
          <text x="0" y="10" fontSize="11" fill="var(--ink-2)" {...T}>{n}</text>
          <text x="198" y="10" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="end" {...M}>{s}/{m}</text>
          <rect x="0" y="15" width="198" height="4" rx="2" fill="var(--bg-3)" />
          <rect x="0" y="15" width={(198 * Number(s)) / Number(m)} height="4" rx="2" fill="var(--blue)" />
        </g>
      ))}
      <g transform="translate(20 222)">
        {Array.from({ length: 15 }, (_, k) => (
          <rect key={k} x={k * 13.2} y="0" width="10" height="16" rx="2" fill={[3, 9, 13].includes(k) ? 'var(--red-soft)' : k === 14 ? 'var(--bg-3)' : 'var(--green-soft)'} stroke={[3, 9, 13].includes(k) ? 'var(--red)' : k === 14 ? 'var(--line-2)' : 'var(--green)'} strokeWidth="0.8" />
        ))}
        <text x="0" y="32" fontSize="9.5" fill="var(--ink-3)" {...T}>Individual, problem by problem</text>
      </g>

      <rect x="246" y="6" width="148" height="258" rx="10" fill="var(--bg-2)" />
      <text x="260" y="30" fontSize="11" fontWeight="700" fill="var(--ink-3)" {...T}>SENDING KEYS · TODAY</text>
      {keys.map(([label, used, limit], i) => (
        <g key={label} transform={`translate(260 ${50 + i * 50})`}>
          <text x="0" y="10" fontSize="11" fontWeight="600" fill="var(--ink)" {...T}>{label}</text>
          <text x="120" y="10" fontSize="10.5" fill="var(--ink-3)" textAnchor="end" {...M}>{used}/{limit}</text>
          <rect x="0" y="18" width="120" height="6" rx="3" fill="var(--bg-3)" />
          <rect x="0" y="18" width={(120 * used) / limit} height="6" rx="3" fill={used >= limit ? 'var(--amber)' : 'var(--green)'} />
          {used >= limit && <text x="0" y="38" fontSize="9.5" fill="var(--amber)" {...T}>Full today, next key takes over</text>}
        </g>
      ))}
      <rect x="260" y="208" width="120" height="1" fill="var(--line-2)" />
      <text x="260" y="230" fontSize="12" fontWeight="700" fill="var(--ink)" {...T}>138 sent</text>
      <text x="260" y="248" fontSize="11" fill="var(--ink-3)" {...T}>0 waiting for tomorrow</text>
    </svg>
  );
}
