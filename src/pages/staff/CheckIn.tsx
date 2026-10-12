import { useRef, useState } from 'react';
import { checkIn } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import { useDB } from '../../lib/store';
import { clock } from '../../lib/time';
import { Roll, SearchBox, Status, toast } from '../../components/ui';

export function CheckIn() {
  const db = useDB();
  const contest = useContest();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const teams = db.teams.filter((t) => t.divisionId === 'in_person' && t.status !== 'withdrawn');
  const comps = db.competitors.filter((c) => teams.some((t) => t.id === c.teamId));
  const shown = comps.filter((c) => !q || `${c.publicId} ${c.name}`.toLowerCase().includes(q.toLowerCase()));
  const done = comps.filter((c) => c.checkedInAt).length;

  const quick = () => {
    const exact = comps.find((c) => c.publicId.toLowerCase() === q.trim().toLowerCase());
    if (!exact) return;
    if (!exact.waiverSignedAt) toast(`${exact.publicId} has no waiver`, 'They cannot compete until a guardian signs. Their guardian can sign on a phone at the desk.', 'a');
    else if (!exact.checkedInAt) { checkIn(exact.id); toast(`${exact.publicId} ${exact.name} checked in`, undefined, 'g'); }
    setQ('');
  };

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Check-in</span></div>
      <div className="page-head">
        <div>
          <h1>Check-in</h1>
          <div className="meta">In-person division. Scan the code in a confirmation email, or type an ID and press Enter.</div>
        </div>
        <div className="score-big mono" style={{ fontSize: 30 }}><Roll value={done} /><span className="sub" style={{ fontSize: 16 }}> / {comps.length} here</span></div>
      </div>
      <div className="toolbar">
        <form onSubmit={(e) => { e.preventDefault(); quick(); }} style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <SearchBox value={q} onChange={setQ} placeholder="ID or name, Enter to check in" inputRef={ref} />
        </form>
        <button className="btn" type="button" onClick={() => toast('Scanner', 'On a phone this opens the camera and reads the QR code from the confirmation email.')}>Scan a code</button>
      </div>
      <div className="panel table-wrap">
        <table className="t">
          <thead><tr><th>ID</th><th>Name</th><th>Team</th><th>Waiver</th><th>Arrived</th><th /></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={c.checkedInAt ? '' : ''}>
                <td className="mono">{c.publicId}</td>
                <td className="tname">{c.name}</td>
                <td>{db.teams.find((t) => t.id === c.teamId)?.name}</td>
                <td>{c.waiverSignedAt ? <Status tone="green">Signed</Status> : <Status tone="amber">Missing</Status>}</td>
                <td className="mono sub">{c.checkedInAt ? clock(c.checkedInAt) : '—'}</td>
                <td><button className={`btn btn-sm ${c.checkedInAt ? '' : 'btn-primary'}`} type="button" disabled={!c.waiverSignedAt && !c.checkedInAt} onClick={() => checkIn(c.id)}>{c.checkedInAt ? 'Undo' : 'Check in'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
