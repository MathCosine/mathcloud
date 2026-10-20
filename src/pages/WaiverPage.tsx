import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../styles/public.css';
import { signWaiver } from '../lib/actions';
import { REMOTE, useAllDB } from '../lib/store';
import * as W from '../lib/remote/write';
import { day } from '../lib/time';
import { Logo } from '../components/art';

/** Who the link is for, from either source. */
type Info = { student: string; publicId: string; contest: string; guardian: string; signedAt: string | null; signedBy?: string | null };

/**
 * The page a guardian reaches from the emailed link. No account needed.
 * Sandbox: the link carries the competitor id. Connected: a token, checked by the database.
 */
export function WaiverPage() {
  const { token = '' } = useParams();
  const all = useAllDB();
  const navigate = useNavigate();
  const [remote, setRemote] = useState<{ info: Info | null; error: string | null } | null>(null);
  const [justSigned, setJustSigned] = useState<{ at: string; by: string } | null>(null);

  useEffect(() => {
    if (!REMOTE) return;
    let live = true;
    void W.waiverInfo(token).then(({ data, error }) => {
      if (!live) return;
      const r = data?.[0];
      setRemote({
        error,
        info: r ? { student: r.competitor_name, publicId: r.public_id, contest: r.contest_name, guardian: r.guardian_name ?? '', signedAt: r.signed_at ?? null } : null,
      });
    });
    return () => {
      live = false;
    };
  }, [token]);

  let info: Info | null = null;
  if (REMOTE) info = remote?.info ?? null;
  else {
    const c = all.competitors.find((x) => x.id === token);
    const team = c && all.teams.find((t) => t.id === c.teamId);
    const contest = team && all.contests.find((k) => k.id === team.contestId);
    if (c) info = { student: c.name, publicId: c.publicId, contest: contest?.name ?? '', guardian: c.guardianName, signedAt: c.waiverSignedAt, signedBy: c.waiverSignedBy };
  }
  const loading = REMOTE && !remote;
  const signedAt = justSigned?.at ?? info?.signedAt ?? null;

  const sign = async (name: string): Promise<string | null> => {
    if (!info) return 'This link has expired.';
    if (REMOTE) {
      const r = await W.signWaiver(token, name);
      if (r.error) return r.error;
    } else {
      signWaiver(token, name);
    }
    setJustSigned({ at: new Date().toISOString(), by: name });
    return null;
  };

  return (
    <div className="pub wv">
      <header className="pub-top">
        <div className="lp-wrap pub-top-in">
          <span className="brand"><Logo size={26} /><span>MathCloud</span></span>
          {info?.contest && <span className="muted small hide-sm">Waiver for {info.contest}</span>}
        </div>
      </header>
      <main className="wv-main">
        {loading ? (
          <p className="muted row"><span className="spinner" />Opening the waiver</p>
        ) : !info ? (
          <div className="card wv-card stack">
            <h1 className="page-title">This link does not work any more</h1>
            <p className="soft">{remote?.error ?? 'It may have been replaced by a newer email. Ask the team’s coach or the organisers to send the waiver link again.'}</p>
          </div>
        ) : signedAt ? (
          <div className="card wv-card wv-done reveal">
            <SignedArt />
            <h1 className="page-title">Waiver signed</h1>
            <p className="soft">
              {info.student} ({info.publicId}) can take part in {info.contest}. Signed {justSigned ? `by ${justSigned.by} ` : info.signedBy ? `by ${info.signedBy} ` : ''}on {day(signedAt)}.
            </p>
            <p className="small muted">The organisers and the coach can see it now. You can close this page.</p>
            {!REMOTE && justSigned && window.history.length > 1 && <div><button type="button" className="btn btn-sm" onClick={() => navigate(-1)}>Back</button></div>}
          </div>
        ) : (
          <WaiverForm info={info} onSign={sign} />
        )}
      </main>
    </div>
  );
}

function WaiverForm({ info, onSign }: { info: Info; onSign: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = info.student.split(' ')[0];
  const ready = agree && name.trim().length >= 4;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const err = await onSign(name.trim());
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <form className="card wv-card stack-lg" onSubmit={submit}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Participation and liability waiver · {info.contest}</span>
        <h1 className="page-title">Waiver for {info.student}</h1>
        <p className="soft">
          {info.guardian ? `This link was sent to ${info.guardian}, listed as ${first}’s parent or guardian.` : `You are receiving this as ${first}’s parent or guardian.`} Read it, then type your full name to sign.
        </p>
      </div>
      <dl className="wv-facts">
        <div><dt>Student</dt><dd>{info.student}</dd></div>
        <div><dt>Competitor ID</dt><dd className="mono">{info.publicId}</dd></div>
        <div><dt>Contest</dt><dd>{info.contest}</dd></div>
      </dl>
      <ol className="wv-text">
        <li><b>Permission.</b> {info.student} may take part in {info.contest}, in person or online.</li>
        <li><b>Risks.</b> I accept the ordinary risks of a day-long event, including travel and food.</li>
        <li><b>Release.</b> As far as the law allows, I release the organisers from claims arising from taking part, except for gross negligence or wilful misconduct.</li>
        <li><b>Supervision.</b> Online, and outside scheduled sessions at the venue, {first} is my responsibility.</li>
        <li><b>Medical care.</b> If urgent care is needed and I cannot be reached, the organisers may arrange it.</li>
      </ol>
      <div className="wv-sign stack">
        <label className="field">
          <span>Your full name</span>
          <input className="input wv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={info.guardian || 'First and last name'} autoComplete="name" />
        </label>
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I am {first}’s parent or legal guardian, I have read this waiver and I agree to it.</label>
        {error && <div className="note red" role="alert">{error}</div>}
        <div><button className="btn btn-primary btn-lg" type="submit" disabled={!ready || busy}>{busy ? <><span className="spinner" />Signing</> : 'Sign the waiver'}</button></div>
        <p className="small muted">Typing your name here counts as your signature. The time and the name you type are recorded.</p>
      </div>
    </form>
  );
}

function SignedArt() {
  return (
    <svg viewBox="0 0 120 96" className="wv-art" aria-hidden="true">
      <rect x="26" y="8" width="58" height="76" rx="5" fill="var(--bg)" stroke="var(--line-2)" />
      <rect x="35" y="20" width="40" height="5" rx="2.5" fill="var(--bg-3)" />
      <rect x="35" y="31" width="32" height="5" rx="2.5" fill="var(--bg-3)" />
      <rect x="35" y="42" width="36" height="5" rx="2.5" fill="var(--bg-3)" />
      <path d="M36 68c5-7 8 3 13-2s7 2 12-1" fill="none" stroke="var(--ink-2)" strokeWidth="1.8" strokeLinecap="round" />
      <circle className="wv-seal" cx="84" cy="66" r="17" fill="var(--green)" />
      <path className="wv-check" d="M76 66.5l5.5 5.5 10.5-11" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
