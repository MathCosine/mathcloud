import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { signWaiver } from '../lib/actions';
import { useContest } from '../lib/hooks';
import { useDB } from '../lib/store';
import { day } from '../lib/time';

/** The page a guardian reaches from the emailed link. No account needed. */
export function WaiverPage() {
  const { competitorId } = useParams();
  const db = useDB();
  const contest = useContest();
  const navigate = useNavigate();
  const c = db.competitors.find((x) => x.id === competitorId);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  if (!c) return <div className="portal"><h1 className="page-title">This link has expired</h1></div>;
  return (
    <>
      <header className="top"><span className="brand">{contest.short}</span></header>
      <main className="portal" style={{ maxWidth: 640 }}>
        <div className="stack-lg">
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">Liability waiver · {contest.name}</span>
            <h1 className="page-title">Waiver for {c.name}</h1>
            <p className="soft">You are listed as {c.name}’s parent or guardian. Read it, then type your name to sign.</p>
          </div>
          {c.waiverSignedAt ? (
            <div className="note green">Signed on {day(c.waiverSignedAt)}. Thank you; you can close this page.</div>
          ) : (
            <>
              <ol className="soft" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.75 }}>
                <li><b>Permission.</b> {c.name} may take part in {contest.short}, in person or online.</li>
                <li><b>Risks.</b> I accept the ordinary risks of a day-long event, including travel and food.</li>
                <li><b>Release.</b> As far as the law allows, I release the organisers from claims arising from taking part, except for gross negligence or wilful misconduct.</li>
                <li><b>Supervision.</b> Online, and outside scheduled sessions at the venue, {c.name.split(' ')[0]} is my responsibility.</li>
                <li><b>Medical care.</b> If urgent care is needed and I cannot be reached, the organisers may arrange it.</li>
              </ol>
              <div className="stack">
                <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read this and agree.</label>
                <label className="field"><span>Your full name</span><input className="input" style={{ height: 44 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={c.guardianName} /></label>
                <div><button className="btn btn-primary btn-lg" type="button" disabled={!agree || name.trim().length < 4} onClick={() => { signWaiver(c.id, name.trim()); setTimeout(() => navigate(-1), 900); }}>Sign</button></div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
