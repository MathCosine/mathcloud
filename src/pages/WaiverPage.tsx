import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { signWaiver } from '../lib/actions';
import { useContest } from '../lib/hooks';
import { useDB } from '../lib/store';
import { day } from '../lib/time';
import { Mark, Tick } from '../components/ui';

/** The page a guardian reaches from the emailed link. No account needed. */
export function WaiverPage() {
  const { competitorId } = useParams();
  const db = useDB();
  const contest = useContest();
  const navigate = useNavigate();
  const c = db.competitors.find((x) => x.id === competitorId);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  if (!c) return <div className="portal-main"><h1>This link has expired</h1></div>;
  const ok = agree && name.trim().length > 3;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      <header className="portal-top"><span className="brand" style={{ fontSize: 15 }}><Mark />{contest.short}</span></header>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }} className="stack">
        <div className="eyebrow">Liability waiver · {contest.name}</div>
        <h1>Sign for {c.name}</h1>
        <p className="sub2">You are listed as {c.name}’s parent or guardian ({c.publicId}). Read the waiver, then type your full name to sign it. It takes about a minute.</p>
        {c.waiverSignedAt ? (
          <div className="callout green"><Tick /> <span>Signed on {day(c.waiverSignedAt)}. Thank you. You can close this page.</span></div>
        ) : (
          <div className="panel panel-pad stack">
            <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.65 }}>
              <li><b>Permission.</b> I give permission for the competitor named above to take part in {contest.short}, in person or online.</li>
              <li><b>Risks.</b> I accept the ordinary risks of a day-long event, including travel and food eaten during the day.</li>
              <li><b>Release.</b> To the fullest extent the law allows, I release the organisers from claims arising from taking part, except for gross negligence or wilful misconduct.</li>
              <li><b>Supervision.</b> Online, and outside scheduled sessions at the venue, the competitor is my responsibility.</li>
              <li><b>Medical care.</b> If urgent care is needed and I cannot be reached, the organisers may arrange it.</li>
            </ol>
            <p className="sub" style={{ fontSize: 12 }}>The organiser writes this text; MathCloud stores which version you signed.</p>
            <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read the waiver and agree to it.</label>
            <label className="field"><span>Your full name (this is your signature)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={c.guardianName} /></label>
            <button className="btn btn-primary btn-lg" type="button" disabled={!ok} onClick={() => { signWaiver(c.id, name.trim()); setTimeout(() => navigate(-1), 900); }}>Sign waiver</button>
          </div>
        )}
      </main>
    </div>
  );
}
