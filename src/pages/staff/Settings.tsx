import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addVenueRoom, addZoomRoom, copyProblemsFrom, createEdition, divisionFor, linkedEdition, MODE_LABEL, offers, removeRoom, saveDivision, saveRound, saveVenue,
  setCoachesUseMathCloud, setMode, setRegistration, setRoomProctor,
} from '../../lib/actions';
import { saveContestBasics, saveSlug, slugProblem, toSlug } from '../../lib/contestSettings';
import { useContest } from '../../lib/hooks';
import type { DivisionMode, IntegrityPolicy } from '../../lib/model';
import { setActiveContest, useAllDB, useDB } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';
import { Icon, type IconName } from '../../components/icons';
import { Choice, Modal, ModeChip, State, toast } from '../../components/ui';
import '../../styles/settings.css';

const POLICY: Record<IntegrityPolicy, string> = {
  log: 'Record it for the proctor',
  warn: 'Warn the student, then record it',
  lock: 'Lock the test until a proctor unlocks it',
};

const ZONES_FALLBACK = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Bucharest', 'Asia/Kolkata', 'Asia/Tashkent', 'Asia/Almaty', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
];
const ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ZONES_FALLBACK;

const zoneNow = (tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date());
  } catch {
    return '';
  }
};

type SectionId = 'contest' | 'registration' | 'taking-part' | 'in-person' | 'online' | 'staff';

