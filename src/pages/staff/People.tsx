import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkIn, deleteTeam, modeOf, offers } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Competitor, Team, User } from '../../lib/model';
import { contactsOf, rosterHealth, type DupStudent, type DupTeam } from '../../lib/people';
import { addStaff, mergeTeams, removeDuplicate, removeStaff, type StaffRole } from '../../lib/people-actions';
import { initials, ROLE_LABEL, useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, day } from '../../lib/time';
import { ArtEmpty } from '../../components/art';
import { Icon, type IconName } from '../../components/icons';
import { downloadCsv, Modal, Roll, SearchBox, State, Tabs, toast } from '../../components/ui';
import { copy, StudentDrawer, TeamDrawer, useConfirm } from './PeopleParts';
import { SignIns } from './SignIns';
import '../../styles/people.css';

type Tab = 'students' | 'contacts' | 'staff' | 'checkin' | 'check' | 'signins';

export function People() {
  const db = useDB();
  const contest = useContest();
  const [params, setParams] = useSearchParams();
  const hasCheckin = offers(contest, 'in_person');
  const raw = params.get('tab') as Tab | null;
  // Online students sign in to take their tests; in person, answers are on paper.
  const hasOnline = offers(contest, 'online');
  const tab: Tab = raw && ['students', 'contacts', 'staff', 'check'].concat(hasCheckin ? ['checkin'] : [], hasOnline ? ['signins'] : []).includes(raw) ? raw : 'students';
  const [student, setStudent] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const health = useMemo(() => rosterHealth(db.teams, db.competitors, contest.registration), [db, contest.registration]);
  const staffCount = db.users.filter((u) => ['director', 'staff', 'grader', 'proctor'].includes(u.role)).length;
  const contacts = useMemo(() => contactsOf(db.teams, db.users.filter((u) => u.role === 'coach')), [db]);

  const openStudent = (id: string) => { setTeam(null); setStudent(id); };
  // ?student=<id> opens that student (the command bar links here).
  useEffect(() => {
    const id = params.get('student');
    if (!id) return;
    setTeam(null);
    setStudent(id);
    setParams((p) => { p.delete('student'); return p; }, { replace: true });
  }, [params, setParams]);
  const openTeam = (id: string) => { setStudent(null); setTeam(id); };
  const go = (t: Tab) => {
    const next = new URLSearchParams();
    next.set('tab', t);
    setParams(next, { replace: true });
    setStudent(null);
    setTeam(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">People</h1>
          <p className="page-sub">{db.competitors.length} students, {contacts.length} coaches and contacts, {staffCount} staff. Click anyone to edit them.</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={go}
        items={[
          { key: 'students', label: 'Students', count: db.competitors.length },
          { key: 'contacts', label: contest.registration.coaches === false ? 'Contacts' : 'Coaches and contacts', count: contacts.length },
          { key: 'staff', label: 'Staff', count: staffCount },
          ...(hasOnline ? [{ key: 'signins' as Tab, label: 'Sign-ins' }] : []),
          ...(hasCheckin ? [{ key: 'checkin' as Tab, label: 'Check-in' }] : []),
          { key: 'check', label: health.total ? <span className="pp-tab-warn">ID check</span> : 'ID check', count: health.total },
        ]}
      />
      {tab === 'students' && <Students onOpen={openStudent} initialQ={params.get('q') ?? ''} />}
      {tab === 'contacts' && <Contacts onOpenTeam={openTeam} />}
      {tab === 'staff' && <Staff />}
      {tab === 'checkin' && <CheckIn onOpen={openStudent} />}
      {tab === 'signins' && <SignIns />}
      {tab === 'check' && <IdCheck onOpenStudent={openStudent} onOpenTeam={openTeam} />}
      <StudentDrawer id={student} onClose={() => setStudent(null)} onOpenTeam={openTeam} />
      <TeamDrawer id={team} onClose={() => setTeam(null)} />
    </>
  );
}

// ------------------------------------------------------------------ students

function Students({ onOpen, initialQ }: { onOpen: (id: string) => void; initialQ: string }) {
  const db = useDB();
  const contest = useContest();
  const [q, setQ] = useState(initialQ);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [hideWithdrawn, setHideWithdrawn] = useState(true);
  const [focus, setFocus] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const teams = useMemo(() => new Map(db.teams.map((t) => [t.id, t])), [db]);
  const accounts = useMemo(() => new Map(db.users.filter((u) => u.competitorId).map((u) => [u.competitorId!, u])), [db]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.competitors
      .map((c) => ({ c, t: teams.get(c.teamId)! }))
      .filter(({ c, t }) => t
        && (!hideWithdrawn || t.status !== 'withdrawn')
        && (!onlyMissing || !c.waiverSignedAt)
        && (!needle || [c.publicId, c.name, c.guardianName, c.guardianEmail, t.code, t.name].join(' ').toLowerCase().includes(needle)))
      .sort((a, b) => a.c.publicId.localeCompare(b.c.publicId));
  }, [db, teams, q, onlyMissing, hideWithdrawn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim')) return;
      if (e.key === '/') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'j' || e.key === 'k') setFocus((f) => Math.max(0, Math.min(rows.length - 1, f + (e.key === 'j' ? 1 : -1))));
      else if (e.key === 'Enter' && rows[focus]) onOpen(rows[focus].c.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportCsv = () => downloadCsv(`${contest.slug}-students.csv`,
    ['competitor_id', 'name', 'grade', 'team_code', 'team', 'mode', 'guardian', 'guardian_email', 'waiver_signed', 'checked_in', 'account'],
    rows.map(({ c, t }) => [c.publicId, c.name, c.grade || '', t.code, t.name, modeOf(contest, t), c.guardianName, c.guardianEmail, c.waiverSignedAt ?? '', c.checkedInAt ?? '', accounts.get(c.id)?.email ?? '']));

  if (!db.competitors.length) return <EmptyCard kind="teams" title="No students yet" action={<Link className="btn btn-primary" to="/staff/import?type=teams"><Icon name="upload" />Import teams</Link>}>Students appear here when teams register or are imported.</EmptyCard>;

  return (
    <section className="card flush">
      <div className="toolbar pp-toolbar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setFocus(-1); }} placeholder="Name, ID, team, guardian" inputRef={search} />
        <button type="button" className="filter" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((x) => !x)}><Icon name="check" size={13} />Waiver missing</button>
        <button type="button" className="filter" aria-pressed={!hideWithdrawn} onClick={() => setHideWithdrawn((x) => !x)}><Icon name="check" size={13} />Include withdrawn</button>
        <span className="grow" />
        <span className="pp-count-label" title="Keyboard: / search, j and k move, Enter opens">{rows.length} shown</span>
        <button className="btn btn-sm" type="button" onClick={exportCsv} title="Download these students as a CSV"><Icon name="download" size={14} />Export</button>
      </div>
      <div className="table-scroll">
        <table className="t">
          <thead>
            <tr><th>ID</th><th>Name</th><th className="num">Grade</th><th>Team</th><th>Guardian</th><th>Waiver</th><th>Checked in</th><th>Signs in with</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr className="empty"><td colSpan={8}>Nobody matches. <button className="linkbtn" type="button" onClick={() => { setQ(''); setOnlyMissing(false); }}>Clear filters</button></td></tr>}
            {rows.map(({ c, t }, i) => {
              const acct = accounts.get(c.id);
              const inPerson = modeOf(contest, t) === 'in_person';
              return (
                <tr key={c.id} className={`click ${t.status === 'withdrawn' ? 'dim' : ''} ${focus === i ? 'current' : ''}`} onClick={() => { setFocus(i); onOpen(c.id); }}>
                  <td className="mono">{c.publicId}</td>
                  <td className="name">{c.name}</td>
                  <td className={`num ${c.grade ? 'soft' : 'wait'}`}>{c.grade || '–'}</td>
                  <td><span className="ellipsis soft pp-team">{t.name}</span></td>
                  <td className="pp-two">
                    <span className="soft">{c.guardianName || <span className="muted">No name</span>}</span>
                    {c.guardianEmail ? <small>{c.guardianEmail}</small> : <small className="wait">No email</small>}
                  </td>
                  <td>{c.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone={t.status === 'withdrawn' ? 'off' : 'wait'}>Missing</State>}</td>
                  <td className="pp-time">{!inPerson ? <span className="muted">Online</span> : c.checkedInAt ? <span className="row" style={{ gap: 6 }}><Icon name="check-circle" size={14} className="ok" />{clock(c.checkedInAt)}</span> : <span className="muted">–</span>}</td>
                  <td className="soft">{acct ? <span className={`ellipsis ${acct.managed ? 'mono' : ''}`} title={acct.email}>{acct.email}</span> : <span className="muted">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ contacts

function Contacts({ onOpenTeam }: { onOpenTeam: (id: string) => void }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [hideWithdrawn, setHideWithdrawn] = useState(true);
  const coaches = useMemo(() => new Set(db.users.filter((u) => u.role === 'coach').map((u) => u.email.toLowerCase())), [db]);
  const all = useMemo(() => contactsOf(db.teams.filter((t) => !hideWithdrawn || t.status !== 'withdrawn'), db.users.filter((u) => u.role === 'coach')), [db, hideWithdrawn]);
  const needle = q.trim().toLowerCase();
  const rows = all.filter((c) => !needle || [c.name, c.email, ...c.teams.map((t) => `${t.code} ${t.name} ${t.school}`)].join(' ').toLowerCase().includes(needle));
  if (!all.length) return <EmptyCard kind="mail" title="No contacts yet" action={<Link className="btn btn-primary" to="/staff/teams">Go to Teams</Link>}>Each team’s contact shows here once teams register.</EmptyCard>;
  return (
    <section className="card flush">
      <div className="toolbar pp-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Name, email, team" />
        <button type="button" className="filter" aria-pressed={!hideWithdrawn} onClick={() => setHideWithdrawn((x) => !x)}><Icon name="check" size={13} />Include withdrawn</button>
        <span className="grow" />
        <span className="pp-count-label">{rows.length} people</span>
        <button className="btn btn-sm" type="button" onClick={() => copy(rows.map((c) => c.email).join(', '), `${rows.length} emails`)}><Icon name="copy" size={14} />Copy all emails</button>
        <a className="btn btn-sm" href={`mailto:?bcc=${encodeURIComponent(rows.map((c) => c.email).join(','))}`}><Icon name="mail" />Write to all</a>
      </div>
      <div className="table-scroll">
        <table className="t">
          <thead><tr><th>Name</th><th>Email</th><th>Teams</th><th>Account</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.email}>
                <td className="name">{c.name || <span className="muted">–</span>}</td>
                <td><a href={`mailto:${c.email}`}>{c.email}</a></td>
                <td className="wrap">
                  <span className="pp-chips">
                    {c.teams.map((t) => (
                      <button key={t.id} type="button" className={`pp-chip ${t.status === 'withdrawn' ? 'off' : ''}`} onClick={() => onOpenTeam(t.id)}><span className="mono">{t.code}</span> {t.name}</button>
                    ))}
                  </span>
                </td>
                <td>{coaches.has(c.email.toLowerCase()) ? <State tone="ok">Coach account</State> : <State tone="off">Form only</State>}</td>
                <td className="num"><span className="pp-acts pp-fade"><button className="icon-btn" type="button" aria-label={`Copy ${c.email}`} title="Copy email" onClick={() => copy(c.email, c.email)}><Icon name="copy" size={15} /></button></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------- staff

const CAN: Record<StaffRole, string> = {
  director: 'Everything in the contest, including settings and people',
  staff: 'Teams, people, check-in, waivers and email',
  grader: 'Keys paper sheets for the rounds chosen; no contact details',
  proctor: 'One Zoom room on contest day',
};
const ROLES: StaffRole[] = ['grader', 'proctor', 'staff', 'director'];
const ROLE_ICON: Record<StaffRole, IconName> = { director: 'key', staff: 'roster', grader: 'grading', proctor: 'video' };

function Staff() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [ask, confirmNode] = useConfirm();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('grader');
  const [rounds, setRounds] = useState<string[]>(contest.rounds.map((r) => r.id));
  const [room, setRoom] = useState(contest.rooms[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const staff = db.users.filter((u) => ['director', 'staff', 'grader', 'proctor'].includes(u.role)).sort((a, b) => ROLES.indexOf(b.role as StaffRole) - ROLES.indexOf(a.role as StaffRole) || a.name.localeCompare(b.name));

  const scope = (u: User) => {
    if (u.role === 'grader') {
      const names = (u.roundIds ?? []).map((id) => contest.rounds.find((r) => r.id === id)?.short).filter(Boolean);
      return names.length ? `Keys ${names.join(', ')}` : <span className="wait">No rounds chosen</span>;
    }
    if (u.role === 'proctor') {
      const r = contest.rooms.find((x) => x.id === u.roomId || x.proctorId === u.id);
      return r ? `Proctors ${r.name}` : <span className="wait">No room chosen</span>;
    }
    return CAN[u.role as StaffRole];
  };

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Enter an email address', undefined, 'r');
    if (role === 'grader' && !rounds.length) return toast('Choose at least one round', undefined, 'a');
    if (role === 'proctor' && !room) return toast('Choose a Zoom room', 'Add rooms in Setup first.', 'a');
    setBusy(true);
    const r = await addStaff({ email: e, name, role, roundIds: rounds, roomId: room });
    setBusy(false);
    if (r.error) return toast('Not added', r.error, 'r');
    setEmail('');
    setName('');
    if (r.password) setMade({ email: e, password: r.password });
    else toast(`${e} added`, `${ROLE_LABEL[role]}. They sign in with their existing account.`, 'g');
  };

  return (
    <div className="split">
      <section className="card flush">
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Person</th><th>Role</th><th>Can see and do</th><th /></tr></thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="avatar">{initials(u.name)}</span>
                      <span><b>{u.name}</b>{u.id === me.id && <span className="muted"> (you)</span>}<div className="muted tiny">{u.email}</div></span>
                    </div>
                  </td>
                  <td><span className="pp-role"><Icon name={ROLE_ICON[u.role as StaffRole] ?? 'user'} size={15} />{ROLE_LABEL[u.role]}</span></td>
                  <td className="soft wrap">{scope(u)}</td>
                  <td className="num">
                    {u.id !== me.id && (
                      <span className="pp-acts pp-fade"><button className="icon-btn danger" type="button" aria-label={`Remove ${u.name}`} title="Remove access" onClick={() => ask({
                        title: `Remove ${u.name}?`, label: 'Remove access', danger: true,
                        body: <p>{u.name} loses {ROLE_LABEL[u.role].toLowerCase()} access to {contest.short}. Their account stays; you can add them again.</p>,
                        run: async () => { const err = await removeStaff(u.id, u.role as StaffRole); if (err) toast('Not removed', err, 'r'); else toast(`${u.name} removed`); },
                      })}><Icon name="trash" size={15} /></button></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-foot"><span className="muted small">Coaches and students make their own accounts when they register. {plural(db.users.filter((u) => u.managed).length, 'student')} sign in with a username instead of an email.</span></div>
      </section>
      <aside className="card stack">
        <h2 className="pp-h2 row" style={{ gap: 8 }}><Icon name="user-plus" size={16} />Add staff</h2>
        <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void invite()} placeholder="volunteer@school.org" /></label>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" /></label>
        <label className="field">
          <span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <small>{CAN[role]}.</small>
        </label>
        {role === 'grader' && (
          <fieldset className="field pp-fieldset">
            <legend>Rounds they key</legend>
            {contest.rounds.map((r) => (
              <label key={r.id} className="check">
                <input type="checkbox" checked={rounds.includes(r.id)} onChange={(e) => setRounds((x) => (e.target.checked ? [...x, r.id] : x.filter((id) => id !== r.id)))} />
                {r.name}
              </label>
            ))}
          </fieldset>
        )}
        {role === 'proctor' && (
          <label className="field">
            <span>Zoom room</span>
            <select className="select" value={room} onChange={(e) => setRoom(e.target.value)}>
              {!contest.rooms.length && <option value="">No rooms yet</option>}
              {contest.rooms.map((r) => {
                const p = r.proctorId ? db.users.find((u) => u.id === r.proctorId) : undefined;
                return <option key={r.id} value={r.id}>{r.name}{p ? ` (now ${p.name})` : ''}</option>;
              })}
            </select>
          </label>
        )}
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void invite()}><Icon name="plus" />{busy ? 'Adding' : 'Add to contest'}</button>
        <p className="muted tiny">Someone new gets an account with a password shown once here. Someone who already has an account just gets the role.</p>
      </aside>
      {confirmNode}
      {made && (
        <Modal title="Account made" onClose={() => setMade(null)} actions={<><button className="btn" type="button" onClick={() => copy(`${made.email}\n${made.password}`, 'sign-in')}>Copy</button><button className="btn btn-primary" type="button" onClick={() => setMade(null)}>Done</button></>}>
          <p>Send these to them. The password is shown once; they can change it after signing in.</p>
          <dl className="dl" style={{ marginTop: 14 }}>
            <dt>Email</dt><dd className="mono">{made.email}</dd>
            <dt>Password</dt><dd className="mono">{made.password}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ check-in

function CheckIn({ onOpen }: { onOpen: (id: string) => void }) {
  const db = useDB();
  const contest = useContest();
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const byId = new Map(db.teams.map((t) => [t.id, t]));
    return db.competitors
      .map((c) => ({ c, t: byId.get(c.teamId)! }))
      .filter(({ t }) => t && t.status !== 'withdrawn' && modeOf(contest, t) === 'in_person')
      .sort((a, b) => a.c.publicId.localeCompare(b.c.publicId));
  }, [db, contest]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(({ c, t }) => !needle || [c.publicId, c.name, t.name].join(' ').toLowerCase().includes(needle));
  const here = rows.filter(({ c }) => c.checkedInAt).length;

  useEffect(() => search.current?.focus(), []);

  const enter = () => {
    const c = rows.find(({ c }) => c.publicId.toLowerCase() === needle)?.c ?? (shown.length === 1 ? shown[0].c : undefined);
    if (!c) return toast('No such ID', q, 'a');
    if (c.checkedInAt) toast(`${c.publicId} is already here`, `Since ${clock(c.checkedInAt)}.`);
    else if (!c.waiverSignedAt) toast(`${c.publicId} has no signed waiver`, 'A guardian can sign on a phone at the desk, or record a paper copy.', 'a');
    else { checkIn(c.id); toast(`${c.publicId} ${c.name} checked in`, undefined, 'g'); }
    setQ('');
  };

  return (
    <section className="card flush">
      <div className="pp-ci-head">
        <form onSubmit={(e) => { e.preventDefault(); enter(); }}>
          <SearchBox value={q} onChange={setQ} placeholder="Type or scan an ID, then Enter" inputRef={search} />
        </form>
        <span className="pp-ci-count"><b><Roll value={here} /></b>of {rows.length} here</span>
        <span className="pp-ci-bar" role="img" aria-label={`${here} of ${rows.length} checked in`}><i style={{ width: `${rows.length ? (here / rows.length) * 100 : 0}%` }} /></span>
      </div>
      <div className="table-scroll">
        <table className="t">
          <thead><tr><th>ID</th><th>Name</th><th>Team</th><th>Waiver</th><th>Arrived</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr className="empty"><td colSpan={6}>{rows.length ? 'Nobody matches.' : 'No in-person students.'}</td></tr>}
            {shown.map(({ c, t }) => (
              <tr key={c.id} className={c.checkedInAt ? 'pp-in' : ''}>
                <td className="mono">{c.publicId}</td>
                <td className="name"><button className="linkbtn pp-plain" type="button" onClick={() => onOpen(c.id)}>{c.name}</button></td>
                <td className="soft"><span className="ellipsis">{t.name}</span></td>
                <td>{c.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone="wait">Missing</State>}</td>
                <td className="pp-time">{c.checkedInAt ? <span className="row" style={{ gap: 8 }}><span className="pp-tick"><Icon name="check" size={12} /></span>{clock(c.checkedInAt)}</span> : <span className="muted">–</span>}</td>
                <td className="num">
                  {c.checkedInAt ? (
                    <span className="pp-acts pp-fade"><button className="icon-btn" type="button" aria-label={`Undo check-in for ${c.name}`} title="Undo check-in" onClick={() => checkIn(c.id)}><Icon name="undo" size={15} /></button></span>
                  ) : (
                    <button className="btn btn-sm" type="button" disabled={!c.waiverSignedAt} title={c.waiverSignedAt ? undefined : 'No signed waiver yet'} onClick={() => checkIn(c.id)}><Icon name="check" size={13} />Check in</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ ID check

function IdCheck({ onOpenStudent, onOpenTeam }: { onOpenStudent: (id: string) => void; onOpenTeam: (id: string) => void }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [ask, confirmNode] = useConfirm();
  const h = useMemo(() => rosterHealth(db.teams, db.competitors, contest.registration), [db, contest.registration]);
  const teams = useMemo(() => new Map(db.teams.map((t) => [t.id, t])), [db]);
  const teamOf = (c: Competitor) => teams.get(c.teamId);
  const exact = h.dupStudents.filter((d) => d.exact);

  const S = ({ c }: { c: Competitor }) => (
    <button type="button" className="pp-who" onClick={() => onOpenStudent(c.id)}>
      <span className="mono">{c.publicId}</span> <b>{c.name}</b> <span className="muted">{teamOf(c)?.name}</span>
    </button>
  );
  const T = ({ t }: { t: Team }) => (
    <button type="button" className="pp-who" onClick={() => onOpenTeam(t.id)}>
      <span className="mono">{t.code}</span> <b>{t.name}</b> <span className="muted">{t.school}</span>
    </button>
  );

  const dupStudentSide = (c: Competitor, keep: boolean) => {
    const t = teamOf(c);
    return (
      <div className={`pp-side ${keep ? 'keep' : ''}`}>
        <div className="row"><S c={c} />{keep && <span className="pp-tag">Keep</span>}</div>
        <div className="muted tiny">
          Grade {c.grade || '–'} · {c.guardianName || 'No guardian'} · {c.guardianEmail || 'no email'}<br />
          {c.waiverSignedAt ? <span className="ok">Waiver signed {day(c.waiverSignedAt)}</span> : 'Waiver missing'}
          {t && ` · team registered ${day(t.registeredAt)}`}
        </div>
      </div>
    );
  };

  const removeDup = (d: DupStudent) => {
    removeDuplicate(d.keep, d.drop, me.name);
    toast(`Removed ${d.drop.publicId}`, `${d.keep.publicId} ${d.keep.name} stays.`, 'g');
  };
  const removeAllExact = () => ask({
    title: `Remove ${exact.length} exact ${exact.length === 1 ? 'duplicate' : 'duplicates'}?`, label: 'Remove all', danger: true,
    body: <p>For each pair, the record with a signed waiver (or the older one) stays, and anything only the copy had (waiver, check-in, guardian email) moves onto it. Same name on different teams with different guardians is left for you to decide.</p>,
    run: () => {
      // Pairs share keepers, so remove each copy once, keeping the newest state.
      const done = new Set<string>();
      for (const d of exact) {
        if (done.has(d.drop.id) || done.has(d.keep.id)) continue;
        const keep = db.competitors.find((c) => c.id === d.keep.id);
        if (!keep) continue;
        removeDuplicate(keep, d.drop, me.name);
        done.add(d.drop.id);
      }
      toast(`Removed ${done.size} ${done.size === 1 ? 'duplicate' : 'duplicates'}`, undefined, 'g');
    },
  });

  const merge = (d: DupTeam) => ask({
    title: `Merge ${d.drop.name} into ${d.keep.name}?`, label: 'Merge',
    body: <p>Students on {d.drop.code} move to {d.keep.code} and get new IDs; a student already on {d.keep.code} under the same name is not copied. Then {d.drop.code} is deleted.</p>,
    run: () => { const err = mergeTeams(d.keep.id, d.drop.id, me.name); if (err) toast('Merge stopped', err, 'r'); else toast(`Merged into ${d.keep.name}`, undefined, 'g'); },
  });
  const delTeam = (t: Team) => ask({
    title: `Delete ${t.name}?`, label: 'Delete team', danger: true,
    body: <p>Team {t.code} and its {db.competitors.filter((c) => c.teamId === t.id).length} students are removed. It cannot be undone.</p>,
    run: () => { deleteTeam(t.id, me.name); toast(`${t.name} deleted`); },
  });

  if (!db.teams.length) return <EmptyCard kind="search" title="Nothing to check yet" action={<Link className="btn btn-primary" to="/staff/teams">Go to Teams</Link>}>The roster is checked here once teams register.</EmptyCard>;

  return (
    <div className="stack-lg">
      <div className={`pp-banner ${h.total ? 'amber' : 'green'}`}>
        <Icon name={h.total ? 'warning' : 'check-circle'} size={18} />
        {h.total ? <span><b>{h.total} {h.total === 1 ? 'thing' : 'things'} to look at.</b> Click a name to open it and fix it there.</span> : <span><b>The roster looks clean.</b> No duplicates, IDs match, and every student can get a waiver.</span>}
      </div>

      <section className="card flush pp-checks">
      <Check title="Duplicate students" n={h.dupStudents.length} hint="Same name in this contest. Same team or same guardian email is almost surely one child entered twice." action={exact.length > 0 && <button className="btn btn-sm btn-danger" type="button" onClick={removeAllExact}>Remove all exact duplicates ({exact.length})</button>}>
        {h.dupStudents.map((d) => (
          <li key={d.drop.id} className="pp-pair">
            {dupStudentSide(d.keep, true)}
            {dupStudentSide(d.drop, false)}
            <div className="pp-pair-act">
              <span className={`tiny ${d.exact ? 'wait' : 'muted'}`}>{d.why === 'same_team' ? 'Same team' : d.why === 'same_guardian' ? 'Same guardian email' : 'Same name only'}</span>
              <button className="btn btn-sm" type="button" onClick={() => removeDup(d)}>Remove duplicate</button>
            </div>
          </li>
        ))}
      </Check>

      <Check title="Duplicate teams" n={h.dupTeams.length} hint="Same team name, or the same contact email at the same school. Merge moves the students into the older team.">
        {h.dupTeams.map((d) => (
          <li key={d.drop.id} className="pp-pair">
            <div className="pp-side keep"><div className="row"><T t={d.keep} /><span className="pp-tag">Keep</span></div><div className="muted tiny">{d.keep.contactName} · {d.keep.contactEmail} · {plural(db.competitors.filter((c) => c.teamId === d.keep.id).length, 'student')} · {day(d.keep.registeredAt)}</div></div>
            <div className="pp-side"><div className="row"><T t={d.drop} /></div><div className="muted tiny">{d.drop.contactName} · {d.drop.contactEmail} · {plural(db.competitors.filter((c) => c.teamId === d.drop.id).length, 'student')} · {day(d.drop.registeredAt)}</div></div>
            <div className="pp-pair-act">
              <span className="tiny muted">{d.why === 'same_name' ? 'Same name' : 'Same contact and school'}</span>
              <span className="row"><button className="btn btn-sm" type="button" onClick={() => merge(d)}>Merge</button><button className="btn btn-sm btn-quiet" type="button" onClick={() => delTeam(d.drop)}>Delete {d.drop.code}</button></span>
            </div>
          </li>
        ))}
      </Check>

      <Check title="IDs that don’t match team code and letter" n={h.badIds.length} hint="A student’s ID is the team code and their letter. Saving the team code again rebuilds them.">
        {h.badIds.map(({ c, expected }) => <Line key={c.id}><S c={c} /><span className="soft">is <span className="mono">{c.publicId}</span>, should be <span className="mono">{expected}</span></span></Line>)}
      </Check>

      <Check title="Letter gaps and collisions" n={h.slots.length} hint="Two students with one letter or ID clash on answer sheets. Gaps are harmless but often mean someone was removed.">
        {h.slots.map((s, i) => (
          <Line key={i}>
            {s.kind === 'collision' && <><T t={s.team} /><span className="bad">{s.students.length} students share letter {s.slot}</span></>}
            {s.kind === 'gap' && <><T t={s.team} /><span className="soft">No student with letter {s.missing.join(', ')}</span></>}
            {s.kind === 'id_taken' && <><span className="mono">{s.publicId}</span><span className="bad">used by {s.students.map((c) => c.name).join(' and ')}</span>{s.students.map((c) => <S key={c.id} c={c} />)}</>}
            {s.kind === 'code_taken' && <><span className="bad">Code <span className="mono">{s.code}</span> used by {s.teams.length} teams</span>{s.teams.map((t) => <T key={t.id} t={t} />)}</>}
          </Line>
        ))}
      </Check>

      <Check title="Team size" n={h.sizes.length} hint={`Teams have ${contest.registration.teamMin} to ${contest.registration.teamMax} students.`}>
        {h.sizes.map((s) => <Line key={s.team.id}><T t={s.team} /><span className="wait">{s.count} {s.count === 1 ? 'student' : 'students'}, {s.kind === 'over' ? `more than ${s.limit}` : `fewer than ${s.limit}`}</span></Line>)}
      </Check>

      <Check title="No guardian email" n={h.noGuardianEmail.length} hint="Nobody can be sent their waiver. Add an email, or record a paper copy.">
        {h.noGuardianEmail.map((c) => <Line key={c.id}><S c={c} /><span className="soft">{c.guardianName || 'No guardian name'}</span></Line>)}
      </Check>

      <Check title="Emails that look wrong" n={h.badEmails.length} hint="Mail to these will bounce.">
        {h.badEmails.map((e, i) => <Line key={i}>{e.kind === 'guardian' ? <S c={e.c} /> : <T t={e.team} />}<span className="soft">{e.kind === 'guardian' ? 'Guardian' : 'Contact'} <span className="mono bad">{e.email}</span></span></Line>)}
      </Check>

      <Check title="Grade missing or out of range" n={h.grades.length} hint="Grades 1 to 12. Some awards and reports go by grade.">
        {h.grades.map((g) => <Line key={g.c.id}><S c={g.c} /><span className="wait">{g.kind === 'missing' ? 'No grade' : `Grade ${g.c.grade}`}</span></Line>)}
      </Check>
      </section>
      {confirmNode}
    </div>
  );
}

function Check({ title, n, hint, action, children }: { title: string; n: number; hint: string; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(n > 0);
  useEffect(() => { if (n === 0) setOpen(false); }, [n]);
  return (
    <div className="pp-check">
      <div className="pp-check-top">
        <button type="button" className="pp-check-head" aria-expanded={open} disabled={!n} onClick={() => setOpen((o) => !o)}>
          <span className={`pp-count ${n ? 'warn' : 'ok'}`}>{n ? n : <Icon name="check" size={13} />}</span>
          <span><h2>{title}</h2><span className="muted small">{hint}</span></span>
          {n > 0 && <Icon name="chevron" size={16} className={`pp-chev ${open ? 'open' : ''}`} />}
        </button>
        {open && action}
      </div>
      {n > 0 && <div className={`pp-fold ${open ? 'open' : ''}`} inert={!open}><div><ul className="pp-list">{children}</ul></div></div>}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const Line = ({ children }: { children: ReactNode }) => <li className="pp-line">{children}</li>;

function EmptyCard({ kind, title, children, action }: { kind: 'teams' | 'mail' | 'search'; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card pp-empty">
      <ArtEmpty kind={kind} className="pp-art" />
      <div className="stack" style={{ gap: 6 }}><h2>{title}</h2><p>{children}</p></div>
      {action && <div className="row wrap">{action}</div>}
    </section>
  );
}

