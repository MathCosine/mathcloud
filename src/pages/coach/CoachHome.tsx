import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { addCompetitor, remindWaiver, removeCompetitor } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { Team } from '../../lib/model';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clockIn } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { CloseIcon, State, toast } from '../../components/ui';

export function CoachHome() {
  const user = useUser();
  const db = useDB();
  const contest = useContest();
  if (!user || user.role !== 'coach') return <Navigate to="/sign-in" replace />;
  const teams = db.teams.filter((t) => user.teamIds?.includes(t.id));
  return (
    <PortalLayout>
      <div className="stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">Your teams</h1>
            <p className="page-sub">{contest.dateLabel} · {teams.length} teams</p>
          </div>
          <button className="btn" type="button" onClick={() => toast('Register a team', 'Opens the SFMO registration form with your details filled in.')}>Register a team</button>
        </div>
        {teams.map((t) => <TeamBlock key={t.id} team={t} />)}
        <section className="section">
          <div className="section-head"><h2>Schedule</h2><span className="label">Pacific time, both divisions together</span></div>
          {contest.rounds.map((r) => (
            <div key={r.id} className="round-line">
              <time>{clockIn(r.startsAt, contest.timeZone).replace(' PT', '')}</time>
              <div><b>{r.mystery ? 'Mystery Dive' : r.name}</b><div className="muted small">{r.mystery ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'Individual' : 'Team'}, ${r.minutes} minutes`}</div></div>
              <span />
            </div>
          ))}
        </section>
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
  const [form, setForm] = useState({ name: '', grade: 9, guardianName: '', guardianEmail: '' });
  const members = db.competitors.filter((c) => c.teamId === team.id);
  const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const division = contest.divisions.find((d) => d.id === team.divisionId)!;
  const teamRow = standings.teams[division.id]?.find((r) => r.team.id === team.id);
  const full = members.length >= contest.registration.teamMax;

  const add = () => {
    if (!form.name.trim() || !form.guardianName.trim() || !/@/.test(form.guardianEmail)) return toast('Fill in every field', 'The waiver goes to the guardian’s email.', 'r');
    const slot = 'ABCD'.split('').find((s) => !members.some((m) => m.slot === s));
    addCompetitor(team.id, form, user.name);
    toast(`${form.name} added as ${team.code}${slot}`, `Username sfmo-${team.code}${slot?.toLowerCase()}. The waiver went to ${form.guardianName}.`, 'g');
    setForm({ name: '', grade: 9, guardianName: '', guardianEmail: '' });
    setAdding(false);
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2><span className="mono muted" style={{ fontWeight: 600, marginRight: 10 }}>{team.code}</span>{team.name}</h2>
        <State tone={team.status === 'confirmed' ? 'ok' : 'wait'}>{team.status === 'confirmed' ? 'Confirmed' : 'Pending'}</State>
      </div>
      <p className="soft small" style={{ marginBottom: 10 }}>
        {division.name} · {team.school}, {team.city}{room ? ` · ${room.name} on Zoom` : ''} · students can join with <span className="mono">{team.joinCode}</span>
      </p>
      {contest.resultsPublished && teamRow && (
        <div className="note green" style={{ marginBottom: 12 }}>
          <b>{ordinal(teamRow.place)} of {standings.teams[division.id].length}</b> in the {division.name.toLowerCase()} division with {teamRow.total} points{teamRow.award ? `, ${teamRow.award}` : ''}.
        </div>
      )}
      <div className="table-scroll">
        <table className="t fixed">
          <colgroup><col style={{ width: 64 }} /><col /><col style={{ width: 70 }} /><col style={{ width: '26%' }} /><col style={{ width: 210 }} />{contest.resultsPublished && <col style={{ width: 110 }} />}<col style={{ width: 44 }} /></colgroup>
          <thead><tr><th>ID</th><th>Name</th><th>Grade</th><th>Signs in with</th><th>Waiver</th>{contest.resultsPublished && <th className="num">Individual</th>}<th /></tr></thead>
          <tbody>
            {members.map((m) => {
              const acct = db.users.find((u) => u.competitorId === m.id);
              const row = standings.individuals[division.id]?.find((r) => r.competitor.id === m.id);
              return (
                <tr key={m.id}>
                  <td className="mono soft">{m.publicId}</td>
                  <td className="name">{m.name}</td>
                  <td className="soft">{m.grade}</td>
                  <td className="soft">{acct?.managed || !acct ? <span className="mono small">{acct?.email ?? `sfmo-${m.publicId.toLowerCase()}`}</span> : acct.email}</td>
                  <td>
                    {m.waiverSignedAt ? <State tone="ok">Signed</State> : (
                      <span className="row" style={{ gap: 4 }}>
                        <State tone="wait">Missing</State>
                        {m.reminderSentAt ? <span className="muted small">&nbsp;reminded</span> : <button className="btn btn-sm btn-quiet" type="button" onClick={() => { remindWaiver(m.id, user.name); toast('Reminder sent', `To ${m.guardianName}.`); }}>Remind</button>}
                        <Link className="btn btn-sm btn-quiet" to={`/waiver/${m.id}`}>Open link</Link>
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
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="form-grid">
            <label className="field"><span>Student</span><input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Grade</span><select className="select" value={form.grade} onChange={(e) => setForm({ ...form, grade: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
            <label className="field"><span>Guardian</span><input className="input" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></label>
            <label className="field"><span>Guardian’s email</span><input className="input" value={form.guardianEmail} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} /></label>
          </div>
          <div className="row"><button className="btn btn-primary" type="button" onClick={add}>Add student</button><button className="btn btn-quiet" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
          <p className="muted small">The student gets a username and password from you, with no email of their own. Their guardian gets the waiver.</p>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {full ? <span className="muted small">{members.length} of {members.length} places filled.</span> : <button className="btn btn-sm" type="button" onClick={() => setAdding(true)}>Add a student</button>}
        </div>
      )}
    </section>
  );
}
