import { useState } from 'react';
import { useContest } from '../../lib/hooks';
import type { Role } from '../../lib/model';
import { initials, ROLE_LABEL } from '../../lib/session';
import { update, useDB } from '../../lib/store';
import { toast } from '../../components/ui';

const CAN: Record<Role, string> = {
  director: 'Everything in the contest',
  staff: 'Roster, check-in and email',
  grader: 'Keys paper sheets, no contact details',
  proctor: 'One Zoom room on contest day',
  coach: 'Their own teams',
  student: 'Their own tests and results',
};

export function Settings() {
  const db = useDB();
  const contest = useContest();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('grader');
  const staff = db.users.filter((u) => ['director', 'staff', 'grader', 'proctor'].includes(u.role));
  const scope = (u: (typeof staff)[number]) =>
    u.role === 'grader' ? `Keys ${(u.roundIds ?? []).map((id) => contest.rounds.find((r) => r.id === id)?.short).join(', ')}` : u.role === 'proctor' ? `Proctors ${contest.rooms.find((r) => r.id === u.roomId)?.name}` : CAN[u.role];

  const invite = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Enter an email address', undefined, 'r');
    update((d) => {
      d.users.push({ id: `u-${Date.now()}`, email: e, name: e.split('@')[0], role, password: 'demo', ...(role === 'grader' ? { roundIds: contest.rounds.map((r) => r.id) } : {}) });
    });
    setEmail('');
    toast(`Invited ${e}`, `${ROLE_LABEL[role]}. They get a link to set a password.`, 'g');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">People and access</h1>
          <p className="page-sub">Everyone signs in with their own account. The database decides what each person can see.</p>
        </div>
      </div>
      <div className="split">
        <div className="stack">
        <div className="table-scroll card flush">
          <table className="t">
            <thead><tr><th>Person</th><th>Role</th><th>Can see</th></tr></thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="avatar">{initials(u.name)}</span>
                      <span><b>{u.name}</b><div className="muted tiny">{u.email}</div></span>
                    </div>
                  </td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td className="soft">{scope(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          <p className="muted small">
            Coaches and students make their own accounts when they register. {db.users.filter((u) => u.managed).length} students have managed accounts: a username set up by a coach or guardian, with no email of their own.
          </p>
        </div>
        <aside className="card stack">
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Invite</h2>
          <label className="field"><span>Email</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} placeholder="volunteer@school.org" /></label>
          <label className="field">
            <span>Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['grader', 'proctor', 'staff', 'director'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <small>{CAN[role]}.</small>
          </label>
          <button className="btn btn-primary" type="button" onClick={invite}>Send invite</button>
        </aside>
      </div>
    </>
  );
}
