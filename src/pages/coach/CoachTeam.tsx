import { useState } from 'react';
import { addCompetitor, modeOf, MODE_LABEL, offers, remindWaiver, removeCompetitor, saveCompetitor, setTeamMode } from '../../lib/actions';
import { ordinal, useContest } from '../../lib/hooks';
import type { Competitor, DivisionMode, PublishedResult, Team } from '../../lib/model';
import * as W from '../../lib/remote/write';
import { useUser } from '../../lib/session';
import { REMOTE, useDB } from '../../lib/store';
import { Icon } from '../../components/icons';
import { Ring } from '../../components/charts';
import { Modal, ModeChip, State, toast } from '../../components/ui';
import { copyText, hm, SheetView } from '../student/parts';

const GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
type StudentForm = { name: string; grade: number; guardianName: string; guardianEmail: string };
const blank: StudentForm = { name: '', grade: 9, guardianName: '', guardianEmail: '' };

async function refresh() {
  if (!REMOTE) return;
  const { reload } = await import('../../lib/remote/live');
  await reload();
}

/** The link a guardian opens to sign. Connected, it carries a token; in the sandbox, the student's id. */
async function waiverLink(c: Competitor): Promise<string | null> {
  const base = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/waiver/`;
  if (!REMOTE) return base + c.id;
  const r = await W.waiverToken(c.id);
  return r.error || !r.data ? null : base + r.data;
}

/** One team: where it takes part, its join code, its roster with waivers and sign-ins, and what the coach can change. */
export function TeamCard({ team, results }: { team: Team; results: PublishedResult[] }) {
  const db = useDB();
  const contest = useContest();
  const user = useUser()!;
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [removing, setRemoving] = useState<Competitor | null>(null);
  const [logins, setLogins] = useState(false);
  const members = db.competitors.filter((c) => c.teamId === team.id).sort((a, b) => a.slot.localeCompare(b.slot));
  const mode = modeOf(contest, team);
  const online = mode === 'online';
  const other: DivisionMode = online ? 'in_person' : 'online';
  const zoom = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const venueRoom = contest.venue?.rooms.find((r) => r.teamIds.includes(team.id));
  const checkIn = contest.agenda.find((a) => a.modes.includes('in_person') && /check/i.test(a.title));
  const at = (iso: string) => hm(iso, contest.timeZone);
  const full = members.length >= contest.registration.teamMax;
  const proctor = db.users.find((u) => u.id === zoom?.proctorId);
  const signed = members.filter((m) => m.waiverSignedAt).length;
  const devices = members.filter((m) => m.deviceCheckedAt).length;
  const teamRes = results.find((r) => r.teamId === team.id);
  const regOpen = contest.registration.open;

  const copyJoin = async () => {
    const ok = await copyText(team.joinCode);
    toast(ok ? 'Join code copied' : 'Could not copy', ok ? team.joinCode : 'Select it and copy by hand.', ok ? 'g' : 'a');
  };

  return (
    <section className="card flush pt-team" id={`team-${team.id}`}>
      <div className="card-head pt-team-head">
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="mono muted strong">{team.code}</span>
            <h2 style={{ fontSize: 17 }}>{team.name}</h2>
            <ModeChip mode={mode} />
            <State tone={team.status === 'confirmed' ? 'ok' : team.status === 'withdrawn' ? 'off' : 'wait'}>{team.status === 'confirmed' ? 'Confirmed' : team.status === 'withdrawn' ? 'Withdrawn' : 'Waiting for the organisers'}</State>
          </div>
          <p className="soft small">
            {online
              ? <>{zoom ? `Zoom ${zoom.name}` : 'Zoom room to come'}{proctor ? `, proctor ${proctor.name}` : ''}{team.city ? ` · ${team.city}` : ''}</>
              : <>{venueRoom?.name ?? 'Room to come'} at {contest.venue?.name}{checkIn ? ` · check-in from ${at(checkIn.at)}` : ''}</>}
          </p>
        </div>
        {offers(contest, other) && (
          regOpen
            ? <button className="btn btn-sm" type="button" onClick={() => setSwitching(true)}><Icon name="switch" />Switch to {MODE_LABEL[other].toLowerCase()}</button>
            : <button className="btn btn-sm btn-quiet" type="button" onClick={() => setSwitching(true)}><Icon name="switch" />Change mode</button>
        )}
      </div>

      <div className="pt-team-strip">
        <div className="pt-stat">
          <Ring value={signed} total={members.length} size={48} tone={signed === members.length && members.length ? 'green' : 'amber'} label={`${signed} of ${members.length} waivers signed`} />
          <span><b>{signed} of {members.length}</b><small>waivers signed</small></span>
        </div>
        {online && (
          <div className="pt-stat">
            <Ring value={devices} total={members.length} size={48} tone="blue" label={`${devices} of ${members.length} device checks`} />
            <span><b>{devices} of {members.length}</b><small>device checks done</small></span>
          </div>
        )}
        <div className="pt-stat pt-join">
          <span><small>Join code</small><b className="mono">{team.joinCode}</b></span>
          <button className="btn btn-sm btn-quiet" type="button" onClick={copyJoin} aria-label="Copy join code"><Icon name="link" />Copy</button>
        </div>
        {teamRes && (
          <div className="pt-stat">
            <span><small>Team result</small><b>{teamRes.data.place ? `${ordinal(teamRes.data.place)} of ${teamRes.data.of}` : 'Unplaced'}, {teamRes.data.score} points</b>{teamRes.data.award && <small className="pt-award">{teamRes.data.award}</small>}</span>
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="t pt-roster">
          <thead>
            <tr>
              <th>ID</th><th>Student</th><th className="num hide-sm">Grade</th>
              <th className="hide-sm">{online ? 'Signs in as' : 'Checked in'}</th>
              <th>Waiver</th>
              {online && <th>Device</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr className="empty"><td colSpan={online ? 7 : 6}>No students yet. Add up to {contest.registration.teamMax}.</td></tr>
            )}
            {members.map((m) => {
              const acct = db.users.find((u) => u.competitorId === m.id);
              return (
                <tr key={m.id} className="pt-row">
                  <td className="mono soft">{m.publicId}</td>
                  <td className="name">{m.name}<div className="tiny muted pt-guardian">{m.guardianName || 'No guardian'}{m.guardianEmail ? `, ${m.guardianEmail}` : ''}</div></td>
                  <td className="soft num hide-sm">{m.grade || '–'}</td>
                  <td className="soft hide-sm">
                    {online
                      ? (acct ? <span className="mono small">{acct.email}</span> : REMOTE ? <span className="muted small">Not made yet</span> : <span className="mono small">{`${contest.slug.split('-')[0]}-${m.publicId.toLowerCase()}`}</span>)
                      : m.checkedInAt ? at(m.checkedInAt) : <span className="muted">Not yet</span>}
                  </td>
                  <td><WaiverCell c={m} by={user.name} /></td>
                  {online && <td>{m.deviceCheckedAt ? <State tone="ok">Ready</State> : <State tone="off">Not yet</State>}</td>}
                  <td className="num">
                    <button className="btn btn-sm btn-quiet pt-row-act" type="button" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} title={`Edit or remove ${m.name}`}><Icon name="pencil" /><span className="hide-sm">Edit</span></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding ? (
        <AddStudent team={team} onClose={() => setAdding(false)} />
      ) : (
        <div className="card-foot">
          <span className="muted small">{members.length} of {contest.registration.teamMax} places{!regOpen ? ' · registration closed, changes still allowed' : ''}</span>
          <span className="row wrap" style={{ gap: 6 }}>
            {online && members.length > 0 && <button className="btn btn-sm" type="button" onClick={() => setLogins(true)}><Icon name="ticket" />Student sign-ins</button>}
            {!full && <button className="btn btn-sm" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Add a student</button>}
          </span>
        </div>
      )}

      {switching && <SwitchMode team={team} to={other} onClose={() => setSwitching(false)} />}
      {editing && <EditStudent c={editing} onClose={() => setEditing(null)} onRemove={() => { setRemoving(editing); setEditing(null); }} />}
      {removing && (
        <Modal
          title={`Remove ${removing.name}?`}
          onClose={() => setRemoving(null)}
          actions={<><button className="btn btn-quiet" type="button" onClick={() => setRemoving(null)}>Keep {removing.name.split(' ')[0]}</button><button className="btn btn-danger" type="button" onClick={() => { removeCompetitor(removing.id, user.name); toast(`${removing.name} removed`, `${removing.publicId} is free for someone else.`); setRemoving(null); }}>Remove {removing.name.split(' ')[0]}</button></>}
        >
          <p>{removing.publicId} leaves {team.name}{removing.waiverSignedAt ? ' and the signed waiver goes with them' : ''}. {online ? 'Their sign-in stops working.' : ''} You can add someone else in their place.</p>
        </Modal>
      )}
      {logins && <Logins team={team} members={members} onClose={() => setLogins(false)} />}
    </section>
  );
}

function WaiverCell({ c, by }: { c: Competitor; by: string }) {
  const [busy, setBusy] = useState(false);
  if (c.waiverSignedAt) return <State tone="ok">Signed</State>;
  const copy = async () => {
    setBusy(true);
    const link = await waiverLink(c);
    setBusy(false);
    if (!link) return toast('No link', 'Could not make a waiver link. Try again.', 'r');
    const ok = await copyText(link);
    toast(ok ? 'Waiver link copied' : 'Could not copy', ok ? `Send it to ${c.guardianName || 'the guardian'}.` : link, ok ? 'g' : 'a');
  };
  return (
    <span className="row pt-waiver" style={{ gap: 2 }}>
      <State tone="wait">{c.reminderSentAt ? 'Reminded' : 'Waiting'}</State>
      {!c.reminderSentAt && <button className="btn btn-sm btn-quiet" type="button" onClick={() => { remindWaiver(c.id, by); toast('Reminder sent', `To ${c.guardianName || c.guardianEmail}.`, 'g'); }}>Remind</button>}
      <button className="btn btn-sm btn-quiet pt-icon-btn" type="button" disabled={busy} onClick={copy} title="Copy the waiver link, to send it yourself" aria-label={`Copy the waiver link for ${c.name}`}><Icon name="link" /></button>
    </span>
  );
}

function StudentFields({ form, set }: { form: StudentForm; set: (f: StudentForm) => void }) {
  return (
    <div className="form-grid">
      <label className="field"><span>Student’s name</span><input className="input" value={form.name} autoFocus onChange={(e) => set({ ...form, name: e.target.value })} /></label>
      <label className="field"><span>Grade</span><select className="select" value={form.grade} onChange={(e) => set({ ...form, grade: Number(e.target.value) })}>{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
      <label className="field"><span>Guardian</span><input className="input" value={form.guardianName} onChange={(e) => set({ ...form, guardianName: e.target.value })} /></label>
      <label className="field"><span>Guardian’s email</span><input className="input" type="email" value={form.guardianEmail} onChange={(e) => set({ ...form, guardianEmail: e.target.value })} /></label>
    </div>
  );
}

const formError = (f: StudentForm) =>
  !f.name.trim() ? 'Add the student’s name.' : !f.guardianName.trim() ? 'Add a guardian: the waiver goes to them.' : !/^\S+@\S+\.\S+$/.test(f.guardianEmail.trim()) ? 'The guardian’s email does not look right.' : null;

function AddStudent({ team, onClose }: { team: Team; onClose: () => void }) {
  const user = useUser()!;
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const why = formError(form);
    if (why) return toast('Not added yet', why, 'a');
    setBusy(true);
    const error = await addCompetitor(team.id, { ...form, name: form.name.trim(), guardianName: form.guardianName.trim(), guardianEmail: form.guardianEmail.trim() }, user.name);
    setBusy(false);
    if (error) return toast('Not added', error, 'r');
    await refresh();
    toast(`${form.name.trim()} added to ${team.name}`, `The waiver request went to ${form.guardianName.trim()}.`, 'g');
    setForm(blank);
    onClose();
  };
  return (
    <form className="stack reveal pt-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <b className="small">Add a student to {team.name}</b>
      <StudentFields form={form} set={setForm} />
      <div className="row"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Adding' : 'Add student'}</button><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

function EditStudent({ c, onClose, onRemove }: { c: Competitor; onClose: () => void; onRemove: () => void }) {
  const user = useUser()!;
  const [form, setForm] = useState<StudentForm>({ name: c.name, grade: c.grade || 9, guardianName: c.guardianName, guardianEmail: c.guardianEmail });
  const save = () => {
    const why = formError(form);
    if (why) return toast('Not saved', why, 'a');
    saveCompetitor({ ...c, name: form.name.trim(), grade: form.grade, guardianName: form.guardianName.trim(), guardianEmail: form.guardianEmail.trim() }, user.name);
    toast(`${form.name.trim()} saved`, undefined, 'g');
    onClose();
  };
  return (
    <Modal title={`Edit ${c.publicId} ${c.name}`} onClose={onClose} actions={<><button className="btn btn-quiet pt-remove" type="button" style={{ marginRight: 'auto' }} onClick={onRemove}>Remove from team</button><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" onClick={save}>Save</button></>}>
      <div className="stack">
        <StudentFields form={form} set={setForm} />
        {c.guardianEmail !== form.guardianEmail.trim() && !c.waiverSignedAt && <p className="small soft">Use Remind afterwards to send the waiver to the new address.</p>}
      </div>
    </Modal>
  );
}

function SwitchMode({ team, to, onClose }: { team: Team; to: DivisionMode; onClose: () => void }) {
  const contest = useContest();
  const user = useUser()!;
  const [busy, setBusy] = useState(false);
  const closed = !contest.registration.open;
  const go = async () => {
    setBusy(true);
    const why = await setTeamMode(team.id, to, user.name);
    setBusy(false);
    if (why) return toast('Not moved', why, 'a');
    await refresh();
    toast(`${team.name} is now ${to === 'online' ? 'online' : 'in person'}`, to === 'online' ? 'A Zoom room has been assigned.' : `A room at ${contest.venue?.name} has been assigned.`, 'g');
    onClose();
  };
  return (
    <Modal
      title={closed ? 'Registration has closed' : `Switch ${team.name} to ${to === 'online' ? 'online' : 'in person'}?`}
      onClose={onClose}
      actions={closed
        ? <button className="btn" type="button" onClick={onClose}>Close</button>
        : <><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" disabled={busy} onClick={go}>Switch to {to === 'online' ? 'online' : 'in person'}</button></>}
    >
      {closed ? (
        <p>Registration closed on {contest.registration.closesLabel}, so rooms and papers are set. Write to the organisers if {team.name} has to move; they can still do it.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p>The whole team moves together. Competitor IDs stay the same.</p>
          <ul className="bring">
            {to === 'online' ? (
              <>
                <li>Each student signs in with a username and joins a Zoom room.</li>
                <li>Each needs their own computer with a camera.</li>
                <li>The schedule shows in your time zone.</li>
              </>
            ) : (
              <>
                <li>The team comes to {contest.venue?.name || 'the venue'} and answers on paper.</li>
                <li>Online sign-ins are not used on the day.</li>
              </>
            )}
          </ul>
        </div>
      )}
    </Modal>
  );
}

type Account = { name: string; username: string; password: string };

/**
 * Sign-ins for students without their own email. Connected, new passwords
 * are made by the server and shown here once; in the sandbox every student
 * already has one.
 */
function Logins({ team, members, onClose }: { team: Team; members: Competitor[]; onClose: () => void }) {
  const db = useDB();
  const contest = useContest();
  const [accounts, setAccounts] = useState<Account[] | null>(REMOTE ? null : members.map((m) => {
    const u = db.users.find((x) => x.competitorId === m.id);
    return { name: m.name, username: u?.email ?? `${contest.slug.split('-')[0]}-${m.publicId.toLowerCase()}`, password: u?.password ?? 'demo' };
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = members.filter((m) => !db.users.some((u) => u.competitorId === m.id));
  const signInUrl = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-in`;

  const make = async () => {
    setBusy(true);
    const r = await W.createStudentLogins(team.id);
    setBusy(false);
    setError(r.error);
    setAccounts(r.accounts);
    if (r.accounts.length) void refresh();
  };
  const asText = (list: Account[]) => list.map((a) => `${a.name}\nUsername: ${a.username}\nPassword: ${a.password}\nSign in at ${signInUrl}`).join('\n\n');

  if (accounts === null) {
    return (
      <Modal
        title="Student sign-ins"
        onClose={onClose}
        actions={<><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" disabled={busy || !missing.length} onClick={make}>{busy ? 'Making' : `Make ${missing.length || ''} sign-in${missing.length === 1 ? '' : 's'}`}</button></>}
      >
        <div className="stack" style={{ gap: 10 }}>
          <p>Students without their own email get a username and a password. The passwords are shown <b>once</b>, here, to print or copy.</p>
          {missing.length ? (
            <ul className="bring">{missing.map((m) => <li key={m.id}>{m.publicId} {m.name}</li>)}</ul>
          ) : (
            <p className="soft small">Everyone on {team.name} already has a sign-in. To replace a lost password, ask the organisers to reset it.</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <SheetView
      title={`Sign-ins for ${team.name}`}
      sub={REMOTE ? 'Shown once. Print or copy now.' : 'Sandbox: every demo student uses the password shown.'}
      onClose={onClose}
      actions={accounts.length > 0 && <button className="btn btn-sm" type="button" onClick={async () => { const ok = await copyText(asText(accounts)); toast(ok ? 'Copied' : 'Could not copy', ok ? `${accounts.length} sign-ins` : undefined, ok ? 'g' : 'a'); }}><Icon name="link" />Copy all</button>}
    >
      {error && <div className="note red" style={{ marginBottom: 16 }}>{error}</div>}
      {accounts.length === 0 ? (
        <div className="pt-page"><p className="soft">No new sign-ins were made. Everyone on {team.name} already has one.</p></div>
      ) : (
        <div className="pt-page pt-slips">
          {accounts.map((a) => (
            <div key={a.username} className="pt-slip">
              <span className="label">{contest.short} · {team.code} {team.name}</span>
              <b>{a.name}</b>
              <dl>
                <dt>Username</dt><dd className="mono">{a.username}</dd>
                <dt>Password</dt><dd className="mono">{a.password}</dd>
              </dl>
              <small className="soft">Sign in at <span className="mono">{signInUrl.replace(/^https?:\/\//, '')}</span></small>
            </div>
          ))}
        </div>
      )}
    </SheetView>
  );
}
