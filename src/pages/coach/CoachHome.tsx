import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { addCompetitor, remindWaiver, removeCompetitor } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { Team } from '../../lib/model';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clockIn } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { CloseIcon, Status, Tick, toast } from '../../components/ui';

export function CoachHome() {
  const user = useUser();
  const db = useDB();
  const contest = useContest();
  if (!user || user.role !== 'coach') return <Navigate to="/sign-in" replace />;
  const teams = db.teams.filter((t) => user.teamIds?.includes(t.id));

  return (
    <PortalLayout>
      <div className="eyebrow">{contest.short} · {contest.dateLabel}</div>
      <div className="page-head" style={{ marginTop: 4 }}>
        <div>
          <h1>Your teams</h1>
          <div className="meta">Add students, chase waivers and see results. Each student gets their own sign-in.</div>
        </div>
        <button className="btn" type="button" onClick={() => toast('Register another team', 'Opens the SFMO registration form with your details filled in.')}>Register another team</button>
      </div>
      <div className="stack" style={{ gap: 20 }}>
        {teams.map((t) => <TeamCard key={t.id} team={t} />)}
      </div>
      <div className="section-title"><h2>Schedule</h2><span className="sub" style={{ fontSize: 12.5 }}>Pacific time, the same moment for both divisions</span></div>
      <div className="panel">
        {contest.rounds.map((r) => (
          <div key={r.id} className="round-card">
            <div><b>{r.name}</b><div className="sub" style={{ fontSize: 12.5 }}>{r.mystery ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'Individual' : 'Team'} · ${r.problems.length} problems`} · {r.minutes} min</div></div>
            <span className="mono">{clockIn(r.startsAt, contest.timeZone)}</span>
          </div>
        ))}
      </div>
    </PortalLayout>
  );
}

function TeamCard({ team }: { team: Team }) {
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
    if (!form.name.trim() || !form.guardianName.trim() || !/@/.test(form.guardianEmail)) return toast('Fill in every field', 'The guardian’s email is where the waiver goes.', 'r');
    addCompetitor(team.id, form, user.name);
    const slot = 'ABCD'.split('').find((s) => !members.some((m) => m.slot === s));
    toast(`${form.name} added as ${team.code}${slot}`, `Username sfmo-${team.code}${slot?.toLowerCase()}. ${form.guardianName} gets the waiver by email.`, 'g');
    setForm({ name: '', grade: 9, guardianName: '', guardianEmail: '' });
    setAdding(false);
  };

  return (
    <div className="panel">
      <div className="panel-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row"><span className="tid">{team.code}</span><h3 style={{ fontSize: 16 }}>{team.name}</h3></div>
          <div className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>
            {division.name} · {team.school}, {team.city}{room ? ` · ${room.name} on Zoom` : ''} · join code <span className="mono">{team.joinCode}</span>
          </div>
        </div>
        {team.status === 'confirmed' ? <Status tone="green">Confirmed</Status> : <Status tone="amber">Pending</Status>}
      </div>
      {contest.resultsPublished && teamRow && (
        <div className="callout green" style={{ margin: 12 }}>
          <span style={{ flex: 1 }}><b>{ordinal(teamRow.place)} of {standings.teams[division.id].length}</b> in the {division.name.toLowerCase()} division, {teamRow.total} points{teamRow.award ? ` · ${teamRow.award}` : ''}. {teamRow.parts.map((p) => `${p.label} ${p.weighted}`).join(' · ')}</span>
          <button className="btn btn-sm" type="button" onClick={() => toast('Team score report', 'A one-page PDF per team with every member’s paper, never their answers.')}>Score report</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>ID</th><th>Name</th><th>Grade</th><th>Signs in with</th><th>Waiver</th>{contest.resultsPublished && <th className="num">Individual</th>}<th /></tr></thead>
          <tbody>
            {members.map((m) => {
              const account = db.users.find((u) => u.competitorId === m.id);
              const row = standings.individuals[division.id]?.find((r) => r.competitor.id === m.id);
              return (
                <tr key={m.id}>
                  <td className="mono">{m.publicId}</td>
                  <td className="tname">{m.name}</td>
                  <td className="mono sub">{m.grade}</td>
                  <td className="mono sub" style={{ fontSize: 12.5 }}>{account?.email ?? `sfmo-${m.publicId.toLowerCase()}`}</td>
                  <td>
                    {m.waiverSignedAt ? (
                      <Status tone="green">Signed</Status>
                    ) : (
                      <span className="row">
                        <Status tone="amber">Missing</Status>
                        {m.reminderSentAt ? <span className="ok-text row" style={{ fontSize: 12 }}><Tick draw />sent</span> : <button className="btn btn-sm btn-ghost" type="button" onClick={() => { remindWaiver(m.id, user.name); toast('Reminder sent', `${m.guardianName} gets the waiver link again.`); }}>Remind</button>}
                        <Link className="btn btn-sm btn-ghost" to={`/waiver/${m.id}`}>Guardian’s link</Link>
                      </span>
                    )}
                  </td>
                  {contest.resultsPublished && <td className="num mono">{row ? `${row.score} · ${ordinal(row.place)}` : '—'}</td>}
                  <td><button className="x" type="button" aria-label={`Remove ${m.name}`} onClick={() => { removeCompetitor(m.id, user.name); toast(`${m.name} removed`, 'Their account is closed and their guardian is told.'); }}><CloseIcon /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
        {adding ? (
          <div className="stack">
            <div className="form-grid">
              <label className="field"><span>Student’s name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
              <label className="field"><span>Grade</span><select className="select" value={form.grade} onChange={(e) => setForm({ ...form, grade: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
              <label className="field"><span>Guardian’s name</span><input className="input" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></label>
              <label className="field"><span>Guardian’s email</span><input className="input" value={form.guardianEmail} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} placeholder="for the waiver" /></label>
            </div>
            <p className="sub" style={{ fontSize: 12.5 }}>The student gets a username and password from you, with no email of their own; their guardian signs the waiver from an emailed link.</p>
            <div className="row"><button className="btn btn-primary" type="button" onClick={add}>Add student</button><button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="sub" style={{ fontSize: 12.5 }}>{members.length} of {contest.registration.teamMax}. Students can also join with the code {team.joinCode}.</span>
            <button className="btn btn-sm" type="button" disabled={full} onClick={() => setAdding(true)}>{full ? 'Team is full' : 'Add a student'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