export function Settings() {
  const contest = useContest();
  const sections: { id: SectionId; label: string; icon: IconName; show: boolean }[] = [
    { id: 'contest', label: 'Contest', icon: 'calendar', show: true },
    { id: 'registration', label: 'Registration', icon: 'ticket', show: true },
    { id: 'taking-part', label: 'How teams take part', icon: 'both', show: true },
    { id: 'in-person', label: 'Venue and rooms', icon: 'pin', show: offers(contest, 'in_person') && !!contest.venue },
    { id: 'online', label: 'Online and Zoom', icon: 'screen', show: offers(contest, 'online') },
    { id: 'staff', label: 'Staff', icon: 'people', show: true },
  ];
  const shown = sections.filter((s) => s.show);
  const [active, setActive] = useState<SectionId>('contest');
  // The white pill glides to the section being read, like the sidebar's.
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; on: boolean }>({ y: 0, on: false });
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('a.on');
    setPill(el ? { y: el.offsetTop, on: true } : (p) => ({ ...p, on: false }));
  }, [active, shown.length]);

  // Highlight the section being read.
  useEffect(() => {
    const els = shown.map((s) => document.getElementById(s.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id as SectionId);
    }, { rootMargin: '-15% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [shown.map((s) => s.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">How {contest.short} runs. Changes apply straight away, for everyone.</p>
        </div>
      </div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections" ref={navRef}>
          <span className="set-pill" style={{ transform: `translateY(${pill.y}px)`, opacity: pill.on ? 1 : 0 }} aria-hidden="true" />
          {shown.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'on' : ''} aria-current={active === s.id ? 'true' : undefined} onClick={(e) => {
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setActive(s.id);
            }}><Icon name={s.icon} size={15} />{s.label}</a>
          ))}
        </nav>
        <div className="set-main">
          <ContestSection />
          <RegistrationSection />
          <TakingPart />
          {offers(contest, 'in_person') && contest.venue && <VenueSection />}
          {offers(contest, 'online') && <OnlineSection />}
          <Section id="staff" title="Staff" note="Directors, staff, graders and proctors">
            <div className="card row wrap set-staff">
              <span className="ic-sq"><Icon name="people" /></span>
              <p className="grow soft small" style={{ margin: 0 }}>Inviting people, roles, and which rounds each grader keys are under People.</p>
              <Link className="btn btn-sm" to="/staff/people?tab=staff">Manage staff<Icon name="arrow" size={14} /></Link>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ id, title, note, children, aside }: { id: SectionId; title: string; note?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="section set-section">
      <div className="section-head">
        <h2>{title}</h2>
        {aside ?? (note && <span className="label">{note}</span>)}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- contest

function ContestSection() {
  const contest = useContest();
  const [slug, setSlug] = useState(contest.slug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setSlug(contest.slug), [contest.slug]);
  const publicPath = `/c/${contest.slug}`;
  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${publicPath}`;
  const dirty = slug !== contest.slug;

  const commitSlug = async () => {
    setSaving(true);
    const why = await saveSlug(slug);
    setSaving(false);
    setSlugError(why);
    if (!why) toast('Public address changed', `${window.location.host}/c/${slug}. Old links stop working.`, 'g');
  };
  const copy = () => {
    void navigator.clipboard?.writeText(publicUrl).then(() => toast('Link copied', publicUrl), () => toast('Could not copy', publicUrl, 'a'));
  };

  return (
    <Section id="contest" title="Contest" note="Shown on every page, email and certificate">
      <div className="card stack">
        <div className="form-grid set-grid">
          <label className="field span-2">
            <span>Name</span>
            <input className="input" value={contest.name} onChange={(e) => saveContestBasics({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Short name</span>
            <input className="input" value={contest.short} maxLength={24} onChange={(e) => saveContestBasics({ short: e.target.value })} />
            <small>In tabs, headers and subject lines.</small>
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" value={contest.dateLabel} onChange={(e) => saveContestBasics({ dateLabel: e.target.value })} placeholder="Saturday 23 January 2027" />
            <small>As it is written on pages and emails.</small>
          </label>
          <label className="field span-2">
            <span>Time zone</span>
            <select className="select" value={contest.timeZone} onChange={(e) => saveContestBasics({ timeZone: e.target.value })}>
              {(ZONES.includes(contest.timeZone) ? ZONES : [contest.timeZone, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
            <small>Round times are shown in this zone; now {zoneNow(contest.timeZone)}. Online teams also see their own.</small>
          </label>
        </div>
        <div className="set-slug">
          <label className="field">
            <span>Public address</span>
            <div className="set-slug-in">
              <span className="mono soft small">{window.location.host}/c/</span>
              <input className="input mono" value={slug} onChange={(e) => { setSlug(toSlug(e.target.value.replace(/-$/, '')) + (e.target.value.endsWith('-') ? '-' : '')); setSlugError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && dirty && void commitSlug()} aria-invalid={!!(slugError ?? (dirty && slugProblem(slug, contest.id)))} />
            </div>
            {slugError ? <small className="set-err">{slugError}</small> : dirty ? <small>{slugProblem(slug, contest.id) ?? 'Links already sent to coaches will stop working.'}</small> : <small>The contest page, registration and results live here.</small>}
          </label>
          <div className="row wrap set-slug-act">
            {dirty ? (
              <>
                <button className="btn btn-primary btn-sm" type="button" disabled={saving || !!slugProblem(slug, contest.id)} onClick={() => void commitSlug()}><Icon name="check" size={14} />Save address</button>
                <button className="btn btn-sm btn-quiet" type="button" onClick={() => { setSlug(contest.slug); setSlugError(null); }}>Cancel</button>
              </>
            ) : (
              <>
                <Link className="btn btn-sm" to={publicPath}><Icon name="globe" size={14} />Open</Link>
                <button className="btn btn-sm btn-quiet" type="button" onClick={copy}><Icon name="link" size={14} />Copy link</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------- registration

function RegistrationSection() {
  const contest = useContest();
  const db = useDB();
  const navigate = useNavigate();
  const reg = contest.registration;
  const both = contest.divisions.length > 1;
  const [closes, setCloses, flushCloses] = useDraft(reg.closesLabel, (v) => setRegistration({ closesLabel: v }));
  const sizes = new Map<string, number>();
  for (const c of db.competitors) sizes.set(c.teamId, (sizes.get(c.teamId) ?? 0) + 1);
  const biggest = Math.max(0, ...sizes.values());
  const live = db.teams.filter((t) => t.status !== 'withdrawn').length;
  const coaches = reg.coaches !== false;
  const other = linkedEdition(useAllDB(), contest);
  const setCoaches = (on: boolean) => {
    setCoachesUseMathCloud(on);
    if (!on && reg.open) setRegistration({ open: false });
    toast(on ? 'Coaches can register' : 'Organisers enter every team', on ? 'Open registration when you are ready.' : 'Coaches never need an account. Students sign in only to take tests.', 'g');
  };

  if (!coaches) {
    return (
      <Section id="registration" title="Teams" note="Who brings teams into MathCloud">
        <div className="card stack">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="ic-sq"><Icon name="upload" /></span>
            <div className="stack" style={{ gap: 4 }}>
              <b>The organisers enter every team</b>
              <p className="soft small" style={{ margin: 0 }}>
                Import them from your old sign-up, a Google Form or Excel, or add them one by one. Coaches never need an account; one who signs up with the email you
                imported sees their teams. Students sign in only to take their tests. {live} teams so far.
              </p>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn btn-primary" to="/staff/import?type=teams"><Icon name="upload" />Import teams</Link>
            <Link className="btn" to="/staff/teams"><Icon name="roster" />Teams</Link>
            <span className="grow" />
            <button className="btn btn-quiet" type="button" onClick={() => setCoaches(true)}>Let coaches register instead</button>
          </div>
          <div className="form-grid set-grid">
            <label className="field">
              <span>Smallest team</span>
              <select className="select" value={reg.teamMin} onChange={(e) => setRegistration({ teamMin: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6].filter((n) => n <= reg.teamMax).map((n) => <option key={n} value={n}>{n} {n === 1 ? 'student' : 'students'}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Largest team</span>
              <select className="select" value={reg.teamMax} onChange={(e) => setRegistration({ teamMax: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7, 8].filter((n) => n >= reg.teamMin).map((n) => <option key={n} value={n} disabled={n < biggest}>{n} {n === 1 ? 'student' : 'students'}{n < biggest ? ' (a team is bigger)' : ''}</option>)}
              </select>
            </label>
          </div>
          {other && <p className="muted small" style={{ margin: 0 }}>This applies to {contest.short} {MODE_LABEL[contest.divisions[0]?.mode ?? 'in_person'].toLowerCase()}; the {MODE_LABEL[other.divisions[0]?.mode ?? 'online'].toLowerCase()} edition has its own setting.</p>}
        </div>
      </Section>
    );
  }

  return (
    <Section id="registration" title="Registration" aside={
      <span className="row" style={{ gap: 12 }}>
        <State tone={reg.open ? 'ok' : 'off'}>{reg.open ? 'Open to coaches' : 'Closed'}</State>
        <button className="btn btn-sm" type="button" onClick={() => {
          const open = !reg.open;
          setRegistration({ open });
          toast(open ? 'Registration is open' : 'Registration is closed', open ? 'Coaches can register and edit their teams.' : 'Coaches can no longer add teams. You still can.', open ? 'g' : '');
        }}>{reg.open ? 'Close registration' : 'Open registration'}</button>
      </span>
    }>
      <div className="card stack">
        <div className="form-grid set-grid">
          <label className="field">
            <span>Closes</span>
            <input className="input" value={closes} onChange={(e) => setCloses(e.target.value)} onBlur={flushCloses} placeholder="9 Jan" />
            <small>Shown on the form. It does not close by itself.</small>
          </label>
          <label className="field">
            <span>Smallest team</span>
            <select className="select" value={reg.teamMin} onChange={(e) => setRegistration({ teamMin: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].filter((n) => n <= reg.teamMax).map((n) => <option key={n} value={n}>{n} {n === 1 ? 'student' : 'students'}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Largest team</span>
            <select className="select" value={reg.teamMax} onChange={(e) => setRegistration({ teamMax: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7, 8].filter((n) => n >= reg.teamMin).map((n) => <option key={n} value={n} disabled={n < biggest}>{n} {n === 1 ? 'student' : 'students'}{n < biggest ? ' (a team is bigger)' : ''}</option>)}
            </select>
          </label>
        </div>
        <div className="split-wide set-reg">
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}><span className="ic-sq"><Icon name="link" /></span><b>Registration form</b></div>
            <p className="soft small" style={{ margin: 0 }}>{both ? 'Coaches choose in person or online first, then add their team. They can switch until registration closes.' : 'Coaches add their team and students.'} {live} teams so far.</p>
            <div className="row wrap">
              <span className="mono small soft">{window.location.host}/register/{contest.slug}</span>
              <button className="btn btn-sm" type="button" onClick={() => navigate(`/register/${contest.slug}`)}>Open the form<Icon name="arrow-up-right" size={14} /></button>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}><span className="ic-sq"><Icon name="table" /></span><b>Teams who signed up elsewhere</b></div>
            <p className="soft small" style={{ margin: 0 }}>A Google Form, your own website, a spreadsheet from a coach. Bring in a CSV with any columns; duplicates are found for you.</p>
            <div><Link className="btn btn-sm" to="/staff/import?type=teams"><Icon name="upload" />Import a CSV</Link></div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-quiet" type="button" onClick={() => setCoaches(false)}>Organisers enter every team instead</button>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------ taking part

function TakingPart() {
  const contest = useContest();
  // Contests made before editions existed may still run both ways; they keep the old switches.
  return contest.divisions.length > 1 ? <BothWays /> : <Edition />;
}

/** One way of taking part per contest. Running the other way at the same time is the linked edition. */
function Edition() {
  const contest = useContest();
  const db = useDB();
  const all = useAllDB();
  const navigate = useNavigate();
  const mode: DivisionMode = contest.divisions[0]?.mode ?? 'in_person';
  const otherMode: DivisionMode = mode === 'online' ? 'in_person' : 'online';
  const other = linkedEdition(all, contest);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const live = db.teams.filter((t) => t.status !== 'withdrawn').length;
  const otherTeams = other ? all.teams.filter((t) => t.contestId === other.id && t.status !== 'withdrawn').length : 0;
  const open = (id: string) => { setActiveContest(id, { load: true }); navigate('/staff'); };
  const make = async () => {
    setBusy(true);
    try {
      const id = await createEdition(contest.id, otherMode);
      toast(`${contest.short} ${MODE_LABEL[otherMode].toLowerCase()} is ready`, 'Same rounds, problems and keys, copied. Its teams, rooms and results are its own.', 'g');
      open(id);
    } catch (e) {
      toast('Edition not created', e instanceof Error ? e.message : String(e), 'r');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="taking-part" title="How teams take part" note="One way per contest; the other way is a linked edition">
      <div className="choices">
        <Choice tone={mode} icon={mode === 'online' ? 'screen' : 'pin'} title={`${MODE_LABEL[mode]}: this contest`} checked onSelect={() => undefined}
          points={mode === 'online'
            ? [{ icon: 'screen', text: 'Tests in the browser, marked as they go' }, { icon: 'video', text: `${contest.rooms.length} Zoom ${contest.rooms.length === 1 ? 'room' : 'rooms'}, each with a proctor` }]
            : [{ icon: 'file', text: 'Paper answers, keyed in by graders' }, { icon: 'ticket', text: 'Check-in, rooms, projector board' }]}>
          {live} teams{mode === 'in_person' && contest.venue?.name ? ` at ${contest.venue.name}` : ''}.
        </Choice>
        {other ? (
          <Choice tone={otherMode} icon={otherMode === 'online' ? 'screen' : 'pin'} title={`${MODE_LABEL[otherMode]}: linked edition`} checked={false} onSelect={() => open(other.id)}
            points={[{ icon: 'arrow-up-right', text: 'Open it to manage its teams and rooms' }, { icon: 'results', text: 'Ranked and awarded on its own' }]}>
            {otherTeams} teams, same day and rounds.
          </Choice>
        ) : (
          <Choice tone={otherMode} icon="plus" title={`Also running ${MODE_LABEL[otherMode].toLowerCase()}?`} checked={false} onSelect={() => !busy && void make()}
            points={[{ icon: 'copy', text: 'Copies the rounds, problems and keys' }, { icon: 'roster', text: 'Its own teams, rooms and results' }]}>
            {busy ? 'Creating…' : `Create the ${MODE_LABEL[otherMode].toLowerCase()} edition.`}
          </Choice>
        )}
      </div>
      {other && (
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" type="button" onClick={() => open(other.id)}><Icon name="switch" />Open the {MODE_LABEL[otherMode].toLowerCase()} edition</button>
          <button className="btn btn-sm" type="button" onClick={() => setCopying(true)}><Icon name="copy" />Copy problems from it</button>
          <span className="muted small">Problems were copied once when it was made; after that each edition is edited on its own.</span>
        </div>
      )}
      {copying && other && (
        <Modal title="Copy the other edition's problems?" onClose={() => setCopying(false)} actions={
          <>
            <button className="btn" type="button" onClick={() => setCopying(false)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => {
              const n = copyProblemsFrom(other.id);
              setCopying(false);
              toast(`Copied ${n} ${n === 1 ? 'round' : 'rounds'} of problems`, 'From the ' + MODE_LABEL[otherMode].toLowerCase() + ' edition, with their answer keys.', 'g');
            }}>Replace this contest's problems</button>
          </>
        }>
          <p>Every round here gets the problems and answer keys of the round with the same name in the {MODE_LABEL[otherMode].toLowerCase()} edition. Answers students already gave here to problems that are replaced are no longer counted.</p>
        </Modal>
      )}
    </Section>
  );
}

function BothWays() {

  const contest = useContest();
  const db = useDB();
  const live = db.teams.filter((t) => t.status !== 'withdrawn');
  const count = (m: DivisionMode) => live.filter((t) => t.divisionId === divisionFor(contest, m)?.id).length;
  const both = contest.divisions.length > 1;
  const toggle = (m: DivisionMode) => {
    const word = m === 'online' ? 'Online' : 'In person';
    const was = offers(contest, m);
    const why = setMode(m, !was);
    if (why) toast(`${word} stays ${was ? 'on' : 'off'}`, why, 'a');
    else toast(was ? `${word} turned off` : `${word} turned on`, was ? undefined : 'Coaches can choose it when they register.', 'g');
  };
  return (
    <Section id="taking-part" title="How teams take part" note={both ? 'Coaches choose one when they register' : 'One way, for everyone'}>
      <div className="choices" role="group" aria-label="How teams take part">
        <Choice tone="in_person" icon="pin" title="In person" checked={offers(contest, 'in_person')} onSelect={() => toggle('in_person')}
          points={[{ icon: 'file', text: 'Paper answers, keyed in by graders' }, { icon: 'ticket', text: 'Check-in, rooms, projector board' }]}>
          {offers(contest, 'in_person') ? `${count('in_person')} teams${contest.venue?.name ? ` at ${contest.venue.name}` : ''}` : 'Not offered'}
        </Choice>
        <Choice tone="online" icon="screen" title="Online" checked={offers(contest, 'online')} onSelect={() => toggle('online')}
          points={[{ icon: 'screen', text: 'Tests in the browser, marked as they go' }, { icon: 'video', text: 'Zoom rooms, each with a proctor' }]}>
          {offers(contest, 'online') ? `${count('online')} teams in ${contest.rooms.length} Zoom ${contest.rooms.length === 1 ? 'room' : 'rooms'}` : 'Not offered'}
        </Choice>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>A way to take part can be turned off only when no team is registered in it, so nobody loses their place without being told.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ rooms

/** Removing a room with teams in it asks first, and says where the teams go. */
function useRemoveRoom(kind: 'venue' | 'zoom') {
  const [asking, setAsking] = useState<{ id: string; name: string; teams: number } | null>(null);
  const ask = (r: { id: string; name: string; teamIds: string[] }) => {
    if (!r.teamIds.length) { removeRoom(kind, r.id); toast(`${r.name} removed`); return; }
    setAsking({ id: r.id, name: r.name, teams: r.teamIds.length });
  };
  const modal = asking && (
    <Modal title={`Remove ${asking.name}?`} onClose={() => setAsking(null)} actions={
      <>
        <button className="btn" type="button" onClick={() => setAsking(null)}>Cancel</button>
        <button className="btn btn-danger" type="button" onClick={() => { removeRoom(kind, asking.id); toast(`${asking.name} removed`, `${asking.teams} ${asking.teams === 1 ? 'team was' : 'teams were'} moved to other rooms.`); setAsking(null); }}>Remove room</button>
      </>
    }>
      <p>Its {asking.teams} {asking.teams === 1 ? 'team moves' : 'teams move'} to the {kind === 'zoom' ? 'Zoom rooms' : 'rooms'} with the most space. Coaches see the new room on their page.</p>
    </Modal>
  );
  return { ask, modal };
}

// ------------------------------------------------------------------ venue

function RoomName({ id, name }: { id: string; name: string }) {
  const contest = useContest();
  const [v, setV, flush] = useDraft(name, (n) => n.trim() && saveVenue({ rooms: contest.venue!.rooms.map((x) => (x.id === id ? { ...x, name: n.trim() } : x)) }));
  return <input className="input input-sm" aria-label="Room name" value={v} onChange={(e) => setV(e.target.value)} onBlur={flush} />;
}

function VenueSection() {
  const contest = useContest();
  const db = useDB();
  const venue = contest.venue!;
  const rm = useRemoveRoom('venue');
  return (
    <Section id="in-person" title="Venue and rooms" aside={<ModeChip mode="in_person">In person · {venue.rooms.length} rooms</ModeChip>}>
      <div className="card flush">
        <div className="set-pad stack">
          <div className="form-grid set-grid">
            <label className="field"><span>Venue</span><input className="input" value={venue.name} onChange={(e) => saveVenue({ name: e.target.value })} /></label>
            <label className="field span-2"><span>Address</span><input className="input" value={venue.address} onChange={(e) => saveVenue({ address: e.target.value })} /></label>
            <label className="field"><span>Hall for Guts and awards</span><input className="input" value={venue.hall} onChange={(e) => saveVenue({ hall: e.target.value })} /></label>
          </div>
          <label className="field">
            <span>Students should bring</span>
            <textarea className="textarea" style={{ minHeight: 80 }} value={venue.bring.join('\n')} onChange={(e) => saveVenue({ bring: e.target.value.split('\n') })} />
            <small>One per line. It goes on every in-person student's page.</small>
          </label>
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Room</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {venue.rooms.map((r) => (
                <tr key={r.id} className="set-room">
                  <td style={{ width: 220, minWidth: 160 }}><RoomName id={r.id} name={r.name} /></td>
                  <td className="soft">{r.teamIds.length ? r.teamIds.map((id) => db.teams.find((t) => t.id === id)?.code).filter(Boolean).join(', ') : <span className="muted">Empty</span>}</td>
                  <td className="num"><button className="icon-btn set-del" type="button" aria-label={`Remove ${r.name}`} title="Remove room" onClick={() => rm.ask(r)}><Icon name="trash" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-foot">
          <span className="muted small">New teams go to the room with the most space.</span>
          <button className="btn btn-sm" type="button" onClick={addVenueRoom}><Icon name="plus" />Add a room</button>
        </div>
      </div>
      {rm.modal}
    </Section>
  );
}

// ----------------------------------------------------------------- online

function OnlineSection() {
  const contest = useContest();
  const db = useDB();
  const online = divisionFor(contest, 'online')!;
  const [detail, setDetail, flushDetail] = useDraft(online.detail, (v) => saveDivision(online.id, { detail: v }));
  const staff = db.users.filter((u) => u.role === 'proctor' || u.role === 'director' || u.role === 'staff');
  const policy = contest.rounds[0]?.integrity.policy ?? 'warn';
  const mixed = new Set(contest.rounds.map((r) => r.integrity.policy)).size > 1;
  const rm = useRemoveRoom('zoom');
  return (
    <Section id="online" title="Online and Zoom" aside={<ModeChip mode="online">Online · {contest.rooms.length} Zoom rooms</ModeChip>}>
      <div className="card flush">
        <div className="set-pad form-grid set-grid">
          <label className="field span-all">
            <span>Who can take part online</span>
            <input className="input" value={detail} onChange={(e) => setDetail(e.target.value)} onBlur={flushDetail} />
            <small>Coaches read this when they choose.</small>
          </label>
          <label className="field span-all">
            <span>When a student leaves the test (another tab, another window)</span>
            <select className="select" value={mixed ? '' : policy} onChange={(e) => contest.rounds.forEach((r) => saveRound(r.id, { integrity: { ...r.integrity, policy: e.target.value as IntegrityPolicy } }))}>
              {mixed && <option value="">Differs by round</option>}
              {(Object.keys(POLICY) as IntegrityPolicy[]).map((k) => <option key={k} value={k}>{POLICY[k]}</option>)}
            </select>
            <small>Sets it for every round. To set one round on its own, use Edit settings in <Link to="/staff/rounds">Rounds</Link>.</small>
          </label>
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Zoom room</th><th>Proctor</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {contest.rooms.length === 0 && <tr className="empty"><td colSpan={4} style={{ height: 96 }}><span className="row" style={{ justifyContent: 'center', gap: 8 }}><Icon name="video" />No Zoom rooms yet. Every online team needs one.</span></td></tr>}
              {contest.rooms.map((r) => (
                <tr key={r.id} className="set-room">
                  <td className="name">{r.name}<div className="mono muted tiny">{r.url.replace('https://', '')}</div></td>
                  <td style={{ width: 220, minWidth: 160 }}>
                    <select className="select input-sm" aria-label={`Proctor for ${r.name}`} value={r.proctorId ?? ''} onChange={(e) => setRoomProctor(r.id, e.target.value || undefined)}>
                      <option value="">Nobody yet</option>
                      {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td className="soft">{r.teamIds.length ? r.teamIds.map((id) => db.teams.find((t) => t.id === id)?.code).filter(Boolean).join(', ') : <span className="muted">Empty</span>}</td>
                  <td className="num"><button className="icon-btn set-del" type="button" aria-label={`Remove ${r.name}`} title="Remove Zoom room" onClick={() => rm.ask(r)}><Icon name="trash" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-foot">
          <span className="muted small">About eight students per room keeps every camera on one screen.</span>
          <button className="btn btn-sm" type="button" onClick={addZoomRoom}><Icon name="plus" />Add a Zoom room</button>
        </div>
      </div>
      {rm.modal}
    </Section>
  );
}
