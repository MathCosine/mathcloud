import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { addCompetitor, modeOf, MODE_LABEL, offers, remindWaiver, removeCompetitor, setTeamMode } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { DivisionMode, Team } from '../../lib/model';
import { useUser } from '../../lib/session';
import { setActiveContest, useAllDB, useDB } from '../../lib/store';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Icon } from '../../components/icons';
import { CloseIcon, Modal, ModeChip, Segmented, State, toast } from '../../components/ui';

export function CoachHome() {
  const user = useUser();
  const db = useDB();
  const all = useAllDB();
  const contest = useContest();
  const navigate = useNavigate();
  if (!user || user.role !== 'coach') return <Navigate to="/sign-in" replace />;
  const mine = all.teams.filter((t) => user.teamIds?.includes(t.id));
  const contestIds = [...new Set(mine.map((t) => t.contestId))];
  const teams = db.teams.filter((t) => user.teamIds?.includes(t.id));
  const modes = [...new Set(teams.map((t) => modeOf(contest, t)))];
  const schedule = contest.agenda.filter((a) => a.modes.some((m) => modes.includes(m))).sort((a, b) => a.at.localeCompare(b.at));
  return (
    <PortalLayout>
      <div className="stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">Your teams</h1>
            <p className="page-sub">{contest.short} · {contest.dateLabel} · {teams.length} {teams.length === 1 ? 'team' : 'teams'}</p>
          </div>
          <div className="actions">
            {contestIds.length > 1 && (
              <Segmented label="Contest" value={contest.id} onChange={setActiveContest} items={contestIds.map((id) => ({ key: id, label: all.contests.find((c) => c.id === id)!.short }))} />
            )}
            <button className="btn btn-primary" type="button" onClick={() => navigate(`/register/${contest.slug}`)}><Icon name="plus" />Register a team</button>
          </div>
        </div>
        {teams.map((t) => <TeamBlock key={t.id} team={t} />)}
        {schedule.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>The day</h2><span className="label">{contest.timeZone === 'America/Los_Angeles' ? 'Pacific time' : contest.timeZone}{modes.length > 1 ? ', both ways of taking part' : ''}</span></div>
            <ol className="agenda">
              {schedule.map((a) => (
                <li key={a.id}>
                  <time>{new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: contest.timeZone }).format(new Date(a.at))}</time>
                  <span className="rail"><i /></span>
                  <div><b>{a.title}</b>{a.note && <div className="note-line">{a.note}</div>}</div>
                  <span className="row" style={{ gap: 4 }}>{a.modes.filter((m) => modes.includes(m)).length < modes.length || modes.length > 1 ? a.modes.filter((m) => modes.includes(m)).map((m) => <ModeChip key={m} mode={m} />) : null}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </PortalLayout>
  );
}

function TeamBlock({ team }: { team: Team }) {
  const db = useDB();
  const contest = useContest();
  const user = useUser()!;
  const standings = useStandings();
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [form, setForm] = useState({ name: '', grade: 9, guardianName: '', guardianEmail: '' });
  const members = db.competitors.filter((c) => c.teamId === team.id);
  const mode = modeOf(contest, team);
  const other: DivisionMode = mode === 'online' ? 'in_person' : 'online';
  const zoom = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const venueRoom = contest.venue?.rooms.find((r) => r.teamIds.includes(team.id));
  const checkIn = contest.agenda.find((a) => a.modes.includes('in_person') && /check/i.test(a.title));
  const at = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: contest.timeZone }).format(new Date(iso));
  const division = contest.divisions.find((d) => d.id === team.divisionId)!;
  const teamRow = standings.teams[division.id]?.find((r) => r.team.id === team.id);
  const full = members.length >= contest.registration.teamMax;
  const proctor = db.users.find((u) => u.id === zoom?.proctorId);

  const add = () => {
    if (!form.name.trim() || !form.guardianName.trim() || !/@/.test(form.guardianEmail)) return toast('Fill in every field', 'The waiver goes to the guardian’s email.', 'r');
    const taken = new Set(members.map((c) => c.slot));
    const slot = 'ABCD'.split('').find((s) => !taken.has(s));
    addCompetitor(team.id, form, user.name);
    toast(`${form.name} added as ${team.code}${slot}`, `The waiver went to ${form.guardianName}.`, 'g');
    setForm({ name: '', grade: 9, guardianName: '', guardianEmail: '' });
    setAdding(false);
  };

  return (
    <section className="card flush">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono muted" style={{ fontWeight: 600 }}>{team.code}</span>
            <h2 style={{ fontSize: 17 }}>{team.name}</h2>
            <ModeChip mode={mode} />
          </div>
          <p className="soft small">
            {mode === 'online'
              ? <>Zoom {zoom?.name ?? 'room to come'}{proctor ? `, proctor ${proctor.name}` : ''} · students join with <span className="mono">{team.joinCode}</span></>
              : <>{venueRoom?.name ?? 'Room to come'} at {contest.venue?.name}{checkIn ? ` · check-in ${at(checkIn.at)}` : ''}</>}
          </p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <State tone={team.status === 'confirmed' ? 'ok' : 'wait'}>{team.status === 'confirmed' ? 'Confirmed' : 'Waiting for the organisers'}</State>
          {offers(contest, other) && <button className="btn btn-sm" type="button" onClick={() => setSwitching(true)}><Icon name="switch" />Switch to {MODE_LABEL[other].toLowerCase()}</button>}
        </div>
      </div>
      {contest.resultsPublished && teamRow && (
        <div className="note green" style={{ margin: '14px 18px 0' }}>
          <b>{ordinal(teamRow.place)} of {standings.teams[division.id].length}</b> in the {division.name.toLowerCase()} division with {teamRow.total} points{teamRow.award ? `, ${teamRow.award}` : ''}.
        </div>
      )}
      <div className="table-scroll">
        <table className="t fixed">
          <colgroup><col style={{ width: 70 }} /><col /><col style={{ width: 70 }} /><col style={{ width: '24%' }} /><col style={{ width: 220 }} />{contest.resultsPublished && <col style={{ width: 110 }} />}<col style={{ width: 52 }} /></colgroup>
          <thead><tr><th>ID</th><th>Name</th><th>Grade</th><th>{mode === 'online' ? 'Signs in with' : 'Checked in'}</th><th>Waiver</th>{contest.resultsPublished && <th className="num">Individual</th>}<th /></tr></thead>
          <tbody>
            {members.map((m) => {
              const acct = db.users.find((u) => u.competitorId === m.id);
              const row = standings.individuals[division.id]?.find((r) => r.competitor.id === m.id);
              return (
                <tr key={m.id}>
                  <td className="mono soft">{m.publicId}</td>
                  <td className="name">{m.name}</td>
                  <td className="soft">{m.grade || '–'}</td>
                  <td className="soft">
                    {mode === 'online'
                      ? (acct?.managed || !acct ? <span className="mono small">{acct?.email ?? `${contest.slug.split('-')[0]}-${m.publicId.toLowerCase()}`}</span> : acct.email)
                      : m.checkedInAt ? at(m.checkedInAt) : <span className="muted">Not yet</span>}
                  </td>
                  <td>
                    {m.waiverSignedAt ? <State tone="ok">Signed</State> : (
                      <span className="row" style={{ gap: 4 }}>
                        <State tone="wait">Missing</State>
                        {m.reminderSentAt ? <span className="muted small">&nbsp;reminded</span> : <button className="btn btn-sm btn-quiet" type="button" onClick={() => { remindWaiver(m.id, user.name); toast('Reminder sent', `To ${m.guardianName}.`); }}>Remind</button>}
                        <Link className="btn btn-sm btn-quiet" to={`/waiver/${m.id}`}>Link</Link>
                      </span>
                    )}
                  </td>
                  {contest.resultsPublished && <td className="num">{row ? `${row.score}, ${ordinal(row.place)}` : '–'}</td>}
                  <td className="num"><button className="close" type="button" aria-label={`Remove ${m.name}`} onClick={() => { removeCompetitor(m.id, user.name); toast(`${m.name} removed`); }}><CloseIcon /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding ? (
        <div className="stack reveal" style={{ padding: '16px 18px', borderTop: '1px solid var(--line)' }}>
          <div className="form-grid">
            <label className="field"><span>Student</span><input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Grade</span><select className="select" value={form.grade} onChange={(e) => setForm({ ...form, grade: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
            <label className="field"><span>Guardian</span><input className="input" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></label>
            <label className="field"><span>Guardian’s email</span><input className="input" value={form.guardianEmail} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} /></label>
          </div>
          <div className="row"><button className="btn btn-primary" type="button" onClick={add}>Add student</button><button className="btn btn-quiet" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      ) : (
        <div className="card-foot">
          <span className="muted small">{members.length} of {contest.registration.teamMax} places</span>
          {!full && <button className="btn btn-sm" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Add a student</button>}
        </div>
      )}
      {switching && <SwitchMode team={team} to={other} onClose={() => setSwitching(false)} />}
    </section>
  );
}

function SwitchMode({ team, to, onClose }: { team: Team; to: DivisionMode; onClose: () => void }) {
  const contest = useContest();
  const user = useUser()!;
  const closed = !contest.registration.open;
  const go = () => {
    const why = setTeamMode(team.id, to, user.name);
    if (why) return toast('Not moved', why, 'a');
    toast(`${team.name} is now ${to === 'online' ? 'online' : 'in person'}`, to === 'online' ? 'A Zoom room has been assigned.' : `A room at ${contest.venue?.name} has been assigned.`, 'g');
    onClose();
  };
  return (
    <Modal
      title={`Switch ${team.name} to ${to === 'online' ? 'online' : 'in person'}?`}
      onClose={onClose}
      actions={closed
        ? <><button className="btn btn-quiet" type="button" onClick={onClose}>Close</button><button className="btn" type="button" onClick={() => { toast('Email drafted', `To the ${contest.short} organisers.`); onClose(); }}>Ask the organisers</button></>
        : <><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" onClick={go}>Switch to {to === 'online' ? 'online' : 'in person'}</button></>}
    >
      {closed ? (
        <p>Registration closed on {contest.registration.closesLabel}, so rooms and papers are set. The organisers can still move a team if they need to.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p>The whole team moves together. Competitor IDs stay the same.</p>
          <ul className="bring">
            {to === 'online' ? (
              <>
                <li>Each student gets a username and a Zoom room.</li>
                <li>Each needs their own computer with a camera.</li>
                <li>The schedule shows in your time zone.</li>
              </>
            ) : (
              <>
                <li>The team comes to {contest.venue?.name || 'the venue'} and answers on paper.</li>
                <li>Online usernames stop working on the day.</li>
              </>
            )}
          </ul>
        </div>
      )}
    </Modal>
  );
}
