import { Link, useNavigate } from 'react-router-dom';
import { addVenueRoom, addZoomRoom, divisionFor, offers, removeRoom, saveDivision, saveRound, saveVenue, setMode, setRegistration, setRoomProctor } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { DivisionMode, IntegrityPolicy } from '../../lib/model';
import { useDB } from '../../lib/store';
import { Icon } from '../../components/icons';
import { Choice, CloseIcon, ModeChip, toast } from '../../components/ui';

const POLICY: Record<IntegrityPolicy, string> = {
  log: 'Record it for the proctor',
  warn: 'Warn the student, then record it',
  lock: 'Lock the test until a proctor unlocks it',
};

export function Setup() {
  const contest = useContest();
  const db = useDB();
  const navigate = useNavigate();
  const live = db.teams.filter((t) => t.status !== 'withdrawn');
  const count = (m: DivisionMode) => live.filter((t) => t.divisionId === divisionFor(contest, m)?.id).length;
  const toggle = (m: DivisionMode) => {
    const why = setMode(m, !offers(contest, m));
    if (why) toast(`${m === 'online' ? 'Online' : 'In person'} stays on`, why, 'a');
    else toast(offers(contest, m) ? `${m === 'online' ? 'Online' : 'In person'} turned off` : `${m === 'online' ? 'Online' : 'In person'} turned on`, offers(contest, m) ? undefined : 'Coaches can choose it when they register.', 'g');
  };
  const staff = db.users.filter((u) => u.role === 'proctor' || u.role === 'director' || u.role === 'staff');
  const policy = contest.rounds[0]?.integrity.policy ?? 'warn';
  const both = contest.divisions.length > 1;

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Setup</h1>
          <p className="page-sub">How {contest.short} runs. Changes apply straight away, for everyone.</p>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>How teams take part</h2>
          <span className="label">{both ? 'Coaches choose one when they register' : 'One way, for everyone'}</span>
        </div>
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
      </section>

      {offers(contest, 'in_person') && contest.venue && (
        <section className="card flush reveal">
          <div className="card-head"><ModeChip mode="in_person">In person</ModeChip><span className="label">{contest.venue.rooms.length} rooms</span></div>
          <div style={{ padding: '16px 18px' }} className="stack">
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, .8fr)' }}>
              <label className="field"><span>Venue</span><input className="input" value={contest.venue.name} onChange={(e) => saveVenue({ name: e.target.value })} /></label>
              <label className="field"><span>Address</span><input className="input" value={contest.venue.address} onChange={(e) => saveVenue({ address: e.target.value })} /></label>
              <label className="field"><span>Hall for Guts and awards</span><input className="input" value={contest.venue.hall} onChange={(e) => saveVenue({ hall: e.target.value })} /></label>
            </div>
            <label className="field">
              <span>Students should bring</span>
              <textarea className="textarea" style={{ minHeight: 80 }} value={contest.venue.bring.join('\n')} onChange={(e) => saveVenue({ bring: e.target.value.split('\n') })} />
              <small>One per line. It goes on every in-person student's page.</small>
            </label>
          </div>
          <table className="t">
            <thead><tr><th>Room</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {contest.venue.rooms.map((r) => (
                <tr key={r.id}>
                  <td style={{ width: 220 }}><input className="input input-sm" aria-label="Room name" value={r.name} onChange={(e) => saveVenue({ rooms: contest.venue!.rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td className="soft">{r.teamIds.length ? r.teamIds.map((id) => db.teams.find((t) => t.id === id)?.code).filter(Boolean).join(', ') : <span className="muted">Empty</span>}</td>
                  <td className="num"><button className="close" type="button" aria-label={`Remove ${r.name}`} onClick={() => removeRoom('venue', r.id)}><CloseIcon /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-foot">
            <span className="muted small">New teams go to the room with the most space.</span>
            <button className="btn btn-sm" type="button" onClick={addVenueRoom}><Icon name="plus" />Add a room</button>
          </div>
        </section>
      )}

      {offers(contest, 'online') && (
        <section className="card flush reveal">
          <div className="card-head"><ModeChip mode="online">Online</ModeChip><span className="label">{contest.rooms.length} Zoom rooms</span></div>
          <div style={{ padding: '16px 18px' }} className="form-grid">
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Who can take part online</span>
              <input className="input" value={divisionFor(contest, 'online')!.detail} onChange={(e) => saveDivision(divisionFor(contest, 'online')!.id, { detail: e.target.value })} />
              <small>Coaches read this when they choose.</small>
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>When a student leaves the test (another tab, another window)</span>
              <select className="select" value={policy} onChange={(e) => contest.rounds.forEach((r) => saveRound(r.id, { integrity: { ...r.integrity, policy: e.target.value as IntegrityPolicy } }))}>
                {(Object.keys(POLICY) as IntegrityPolicy[]).map((k) => <option key={k} value={k}>{POLICY[k]}</option>)}
              </select>
            </label>
          </div>
          <table className="t">
            <thead><tr><th>Zoom room</th><th>Proctor</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {contest.rooms.length === 0 && <tr className="empty"><td colSpan={4} style={{ height: 80 }}>No Zoom rooms yet. Every online team needs one.</td></tr>}
              {contest.rooms.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.name}<div className="mono muted tiny">{r.url.replace('https://', '')}</div></td>
                  <td style={{ width: 220 }}>
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
          <div className="card-foot">
            <span className="muted small">About eight students per room keeps every camera on one screen.</span>
            <button className="btn btn-sm" type="button" onClick={addZoomRoom}><Icon name="plus" />Add a Zoom room</button>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Sign-ups</h2>
          <label className="check"><input type="checkbox" checked={contest.registration.open} onChange={(e) => setRegistration({ open: e.target.checked })} />Registration open</label>
        </div>
        <div className="split-wide">
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10 }}><span className="ic-sq"><Icon name="link" /></span><b>Registration form</b></div>
            <p className="soft small">{both ? 'Coaches choose in person or online first, then add their team. They can switch until registration closes.' : 'Coaches add their team and students.'}</p>
            <div className="row wrap">
              <span className="mono small soft">mathcloud.app/r/{contest.slug}</span>
              <button className="btn btn-sm" type="button" onClick={() => navigate(`/register/${contest.slug}`)}>Open the form</button>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginTop: 4 }}>
              <label className="field"><span>Students per team</span>
                <select className="select" value={contest.registration.teamMax} onChange={(e) => setRegistration({ teamMax: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Up to {n}</option>)}
                </select>
              </label>
              <label className="field"><span>Closes</span><input className="input" value={contest.registration.closesLabel} onChange={(e) => setRegistration({ closesLabel: e.target.value })} /></label>
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10 }}><span className="ic-sq"><Icon name="table" /></span><b>Teams who signed up elsewhere</b></div>
            <p className="soft small">A Google Form, your own website, a spreadsheet from a coach. Bring in a CSV with any columns; you match them up and see every row before anything is created.</p>
            <div><Link className="btn btn-sm" to="/staff/roster/import"><Icon name="upload" />Import a CSV</Link></div>
          </div>
        </div>
      </section>
    </div>
  );
}
