import { useState } from 'react';
import { useContest } from '../../lib/hooks';
import type { Role } from '../../lib/model';
import { ROLE_LABEL } from '../../lib/session';
import { update, useDB } from '../../lib/store';
import { toast } from '../../components/ui';

const CAN: Record<Role, string> = {
  director: 'Everything in this organisation’s contests',
  staff: 'Roster, check-in and email; not answer keys or results',
  grader: 'Key paper sheets for assigned rounds; no contact details',
  proctor: 'Live status and questions for one Zoom room',
  coach: 'Their own teams: rosters, waivers, results',
  student: 'Their own tests, results and certificates',
};

export function People() {
  const db = useDB();
  const contest = useContest();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('grader');
  const staff = db.users.filter((u) => ['director', 'staff', 'grader', 'proctor'].includes(u.role));
  const coaches = db.users.filter((u) => u.role === 'coach');
  const students = db.users.filter((u) => u.role === 'student');

  const invite = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('That is not an email address', undefined, 'r');
    update((d) => {
      d.users.push({ id: `u-${Date.now()}`, email: e, name: e.split('@')[0], role, password: 'demo', ...(role === 'grader' ? { roundIds: contest.rounds.map((r) => r.id) } : {}) });
    });
    setEmail('');
    toast(`Invited ${e} as ${ROLE_LABEL[role].toLowerCase()}`, 'They get an email with a link to set a password. Access ends when you remove them.', 'g');
  };

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>People & access</span></div>
      <div className="page-head">
        <div>
          <h1>People & access</h1>
          <div className="meta">Everyone has their own account. What each can see is enforced by the database, not by hiding buttons.</div>
        </div>
      </div>

      <div className="grid-main-side">
        <div className="stack">
          <div className="panel table-wrap">
            <table className="t">
              <thead><tr><th>Name</th><th>Sign-in</th><th>Role</th><th>Can see</th></tr></thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id}>
                    <td className="tname">{u.name}</td>
                    <td className="mono sub" style={{ fontSize: 12.5 }}>{u.email}</td>
                    <td><span className="tag blue" style={{ margin: 0 }}>{ROLE_LABEL[u.role]}</span></td>
                    <td className="sub" style={{ whiteSpace: 'normal' }}>
                      {u.role === 'grader' ? `Keys ${(u.roundIds ?? []).map((id) => contest.rounds.find((r) => r.id === id)?.short).join(', ')}` : u.role === 'proctor' ? `Proctors ${contest.rooms.find((r) => r.id === u.roomId)?.name}` : CAN[u.role]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid-2">
            <div className="panel panel-pad">
              <h3>Coaches</h3>
              <p className="sub" style={{ fontSize: 13, margin: '4px 0 10px' }}>Coaches make an account, register teams and add their students. Parents can be coaches.</p>
              {coaches.map((u) => <div key={u.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span>{u.name}</span><span className="mono sub">{(u.teamIds ?? []).map((id) => db.teams.find((t) => t.id === id)?.code).join(', ')}</span></div>)}
            </div>
            <div className="panel panel-pad">
              <h3>Students</h3>
              <p className="sub" style={{ fontSize: 13, margin: '4px 0 10px' }}>{students.length} accounts. {students.filter((u) => u.managed).length} are managed: a coach or guardian created them, and the student signs in with a username, no email.</p>
            </div>
          </div>
        </div>

        <div className="panel panel-pad stack">
          <h3>Invite someone</h3>
          <label className="field"><span>Email</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="volunteer@school.org" onKeyDown={(e) => e.key === 'Enter' && invite()} /></label>
          <label className="field">
            <span>Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['grader', 'proctor', 'staff', 'director'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <small>{CAN[role]}.</small>
          </label>
          <button className="btn btn-primary" type="button" onClick={invite}>Send invite</button>
          <p className="sub" style={{ fontSize: 12 }}>Directors are asked for a second sign-in step. Graders and proctors lose access automatically a week after the contest.</p>
        </div>
      </div>
    </>
  );
}
