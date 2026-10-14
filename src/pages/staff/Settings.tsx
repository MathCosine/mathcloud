import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addVenueRoom, addZoomRoom, divisionFor, offers, removeRoom, saveDivision, saveRound, saveVenue, setMode, setRegistration, setRoomProctor,
} from '../../lib/actions';
import { saveContestBasics, saveSlug, slugProblem, toSlug } from '../../lib/contestSettings';
import { useContest } from '../../lib/hooks';
import type { DivisionMode, IntegrityPolicy } from '../../lib/model';
import { useDB } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';
import { Icon, type IconName } from '../../components/icons';
import { Choice, CloseIcon, ModeChip, toast } from '../../components/ui';
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
        <nav className="set-nav" aria-label="Settings sections">
          {shown.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'on' : ''} onClick={(e) => {
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
                <button className="btn btn-primary btn-sm" type="button" disabled={saving || !!slugProblem(slug, contest.id)} onClick={() => void commitSlug()}>Save address</button>
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

  return (
    <Section id="registration" title="Registration" aside={
      <label className="check set-toggle"><input type="checkbox" checked={reg.open} onChange={(e) => { setRegistration({ open: e.target.checked }); toast(e.target.checked ? 'Registration is open' : 'Registration is closed', e.target.checked ? 'Coaches can register and edit their teams.' : 'Coaches can no longer add teams. You still can.', e.target.checked ? 'g' : ''); }} />{reg.open ? 'Open' : 'Closed'}</label>
    }>
      <div className="card stack">
        <div className="form-grid set-grid">
          <label className="field">
            <span>Closes</span>
            <input className="input" value={closes} onChange={(e) => setCloses(e.target.value)} onBlur={flushCloses} placeholder="9 Jan" />
            <small>Shown on the form. Close it with the switch above.</small>
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
              <button className="btn btn-sm" type="button" onClick={() => navigate(`/register/${contest.slug}`)}>Open the form</button>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}><span className="ic-sq"><Icon name="table" /></span><b>Teams who signed up elsewhere</b></div>
            <p className="soft small" style={{ margin: 0 }}>A Google Form, your own website, a spreadsheet from a coach. Bring in a CSV with any columns; duplicates are found for you.</p>
            <div><Link className="btn btn-sm" to="/staff/import?type=teams"><Icon name="upload" />Import a CSV</Link></div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------ taking part

function TakingPart() {
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
                <tr key={r.id}>
                  <td style={{ width: 220, minWidth: 160 }}><RoomName id={r.id} name={r.name} /></td>
                  <td className="soft">{r.teamIds.length ? r.teamIds.map((id) => db.teams.find((t) => t.id === id)?.code).filter(Boolean).join(', ') : <span className="muted">Empty</span>}</td>
                  <td className="num"><button className="close" type="button" aria-label={`Remove ${r.name}`} onClick={() => removeRoom('venue', r.id)}><CloseIcon /></button></td>
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
              {mixed && <option value="">Differs by round (set in Rounds)</option>}
              {(Object.keys(POLICY) as IntegrityPolicy[]).map((k) => <option key={k} value={k}>{POLICY[k]}</option>)}
            </select>
            <small>For every round. Each round can differ; set that in Rounds.</small>
          </label>
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Zoom room</th><th>Proctor</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {contest.rooms.length === 0 && <tr className="empty"><td colSpan={4} style={{ height: 80 }}>No Zoom rooms yet. Every online team needs one.</td></tr>}
              {contest.rooms.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.name}<div className="mono muted tiny">{r.url.replace('https://', '')}</div></td>
                  <td style={{ width: 220, minWidth: 160 }}>
                    <select className="select input-sm" aria-label={`Proctor for ${r.name}`} value={r.proctorId ?? ''} onChange={(e) => setRoomProctor(r.id, e.target.value || undefined)}>
                      <option value="">Nobody yet</option>
                      {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td className="soft">{r.teamIds.length ? r.teamIds.map((id) => db.teams.find((t) => t.id === id)?.code).filter(Boolean).join(', ') : <span className="muted">Empty</span>}</td>
                  <td className="num"><button className="close" type="button" aria-label={`Remove ${r.name}`} onClick={() => removeRoom('zoom', r.id)}><CloseIcon /></button></td>
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
    </Section>
  );
}
