import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { contestOf, divisionFor, editionFor, linkedEdition, organiserAddTeam, registerTeam, type NewStudent } from '../lib/actions';
import type { DivisionMode, Team } from '../lib/model';
import { contestInitials, useUser } from '../lib/session';
import { setActiveContest, useAllDB } from '../lib/store';
import { clockIn } from '../lib/time';
import { Icon } from '../components/icons';
import { Choice, CloseIcon, ModeChip, toast } from '../components/ui';
import '../styles/public.css';

const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'Europe/London', 'Europe/Bucharest', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Singapore', 'Asia/Seoul', 'Australia/Sydney'];
const zoneName = (z: string) => z.split('/').pop()!.replace(/_/g, ' ');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The page a coach reaches from the contest's registration link. */
export function Register() {
  const { slug } = useParams();
  const all = useAllDB();
  const user = useUser();
  const navigate = useNavigate();
  const contest = slug ? all.contests.find((c) => c.slug === slug) ?? contestOf(all) : contestOf(all);
  // In person and online may be two linked contests (editions); the form offers both and files the team in the right one.
  const twin = linkedEdition(all, contest);
  const inPersonC = editionFor(all, contest, 'in_person');
  const onlineC = editionFor(all, contest, 'online');
  const both = !!inPersonC && !!onlineC;
  const staff = !!user && ['director', 'staff'].includes(user.role);
  const organisersOnly = contest.registration.coaches === false && (!twin || twin.registration.coaches === false);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [step, setStep] = useState(both ? 0 : 1);
  const [mode, setMode] = useState<DivisionMode | null>(both ? null : contest.divisions[0].mode);
  const [team, setTeam] = useState({ name: '', school: '', city: '', timeZone: browserZone, notes: '', contactName: user?.role === 'coach' ? user.name : '', contactEmail: user?.role === 'coach' ? user.email : '' });
  const [students, setStudents] = useState<NewStudent[]>([{ name: '', grade: 9, guardianName: '', guardianEmail: '' }]);
  const [done, setDone] = useState<Team | null>(null);
  const knownContact = user?.role === 'coach' && !!user.name && EMAIL.test(user.email ?? '');
  const [editContact, setEditContact] = useState(false);

  const first = [...contest.rounds].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const checkIn = (inPersonC ?? contest).agenda.find((a) => a.modes.includes('in_person') && /check/i.test(a.title));
  const venue = inPersonC?.venue ?? contest.venue;
  const local = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
  const steps = [...(both ? ['In person or online'] : []), 'Your team', 'Students'];
  const at = both ? step : step - 1;

  const teamOk = team.name.trim() && team.contactName.trim() && EMAIL.test(team.contactEmail);
  const studentsOk = students.length >= contest.registration.teamMin && students.every((s) => s.name.trim() && EMAIL.test(s.guardianEmail));

  const submit = async () => {
    if (!mode) return;
    const target = editionFor(all, contest, mode) ?? contest;
    // Organisers add teams directly (confirmed); coaches register (pending).
    const r = staff
      ? await organiserAddTeam(target.id, { mode, ...team, students }, user!.name)
      : await registerTeam(target.id, { mode, ...team, students }, user?.role === 'coach' ? user.id : undefined);
    if (!r.team) return toast('Could not register', r.error ?? 'Try again in a moment.', 'r');
    setDone(r.team);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className="reg-top">
        <div className="reg-top-in">
          <span className="tile" style={{ width: 30, height: 30, fontSize: 11, borderRadius: 9 }}>{contestInitials(contest.short)}</span>
          <span className="reg-title"><b className="hide-sm">{contest.name}</b><b className="show-sm">{contest.short}</b><span className="muted small hide-sm" style={{ marginLeft: 10 }}>{contest.dateLabel}</span></span>
          <span className="grow" />
          {user ? <span className="soft small reg-who">{user.name}</span> : <Link className="btn btn-sm" to="/sign-in">Sign in</Link>}
        </div>
      </header>
      <main className="reg-main">
        {organisersOnly && !staff && !done ? (
          <div className="stack-lg">
            <div>
              <span className="kicker">Registration</span>
              <h1 className="page-title">The organisers enter every team for {contest.short}</h1>
              <p className="page-sub">There is nothing to fill in here. Coaches: your team comes from the organisers&apos; own sign-up, and they send each student their sign-in details before the contest.</p>
            </div>
            <div className="row wrap">
              <Link className="btn" to={`/c/${contest.slug}`}><Icon name="calendar" />See the schedule</Link>
              {!user && <Link className="btn btn-quiet" to="/sign-in">Students: sign in</Link>}
            </div>
          </div>
        ) : done ? (
          <Done contestShort={contest.short} team={done} mode={mode!} onTeams={user?.role === 'coach' ? () => { setActiveContest(contest.id); navigate('/coach'); } : undefined} slugPrefix={contest.slug.split('-')[0]} />
        ) : (
          <div className="stack-lg">
            <div>
              <span className="kicker">Registration</span>
              <h1 className="page-title">Register a team for {contest.short}</h1>
              <p className="page-sub">{contest.dateLabel}. Teams of {contest.registration.teamMin === 1 ? 'up to' : `${contest.registration.teamMin} to`} {contest.registration.teamMax}. Three short steps; you can add and change students later.</p>
            </div>
            {staff && <div className="note">You are adding this team as an organiser: it is confirmed straight away, and the form&apos;s usual checks still apply.</div>}
            {!contest.registration.open && !staff && (
              <div className="note amber">Registration closed on {contest.registration.closesLabel}. This is the demo, so you can try the form anyway.</div>
            )}

            <nav className="steps" aria-label="Steps" style={{ marginBottom: 0 }}>
              {steps.map((s, i) => (
                <button key={s} type="button" aria-current={i === at ? 'step' : undefined} className={i < at ? 'done' : ''} disabled={i > at} onClick={() => i < at && setStep(both ? i : i + 1)}>
                  <i>{i < at ? <Icon name="check" size={12} /> : i + 1}</i>{s}
                </button>
              ))}
            </nav>

            {step === 0 && (
              <section className="card form-card reveal">
                <div className="stack" style={{ gap: 4 }}>
                  <h2>How will your team take part?</h2>
                  <p className="soft">Same rounds, same moment, ranked separately. You can switch until registration closes on {contest.registration.closesLabel}.</p>
                </div>
                <div className="choices" role="radiogroup" aria-label="How your team takes part">
                  <Choice tone="in_person" icon="pin" title="In person" checked={mode === 'in_person'} onSelect={() => setMode('in_person')}
                    points={[
                      { icon: 'pin', text: <>At {venue?.name}{venue?.address ? `, ${venue.address}` : ''}</> },
                      ...(checkIn ? [{ icon: 'clock' as const, text: <>Check-in from {clockIn(checkIn.at, contest.timeZone)}</> }] : []),
                      { icon: 'file', text: 'Answers on paper; bring pencils' },
                      { icon: 'board', text: 'Guts on the big screen' },
                    ]}>
                    {inPersonC && divisionFor(inPersonC, 'in_person')?.detail}
                  </Choice>
                  <Choice tone="online" icon="screen" title="Online" checked={mode === 'online'} onSelect={() => setMode('online')}
                    points={[
                      { icon: 'globe', text: (onlineC && divisionFor(onlineC, 'online')?.detail) ?? 'From anywhere' },
                      ...(first ? [{ icon: 'clock' as const, text: <>First round {clockIn(first.startsAt, contest.timeZone)}, which is {local(first.startsAt, browserZone)} where you are</> }] : []),
                      { icon: 'video', text: 'On Zoom, camera on, in a room with a proctor' },
                      { icon: 'screen', text: 'Each student needs their own computer' },
                    ]}>
                    In the browser, from school or home.
                  </Choice>
                </div>
                <div className="form-foot">
                  <span className="muted small">{mode ? <>You chose <b>{mode === 'online' ? 'online' : 'in person'}</b>.</> : 'Choose one to continue.'}</span>
                  <button className="btn btn-primary" type="button" disabled={!mode} onClick={() => setStep(1)}>Continue<Icon name="arrow" /></button>
                </div>
              </section>
            )}

            {step === 1 && mode && (
              <section className="card form-card reveal">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>Your team</h2>
                  <ModeChip mode={mode} lg />
                </div>
                <div className="form-grid reg-grid">
                  <label className="field"><span>Team name</span><input className="input" autoFocus value={team.name} placeholder="The Isosceles Owls" onChange={(e) => setTeam({ ...team, name: e.target.value })} /></label>
                  <label className="field"><span>School or club <em className="muted">optional</em></span><input className="input" value={team.school} onChange={(e) => setTeam({ ...team, school: e.target.value })} /></label>
                  <label className="field"><span>City <em className="muted">optional</em></span><input className="input" value={team.city} onChange={(e) => setTeam({ ...team, city: e.target.value })} /></label>
                  {mode === 'online' ? (
                    <label className="field">
                      <span>Your time zone</span>
                      <select className="select" value={team.timeZone} onChange={(e) => setTeam({ ...team, timeZone: e.target.value })}>
                        {[...new Set([browserZone, ...ZONES])].map((z) => <option key={z} value={z}>{zoneName(z)}</option>)}
                      </select>
                      <small>Your students' pages show times in this zone{first ? `: the first round starts at ${local(first.startsAt, team.timeZone)}` : ''}.</small>
                    </label>
                  ) : (
                    <label className="field"><span>Allergies or access needs <em className="muted">optional</em></span><input className="input" value={team.notes} onChange={(e) => setTeam({ ...team, notes: e.target.value })} /></label>
                  )}
                </div>
                {knownContact && !editContact ? (
                  <div className="reg-contact">
                    <span className="soft">Confirmation and reminders go to <b>{team.contactName}</b>, {team.contactEmail}.</span>
                    <button className="linkbtn small" type="button" onClick={() => setEditContact(true)}>Change</button>
                  </div>
                ) : (
                  <div className="form-grid reg-grid">
                    <label className="field"><span>Coach or contact</span><input className="input" value={team.contactName} onChange={(e) => setTeam({ ...team, contactName: e.target.value })} /></label>
                    <label className="field"><span>Contact email</span><input className="input" type="email" value={team.contactEmail} onChange={(e) => setTeam({ ...team, contactEmail: e.target.value })} /><small>Confirmation and reminders go here.</small></label>
                  </div>
                )}
                <div className="form-foot">
                  {both ? <button className="btn btn-quiet" type="button" onClick={() => setStep(0)}><Icon name="back" />Back</button> : <span />}
                  <button className="btn btn-primary" type="button" disabled={!teamOk} title={!teamOk ? 'A team name and a contact email are needed' : undefined} onClick={() => setStep(2)}>Continue<Icon name="arrow" /></button>
                </div>
              </section>
            )}

            {step === 2 && mode && (
              <section className="card form-card reveal">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <h2>Students</h2>
                    <p className="soft small">Each gets a competitor ID. Their guardian gets the waiver by email.</p>
                  </div>
                  <ModeChip mode={mode} lg />
                </div>
                <div className="stack" style={{ gap: 12 }}>
                  {students.map((s, i) => (
                    <div key={i} className="student-row reveal">
                      <span className="slot">{'ABCDEF'[i]}</span>
                      <label className="field"><span>Name</span><input className="input" value={s.name} autoFocus={i > 0} onChange={(e) => setStudents(students.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} /></label>
                      <label className="field"><span>Grade</span>
                        <select className="select" value={s.grade ?? 9} onChange={(e) => setStudents(students.map((x, k) => (k === i ? { ...x, grade: Number(e.target.value) } : x)))}>
                          {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </label>
                      <label className="field"><span>Guardian's email</span><input className="input" type="email" value={s.guardianEmail} onChange={(e) => setStudents(students.map((x, k) => (k === i ? { ...x, guardianEmail: e.target.value } : x)))} /></label>
                      {students.length > 1 ? <button className="close" type="button" aria-label="Remove" style={{ marginBottom: 4 }} onClick={() => setStudents(students.filter((_, k) => k !== i))}><CloseIcon /></button> : <span />}
                    </div>
                  ))}
                </div>
                {students.length < contest.registration.teamMax && (
                  <div><button className="btn btn-sm" type="button" onClick={() => setStudents([...students, { name: '', grade: 9, guardianName: '', guardianEmail: '' }])}><Icon name="plus" />Add a student</button></div>
                )}
                <div className="form-foot">
                  <button className="btn btn-quiet" type="button" onClick={() => setStep(1)}><Icon name="back" />Back</button>
                  <button className="btn btn-primary" type="button" disabled={!studentsOk} title={!studentsOk ? 'Each student needs a name and a guardian’s email' : undefined} onClick={submit}>Register {team.name.trim() || 'the team'}</button>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function Done({ contestShort, team, mode, onTeams, slugPrefix }: { contestShort: string; team: Team; mode: DivisionMode; onTeams?: () => void; slugPrefix: string }) {
  const all = useAllDB();
  const members = all.competitors.filter((c) => c.teamId === team.id);
  const contest = all.contests.find((c) => c.id === team.contestId)!;
  const venue = contest?.venue;
  return (
    <div className="stack-lg reveal">
      <div className="card reg-done">
        <div>
          <div className="row" style={{ gap: 12 }}><span className="reg-done-tick"><Icon name="check" size={22} /></span><ModeChip mode={mode} lg /></div>
          <h2>{team.name} is registered for {contestShort}</h2>
          <p>Team {team.code}. A confirmation is on its way to {team.contactEmail}; the organisers confirm your place within a few days.</p>
        </div>
        {onTeams && <button className="btn btn-primary" type="button" onClick={onTeams}>Go to your teams<Icon name="arrow" /></button>}
      </div>
      <section className="card flush">
        <div className="card-head"><h2>Competitor IDs</h2><span className="label">{mode === 'online' ? 'Each student signs in with their own username' : 'Students write these on every answer sheet'}</span></div>
        <table className="t">
          <thead><tr><th>ID</th><th>Student</th><th>{mode === 'online' ? 'Username' : 'Waiver'}</th></tr></thead>
          <tbody>
            {members.map((c) => (
              <tr key={c.id}><td className="mono">{c.publicId}</td><td className="name">{c.name}</td><td className="soft">{mode === 'online' ? <span className="mono small">{slugPrefix}-{c.publicId.toLowerCase()}</span> : `Sent to ${c.guardianEmail}`}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <div className="section-head"><h2>What happens next</h2></div>
        <ol className="reg-steps">
          <li>Guardians sign the waivers from the email. Nobody competes without one.</li>
          {mode === 'online' ? (
            <>
              <li>A week before, each student gets a Zoom room and runs a two-minute device check.</li>
              <li>On the day: join Zoom, camera on, then start each round from the student page.</li>
            </>
          ) : (
            <>
              <li>On the day, check in at {venue?.name || 'the venue'} with the competitor IDs above.</li>
              <li>Bring {venue?.bring[0]?.toLowerCase() || 'pencils'}. Rooms are on each student's page.</li>
            </>
          )}
        </ol>
      </section>
    </div>
  );
}

