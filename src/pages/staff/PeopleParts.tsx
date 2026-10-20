/**
 * Editors shared by Teams, People and Waivers: the team drawer (the whole
 * registration, its students and their waivers), the student drawer, and
 * the small pieces they are made of.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addCompetitor, checkIn, deleteTeam, MODE_LABEL, modeOf, moveCompetitor, removeCompetitor, saveCompetitor, saveTeam, setTeamMode, setTeamStatus,
} from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Competitor, Team } from '../../lib/model';
import { isEmail } from '../../lib/people';
import { markPaper, sendWaiverReminders, studentLogins, undoWaiver, waiverHow, type Login } from '../../lib/people-actions';
import { useUser } from '../../lib/session';
import { getDB, REMOTE, useDB } from '../../lib/store';
import { day, stamp } from '../../lib/time';
import { Icon } from '../../components/icons';
import { Drawer, Modal, ModeChip, State, toast, type Tone } from '../../components/ui';

export const STATUS: Record<Team['status'], [Tone, string]> = {
  confirmed: ['ok', 'Confirmed'],
  pending: ['wait', 'Pending'],
  withdrawn: ['off', 'Withdrawn'],
};

// ------------------------------------------------------------ confirmation

type Ask = { title: string; body: ReactNode; label: string; danger?: boolean; run: () => void | Promise<void> };

/** A confirm dialog: `ask({...})` opens it, render `node` once. */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const node = ask && (
    <Modal
      title={ask.title}
      onClose={() => setAsk(null)}
      actions={
        <>
          <button className="btn" type="button" onClick={() => setAsk(null)}>Cancel</button>
          <button className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`} type="button" autoFocus onClick={() => { void ask.run(); setAsk(null); }}>{ask.label}</button>
        </>
      }
    >
      {typeof ask.body === 'string' ? <p>{ask.body}</p> : ask.body}
    </Modal>
  );
  return [setAsk, node] as const;
}

// ----------------------------------------------------------- inline fields

/** A text field that saves when it loses focus or on Enter. Escape puts the saved value back. */
export function EditText({
  value, onSave, label, type = 'text', placeholder, mono, check, className, list,
}: {
  value: string; onSave: (v: string) => void; label: string; type?: 'text' | 'email' | 'number'; placeholder?: string; mono?: boolean;
  check?: (v: string) => boolean; className?: string; list?: string;
}) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(0);
  useEffect(() => setV(value), [value]);
  const bad = !!check && v.trim() !== '' && !check(v);
  return (
    <span className="pp-edit">
      <input
      aria-label={label}
      title={label}
      className={`input input-sm ${mono ? 'mono' : ''} ${bad ? 'invalid' : ''} ${className ?? ''}`}
      type={type}
      list={list}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={v}
      placeholder={placeholder ?? label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() === value.trim()) return;
        onSave(v.trim());
        if (!bad) setSaved((n) => n + 1);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setV(value);
        }
      }}
    />
    {saved > 0 && <span key={saved} className="pp-saved" aria-hidden="true"><Icon name="check" size={10} /></span>}
    </span>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field pp-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

export function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast(`Copied ${what}`),
    () => toast('Could not copy', 'Select the text and copy it by hand.', 'a'),
  );
}

// ------------------------------------------------------------------ waivers

/** Where a student's waiver stands, with what can be done about it. */
export function WaiverLine({ c, live = true, compact }: { c: Competitor; live?: boolean; compact?: boolean }) {
  const me = useUser()!;
  const [busy, setBusy] = useState(false);
  if (c.waiverSignedAt) {
    const { who, how } = waiverHow(c);
    return (
      <span className="pp-waiver" title={`${who} · ${how}`}>
        <State tone="ok">Signed {day(c.waiverSignedAt)}</State>
        {!compact && <span className="muted tiny">{who} · {how}</span>}
        <button className="icon-btn" type="button" aria-label="Take the waiver back" title="Take the waiver back" onClick={() => { undoWaiver(c.id, me.name); toast(`Waiver for ${c.publicId} taken back`, 'It shows as missing again.'); }}><Icon name="undo" size={15} /></button>
      </span>
    );
  }
  const remind = async () => {
    setBusy(true);
    const r = await sendWaiverReminders([c.id], me.name);
    setBusy(false);
    if (r.error) toast('Reminder not sent', r.error, 'r');
    else toast(r.waiting ? 'Reminder queued' : 'Reminder sent', `${c.guardianName || 'The guardian'} gets the waiver link at ${c.guardianEmail}.`, 'g');
  };
  return (
    <span className="pp-waiver">
      <State tone={live ? 'wait' : 'off'}>Missing</State>
      {c.reminderSentAt && <span className="muted tiny">Reminded {day(c.reminderSentAt)}</span>}
      {live && (
        <>
          <button className="btn btn-sm" type="button" disabled={busy || !c.guardianEmail} title={c.guardianEmail ? undefined : 'No guardian email'} onClick={remind}><Icon name="send" size={13} />{busy ? 'Sending' : 'Remind'}</button>
          <button className="btn btn-quiet btn-sm" type="button" title="Record a signed paper copy" onClick={() => { markPaper(c.id, me.name); toast(`Paper waiver recorded for ${c.publicId}`, undefined, 'g'); }}>Paper copy</button>
        </>
      )}
    </span>
  );
}

// ------------------------------------------------------------ student card

function MoveSelect({ c, onMoved }: { c: Competitor; onMoved?: () => void }) {
  const db = useDB();
  const me = useUser()!;
  const others = db.teams.filter((t) => t.id !== c.teamId).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <select
      className="select input-sm pp-move"
      aria-label={`Move ${c.name} to another team`}
      value=""
      onChange={(e) => {
        const to = others.find((t) => t.id === e.target.value);
        if (!to) return;
        const err = moveCompetitor(c.id, to.id, me.name);
        if (err) toast('Not moved', err, 'r');
        else {
          const moved = getDB().competitors.find((x) => x.id === c.id);
          toast(`${c.name} moved to ${to.name}`, moved ? `New ID ${moved.publicId}.` : undefined, 'g');
          onMoved?.();
        }
      }}
    >
      <option value="">Move to…</option>
      {others.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}{t.status === 'withdrawn' ? ' (withdrawn)' : ''}</option>)}
    </select>
  );
}

/** One student on the team editor: everything about them, editable where it stands. */
function StudentCard({ c, live, onRemove, fresh }: { c: Competitor; live: boolean; onRemove: () => void; fresh?: boolean }) {
  const me = useUser()!;
  const save = (patch: Partial<Competitor>) => saveCompetitor({ ...c, ...patch }, me.name);
  return (
    <div className={`pp-student ${fresh ? 'new' : ''}`}>
      <span className="pp-id mono" title="Student ID: team code and letter">{c.publicId}</span>
      <div className="pp-student-fields">
        <EditText label="Name" value={c.name} onSave={(v) => v && save({ name: v })} className="pp-name" />
        <EditText label="Grade" type="number" value={c.grade ? String(c.grade) : ''} onSave={(v) => save({ grade: Number(v) || 0 })} className="pp-grade" />
        <EditText label="Guardian name" value={c.guardianName} onSave={(v) => save({ guardianName: v })} />
        <EditText label="Guardian email" type="email" value={c.guardianEmail} check={isEmail} onSave={(v) => save({ guardianEmail: v })} />
      </div>
      <div className="pp-student-foot">
        <WaiverLine c={c} live={live} compact />
        <span className="grow" />
        <MoveSelect c={c} />
        <button className="icon-btn" type="button" aria-label={`Remove ${c.name}`} title="Remove from the team" onClick={onRemove}><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}

function AddStudent({ team, full }: { team: Team; full: boolean }) {
  const me = useUser()!;
  const blank = { name: '', grade: '', guardianName: '', guardianEmail: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = async () => {
    if (!f.name.trim()) return toast('Type the student’s name', undefined, 'a');
    if (f.guardianEmail.trim() && !isEmail(f.guardianEmail)) return toast('Check the guardian email', f.guardianEmail, 'a');
    setBusy(true);
    const err = await addCompetitor(team.id, { name: f.name, grade: Number(f.grade) || 0, guardianName: f.guardianName, guardianEmail: f.guardianEmail }, me.name);
    if (!err && REMOTE) {
      const { reload } = await import('../../lib/remote/live');
      await reload();
    }
    setBusy(false);
    if (err) return toast('Not added', err, 'r');
    toast(`${f.name.trim()} added to ${team.name}`, f.guardianEmail ? 'The guardian gets a waiver request.' : 'Add a guardian email so they can sign the waiver.', 'g');
    setF(blank);
  };
  if (full) return <p className="pp-full"><Icon name="info" size={15} />The team is full. Move or remove a student to add another.</p>;
  return (
    <form className="pp-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <input className="input input-sm pp-name" placeholder="Student name" aria-label="New student name" value={f.name} onChange={set('name')} />
      <input className="input input-sm pp-grade" placeholder="Grade" aria-label="Grade" inputMode="numeric" value={f.grade} onChange={set('grade')} />
      <input className="input input-sm" placeholder="Guardian name" aria-label="Guardian name" value={f.guardianName} onChange={set('guardianName')} />
      <input className="input input-sm" placeholder="Guardian email" aria-label="Guardian email" type="email" value={f.guardianEmail} onChange={set('guardianEmail')} />
      <button className="btn btn-sm" type="submit" disabled={busy}><Icon name="plus" />{busy ? 'Adding' : 'Add student'}</button>
    </form>
  );
}

// ------------------------------------------------------------ logins modal

export function LoginsModal({ team, accounts, onClose }: { team: Team; accounts: Login[]; onClose: () => void }) {
  const text = accounts.map((a) => `${a.name}\t${a.username}\t${a.password}`).join('\n');
  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=640');
    if (!w) return toast('Allow pop-ups to print', undefined, 'a');
    const e = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
    w.document.write(`<!doctype html><title>Sign-ins: ${e(team.name)}</title><style>body{font:14px system-ui;margin:32px}h1{font-size:18px}.card{border:1px dashed #999;border-radius:8px;padding:14px 18px;margin:0 0 14px;break-inside:avoid}.m{font-family:ui-monospace,Menlo,monospace;font-size:16px}</style><h1>${e(team.code)} ${e(team.name)}: student sign-ins</h1>${accounts
      .map((a) => `<div class="card"><b>${e(a.name)}</b><div>Username <span class="m">${e(a.username)}</span></div><div>Password <span class="m">${e(a.password)}</span></div><div style="color:#666;font-size:12px">Sign in at ${e(location.origin)}</div></div>`)
      .join('')}`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Modal
      title={`Sign-ins for ${team.name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" type="button" onClick={() => copy(text, 'sign-ins')}>Copy</button>
          <button className="btn" type="button" onClick={print}>Print</button>
          <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
        </>
      }
    >
      <p>These passwords are shown once. Copy or print them now; making sign-ins again gives new passwords.</p>
      <div className="table-scroll pp-logins">
        <table className="t">
          <thead><tr><th>Student</th><th>Username</th><th>Password</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.username}><td>{a.name}</td><td className="mono">{a.username}</td><td className="mono">{a.password}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- team drawer

/** The whole registration of one team, editable. */
export function TeamDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const navigate = useNavigate();
  const [ask, confirmNode] = useConfirm();
  const [logins, setLogins] = useState<Login[] | null>(null);
  const [busy, setBusy] = useState(false);
  const t = db.teams.find((x) => x.id === id);
  const members = t ? db.competitors.filter((c) => c.teamId === t.id).sort((a, b) => a.slot.localeCompare(b.slot)) : [];
  const log = t ? db.activity.filter((a) => a.teamId === t.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const coach = t?.coachId ? db.users.find((u) => u.id === t.coachId) : undefined;
  const room = t ? contest.rooms.find((r) => r.teamIds.includes(t.id)) : undefined;
  const venueRoom = t ? contest.venue?.rooms.find((r) => r.teamIds.includes(t.id)) : undefined;
  const live = t?.status !== 'withdrawn';
  const mode = t ? modeOf(contest, t) : 'in_person';
  // Students already there when the drawer opened; anyone added after rises in.
  const seen = useRef<Set<string>>(new Set());
  const shownTeam = useRef<string | null>(null);
  if (t && shownTeam.current !== t.id) {
    shownTeam.current = t.id;
    seen.current = new Set(members.map((c) => c.id));
  }

  const save = (patch: Partial<Team>) => {
    if (!t) return;
    if (patch.code !== undefined) {
      const code = patch.code.trim();
      if (!code) return toast('A team needs a code', undefined, 'a');
      if (db.teams.some((x) => x.id !== t.id && x.code === code)) return toast(`Code ${code} is taken`, 'Each team needs its own code; student IDs are built from it.', 'r');
    }
    saveTeam({ ...t, ...patch }, me.name);
  };

  const setDivision = async (divisionId: string) => {
    if (!t) return;
    const d = contest.divisions.find((x) => x.id === divisionId);
    if (!d) return;
    if (d.mode !== mode) {
      const err = await setTeamMode(t.id, d.mode, me.name);
      if (err) return toast('Not moved', err, 'r');
      toast(`${t.name} now takes part ${MODE_LABEL[d.mode].toLowerCase()}`, 'Their portal and times change with it.', 'g');
    }
    // A contest may have several divisions of one mode: land on the one picked.
    const now = getDB().teams.find((x) => x.id === t.id);
    if (now && now.divisionId !== divisionId) saveTeam({ ...now, divisionId }, me.name);
  };

  const makeLogins = async () => {
    if (!t) return;
    setBusy(true);
    const r = await studentLogins(t.id);
    setBusy(false);
    if (r.error) return toast('Sign-ins not made', r.error, 'r');
    if (!r.accounts.length) return toast('No students need a sign-in', 'Every student on this team signs in with their own email.');
    setLogins(r.accounts);
  };

  return (
    <>
      <Drawer
        open={!!t}
        onClose={onClose}
        kicker={t && <>Team <span className="mono">{t.code}</span> · registered {day(t.registeredAt)}</>}
        title={t?.name}
        foot={
          t && (
            <>
              <button
                className="btn btn-danger" type="button"
                onClick={() => ask({
                  title: `Delete ${t.name}?`, label: 'Delete team', danger: true,
                  body: <p>This removes the team, its {members.length} {members.length === 1 ? 'student' : 'students'} and their answers. It cannot be undone. To keep the record, set the status to Withdrawn instead.</p>,
                  run: () => { deleteTeam(t.id, me.name); onClose(); toast(`${t.name} deleted`); },
                })}
              ><Icon name="trash" size={14} />Delete team</button>
              <span className="grow" />
              {t.status === 'pending' && <button className="btn btn-primary" type="button" onClick={() => { setTeamStatus([t.id], 'confirmed', me.name); toast(`${t.name} confirmed`, undefined, 'g'); }}><Icon name="check" size={14} />Confirm team</button>}
            </>
          )
        }
      >
        {t && (
          <div className="pp-editor" key={t.id}>
            <section>
              <div className="row wrap pp-status">
                <select className="select input-sm" aria-label="Status" value={t.status} onChange={(e) => { setTeamStatus([t.id], e.target.value as Team['status'], me.name); }}>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
                {contest.divisions.length > 1 ? (
                  <select className="select input-sm" aria-label="Division" value={t.divisionId} onChange={(e) => void setDivision(e.target.value)}>
                    {contest.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : null}
                <ModeChip mode={mode} />
                {coach && <span className="muted small">Coach {coach.name}</span>}
              </div>
            </section>

            <section>
              <h3><Icon name="file" size={15} />Registration</h3>
              <div className="pp-grid">
                <Field label="Team name"><EditText label="Team name" value={t.name} onSave={(v) => v && save({ name: v })} /></Field>
                <Field label="Code"><EditText label="Team code" mono value={t.code} onSave={(v) => save({ code: v })} /></Field>
                <Field label="School"><EditText label="School" value={t.school} onSave={(v) => save({ school: v })} /></Field>
                <Field label="City"><EditText label="City" value={t.city} onSave={(v) => save({ city: v })} /></Field>
                <Field label="Contact name"><EditText label="Contact name" value={t.contactName} onSave={(v) => save({ contactName: v })} /></Field>
                <Field label="Contact email"><EditText label="Contact email" type="email" check={isEmail} value={t.contactEmail} onSave={(v) => save({ contactEmail: v })} /></Field>
                {mode === 'online' && (
                  <Field label="Time zone">
                    <EditText label="Time zone" list="pp-zones" value={t.timeZone ?? ''} placeholder="America/Chicago" onSave={(v) => save({ timeZone: v || undefined })} />
                    <datalist id="pp-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
                  </Field>
                )}
                <Field label="Donation pledged ($)"><EditText label="Pledge in dollars" type="number" value={t.pledge ? String(t.pledge) : ''} placeholder="None" onSave={(v) => save({ pledge: Number(v) > 0 ? Number(v) : null })} /></Field>
                <Field label={mode === 'in_person' ? 'Notes (allergies, access needs)' : 'Notes'} wide>
                  <NotesField value={t.notes ?? ''} onSave={(v) => save({ notes: v || undefined })} />
                </Field>
              </div>
            </section>

            <section>
              <div className="row pp-h">
                <h3><Icon name="roster" size={15} />Students <span className="muted">{members.length} of {contest.registration.teamMax}</span></h3>
              </div>
              <div className="pp-students">
                {members.map((c) => (
                  <StudentCard
                    key={c.id} c={c} live={live} fresh={!seen.current.has(c.id)}
                    onRemove={() => ask({
                      title: `Remove ${c.name}?`, label: 'Remove student', danger: true,
                      body: <p>{c.name} ({c.publicId}) is taken off {t.name}, with their sign-in and answers. {c.waiverSignedAt ? 'Their signed waiver goes too.' : ''}</p>,
                      run: () => { removeCompetitor(c.id, me.name); toast(`${c.name} removed`); },
                    })}
                  />
                ))}
                {!members.length && <p className="pp-full"><Icon name="user-plus" size={15} />No students yet. Add the first one below.</p>}
              </div>
              <AddStudent team={t} full={members.length >= contest.registration.teamMax} />
            </section>

            <section>
              <h3><Icon name="key" size={15} />Access</h3>
              <dl className="dl">
                <dt>Join code</dt>
                <dd className="row"><span className="mono">{t.joinCode}</span><button className="icon-btn" type="button" aria-label="Copy join code" title="Copy join code" onClick={() => copy(t.joinCode, 'join code')}><Icon name="copy" size={15} /></button></dd>
                <dt>Coach</dt><dd>{coach ? <>{coach.name} <span className="muted">· {coach.email}</span></> : <span className="muted">No coach account; {t.contactName || 'the contact'} registered by form</span>}</dd>
                {room && (<><dt>Zoom room</dt><dd>{room.name}</dd></>)}
                {venueRoom && (<><dt>Room</dt><dd>{venueRoom.name}</dd></>)}
                <dt>Student sign-ins</dt>
                <dd>
                  <button className="btn btn-sm" type="button" disabled={busy || !members.length} onClick={() => void makeLogins()}><Icon name="key" size={13} />{busy ? 'Making' : 'Make sign-ins'}</button>
                  <div className="muted tiny" style={{ marginTop: 4 }}>Usernames and new passwords for students without their own email.</div>
                </dd>
              </dl>
            </section>

            <section>
              <h3><Icon name="clock" size={15} />Activity</h3>
              {log.length ? (
                <ul className="log">{log.map((a) => <li key={a.id}><time>{stamp(a.at)}</time><span>{a.text}</span></li>)}</ul>
              ) : <p className="muted small">Nothing yet.</p>}
              <button className="btn btn-quiet btn-sm" type="button" style={{ marginTop: 8, marginLeft: -10 }} onClick={() => navigate(`/staff/people?tab=students&q=${encodeURIComponent(t.code)}`)}>See students in People<Icon name="arrow" size={13} /></button>
            </section>
          </div>
        )}
      </Drawer>
      {confirmNode}
      {logins && t && <LoginsModal team={t} accounts={logins} onClose={() => setLogins(null)} />}
    </>
  );
}

function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="textarea pp-notes" aria-label="Notes" value={v} placeholder="Nothing noted" onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value.trim() && onSave(v.trim())} />;
}

// ------------------------------------------------------------ student drawer

export function StudentDrawer({ id, onClose, onOpenTeam }: { id: string | null; onClose: () => void; onOpenTeam?: (teamId: string) => void }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [ask, confirmNode] = useConfirm();
  const c = db.competitors.find((x) => x.id === id);
  const t = c ? db.teams.find((x) => x.id === c.teamId) : undefined;
  const acct = c ? db.users.find((u) => u.competitorId === c.id) : undefined;
  const mode = t ? modeOf(contest, t) : 'in_person';
  const log = c && t ? db.activity.filter((a) => a.teamId === t.id && (a.text.includes(c.publicId) || a.text.includes(c.name))).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const save = (patch: Partial<Competitor>) => c && saveCompetitor({ ...c, ...patch }, me.name);
  return (
    <>
      <Drawer
        open={!!c}
        onClose={onClose}
        kicker={c && t && <>Student <span className="mono">{c.publicId}</span> · {t.name}</>}
        title={c?.name}
        foot={
          c && t && (
            <>
              <button
                className="btn btn-danger" type="button"
                onClick={() => ask({
                  title: `Remove ${c.name}?`, label: 'Remove student', danger: true,
                  body: <p>{c.name} ({c.publicId}) is taken off {t.name}, with their sign-in and answers.</p>,
                  run: () => { removeCompetitor(c.id, me.name); onClose(); toast(`${c.name} removed`); },
                })}
              ><Icon name="trash" size={14} />Remove student</button>
              <span className="grow" />
              {onOpenTeam && <button className="btn" type="button" onClick={() => onOpenTeam(t.id)}>Open team<Icon name="arrow" size={14} /></button>}
            </>
          )
        }
      >
        {c && t && (
          <div className="pp-editor" key={c.id}>
            <section>
              <h3><Icon name="student" size={15} />Student</h3>
              <div className="pp-grid">
                <Field label="Name"><EditText label="Name" value={c.name} onSave={(v) => v && save({ name: v })} /></Field>
                <Field label="Grade"><EditText label="Grade" type="number" value={c.grade ? String(c.grade) : ''} onSave={(v) => save({ grade: Number(v) || 0 })} /></Field>
                <Field label="Guardian name"><EditText label="Guardian name" value={c.guardianName} onSave={(v) => save({ guardianName: v })} /></Field>
                <Field label="Guardian email"><EditText label="Guardian email" type="email" check={isEmail} value={c.guardianEmail} onSave={(v) => save({ guardianEmail: v })} /></Field>
              </div>
            </section>
            <section>
              <h3><Icon name="roster" size={15} />Team and ID</h3>
              <dl className="dl">
                <dt>ID</dt><dd className="mono">{c.publicId}{c.publicId !== `${t.code}${c.slot}` && <span className="wait small"> · should be {t.code}{c.slot}</span>}</dd>
                <dt>Team</dt><dd className="row wrap"><span>{t.code} {t.name}</span><ModeChip mode={mode} /></dd>
                <dt>Move</dt><dd><MoveSelect c={c} /></dd>
              </dl>
            </section>
            <section>
              <h3><Icon name="waivers" size={15} />Waiver</h3>
              <WaiverLine c={c} live={t.status !== 'withdrawn'} />
              {!c.guardianEmail && <p className="wait small" style={{ marginTop: 8 }}>No guardian email: add one so the waiver can be sent.</p>}
            </section>
            <section>
              <h3><Icon name="calendar" size={15} />Contest day</h3>
              <dl className="dl">
                {mode === 'in_person' ? (
                  <>
                    <dt>Check-in</dt>
                    <dd className="row">{c.checkedInAt ? <State tone="ok">Here since {stamp(c.checkedInAt)}</State> : <span className="muted">Not yet</span>}
                      <button className={`btn btn-sm ${c.checkedInAt ? 'btn-quiet' : ''}`} type="button" disabled={!c.waiverSignedAt && !c.checkedInAt} onClick={() => checkIn(c.id)}>{c.checkedInAt ? 'Undo' : <><Icon name="check" size={13} />Check in</>}</button>
                    </dd>
                  </>
                ) : (
                  <><dt>Device check</dt><dd>{c.deviceCheckedAt ? <State tone="ok">Passed {day(c.deviceCheckedAt)}</State> : <span className="wait">Not yet</span>}</dd></>
                )}
                <dt>Signs in with</dt>
                <dd>{acct ? <><span className={acct.managed ? 'mono' : ''}>{acct.email}</span>{acct.managed && <span className="muted"> · username</span>}</> : <span className="muted">No account yet</span>}</dd>
                {c.disqualified && (<><dt>Disqualified</dt><dd className="bad">{c.disqualified}</dd></>)}
              </dl>
            </section>
            {log.length > 0 && (
              <section>
                <h3><Icon name="clock" size={15} />Activity</h3>
                <ul className="log">{log.map((a) => <li key={a.id}><time>{stamp(a.at)}</time><span>{a.text}</span></li>)}</ul>
              </section>
            )}
          </div>
        )}
      </Drawer>
      {confirmNode}
    </>
  );
}
