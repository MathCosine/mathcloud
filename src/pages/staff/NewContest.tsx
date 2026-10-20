import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createContest, longDate, type NewContest as Plan, type RoundPlan } from '../../lib/actions';
import type { DivisionMode } from '../../lib/model';
import { Icon } from '../../components/icons';
import { Choice, ModeChip, toast } from '../../components/ui';
import '../../styles/settings.css';

const ZONES: [string, string][] = [
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/New_York', 'Eastern (New York)'],
  ['Europe/London', 'London'],
  ['Europe/Berlin', 'Central Europe (Berlin)'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Shanghai', 'China (Shanghai)'],
  ['Asia/Tokyo', 'Japan (Tokyo)'],
  ['Australia/Sydney', 'Sydney'],
];

type Format = 'in_person' | 'online' | 'both';
type Signup = 'form' | 'import' | 'both';

const ROUNDS: { key: RoundPlan; title: string; text: string }[] = [
  { key: 'individual', title: 'Individual', text: '20 short-answer problems, 60 minutes, one point each.' },
  { key: 'team', title: 'Team', text: '10 problems, 45 minutes, one answer sheet per team.' },
  { key: 'guts', title: 'Guts', text: 'Six sets of four, 60 minutes, with the live scoreboard.' },
];

const STEPS = ['Basics', 'How teams take part', 'Rounds', 'Teams'];

export function NewContest() {
  const navigate = useNavigate();
  const guessZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<Format | null>(null);
  const [signup, setSignup] = useState<Signup>('import');
  const [plan, setPlan] = useState<Plan>({
    name: '', short: '', date: '2027-03-13',
    timeZone: ZONES.some(([z]) => z === guessZone) ? guessZone : 'America/Los_Angeles',
    modes: [], venueName: '', venueAddress: '', onlineDetail: '', rounds: ['individual', 'team', 'guts'],
  });
  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));
  const modes: DivisionMode[] = format === 'both' ? ['in_person', 'online'] : format ? [format] : [];

  const problems = [
    !plan.name.trim() && 'Give the contest a name.',
    !plan.short.trim() && 'Give it a short name for tabs and emails.',
  ].filter(Boolean) as string[];
  const ok = [problems.length === 0, !!format && (!modes.includes('in_person') || plan.venueName.trim().length > 1), plan.rounds.length > 0, true];

  const missing = step === 0 ? problems[0] : step === 1 ? (format ? 'Add the venue’s name.' : 'Choose how teams take part.') : 'Pick at least one round.';
  const next = () => {
    if (!ok[step]) {
      toast(missing, undefined, 'a');
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const create = async () => {
    try {
      await createContest({ ...plan, modes, coaches: signup === 'form' });
    } catch (e) {
      return toast('Contest not created', e instanceof Error ? e.message : String(e), 'r');
    }
    toast(
      format === 'both' ? `${plan.short} is ready, in person and online` : `${plan.short} is ready`,
      signup === 'import' ? 'Bring in your teams from your spreadsheet or old sign-up.' : 'Registration is open. Share the link from Settings.',
      'g',
    );
    navigate(signup === 'import' ? '/staff/import?type=teams' : '/staff', { replace: true });
  };


  return (
    <div className="stack-lg nc">
      <div>
        <h1 className="page-title">New contest</h1>
        <p className="page-sub">Four short steps. Everything here can be changed later in Settings.</p>
      </div>

      <nav aria-label="Steps">
        <ol className="nc-steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" aria-current={i === step ? 'step' : undefined} className={`nc-step ${i < step ? 'done' : i === step ? 'now' : ''}`} disabled={i >= step} onClick={() => i < step && setStep(i)} title={i < step ? `Back to ${s.toLowerCase()}` : undefined}>
                <span className="bar"><i /></span>
                <span className="lab">{i < step ? <Icon name="check" size={13} /> : <span className="mono">{i + 1}</span>}<span>{s}</span></span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="card form-card reveal" key={step}>
        {step === 0 && (
          <>
            <h2>What is it called, and when is it?</h2>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <label className="field"><span>Name</span><input className="input" autoFocus value={plan.name} placeholder="Bay Area Math Meet 2027" onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="field"><span>Short name</span><input className="input" value={plan.short} placeholder="BAMM 2027" onChange={(e) => set({ short: e.target.value })} /></label>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <label className="field"><span>Date</span><input className="input" type="date" value={plan.date} onChange={(e) => set({ date: e.target.value })} /><small>{plan.date ? longDate(plan.date) : ''}</small></label>
              <label className="field">
                <span>Time zone</span>
                <select className="select" value={plan.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
                  {ZONES.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
                </select>
                <small>The schedule is set in this zone. Online students also see their own.</small>
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <h2>How will teams take part?</h2>
              <p className="soft">This decides how answers are collected, who you need on the day, and what every coach and student sees.</p>
            </div>
            <div className="choices" role="radiogroup" aria-label="How teams take part">
              <Choice tone="in_person" icon="pin" title="In person" checked={format === 'in_person'} onSelect={() => setFormat('in_person')}
                points={[{ icon: 'file', text: 'Answers on paper; graders key them in' }, { icon: 'ticket', text: 'Check-in, rooms and a projector board' }, { icon: 'roster', text: 'Proctors in the room' }]}>
                Everyone comes to one venue.
              </Choice>
              <Choice tone="online" icon="screen" title="Online" checked={format === 'online'} onSelect={() => setFormat('online')}
                points={[{ icon: 'screen', text: 'Tests in the browser; answers mark themselves' }, { icon: 'video', text: 'Zoom rooms with a proctor each' }, { icon: 'globe', text: 'Students see times in their own zone' }]}>
                Everyone takes part from where they are.
              </Choice>
              <Choice tone="both" icon="both" title="Both, at the same time" checked={format === 'both'} onSelect={() => setFormat('both')}
                points={[{ icon: 'copy', text: 'Two linked contests, one for each way' }, { icon: 'rounds', text: 'Rounds and problems copied to both' }, { icon: 'results', text: 'Teams, rooms and results kept apart' }]}>
                A venue, plus an online edition running alongside.
              </Choice>
            </div>
            {modes.includes('in_person') && (
              <div className="nc-part reveal">
                <ModeChip mode="in_person">The venue</ModeChip>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                  <label className="field"><span>Venue</span><input className="input" value={plan.venueName} placeholder="Lincoln High School" onChange={(e) => set({ venueName: e.target.value })} /></label>
                  <label className="field"><span>Address</span><input className="input" value={plan.venueAddress} placeholder="2162 24th Ave, San Francisco" onChange={(e) => set({ venueAddress: e.target.value })} /></label>
                </div>
              </div>
            )}
            {modes.includes('online') && (
              <div className="nc-part reveal">
                <ModeChip mode="online">Who can take part online</ModeChip>
                <label className="field">
                  <span>Shown to coaches when they choose</span>
                  <input className="input" value={plan.onlineDetail} placeholder={format === 'both' ? 'Teams more than 100 miles from the venue' : 'Anyone, anywhere, with a computer and a camera'} onChange={(e) => set({ onlineDetail: e.target.value })} />
                </label>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <h2>Which rounds?</h2>
              <p className="soft">They start with empty answer keys. Fill them in under Rounds, or add your own format later.</p>
            </div>
            <div className="stack" style={{ gap: 10 }} role="group" aria-label="Rounds">
              {ROUNDS.map((r) => (
                <Choice key={r.key} compact tone="both" icon={r.key === 'guts' ? 'board' : r.key === 'team' ? 'roster' : 'pencil'} title={r.title}
                  checked={plan.rounds.includes(r.key)} onSelect={() => set({ rounds: plan.rounds.includes(r.key) ? plan.rounds.filter((x) => x !== r.key) : ROUNDS.map((x) => x.key).filter((k) => k === r.key || plan.rounds.includes(k)) })}>
                  {r.text}
                </Choice>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <h2>Who enters the teams?</h2>
              <p className="soft">Either way, organisers can add, import and edit every team at any time.</p>
            </div>
            <div className="choices" role="radiogroup" aria-label="Who enters the teams">
              <Choice tone="both" icon="upload" title="We do" checked={signup === 'import'} onSelect={() => setSignup('import')}
                points={[{ icon: 'table', text: 'Import from your old sign-up, a Google Form or Excel' }, { icon: 'waivers', text: 'Bring waivers you already have' }, { icon: 'student', text: 'Students only sign in to take tests' }]}>
                Coaches never need an account.
              </Choice>
              <Choice tone="both" icon="link" title="Coaches register" checked={signup === 'form'} onSelect={() => setSignup('form')}
                points={[{ icon: 'link', text: 'A registration page you link to' }, { icon: 'roster', text: 'Coaches manage their own rosters' }, { icon: 'send', text: 'Guardians sign waivers online' }]}>
                {format === 'both' ? 'Coaches choose in person or online first.' : 'Coaches add their students.'}
              </Choice>
            </div>
            <div className="nc-summary">
              <Icon name="info" />
              <span>
                <b>{plan.name || 'Your contest'}</b> on {longDate(plan.date)}, {modes.map((m) => (m === 'online' ? 'online' : `in person at ${plan.venueName || 'the venue'}`)).join(' and ')}, with {plan.rounds.length} {plan.rounds.length === 1 ? 'round' : 'rounds'}: {plan.rounds.map((r) => ROUNDS.find((x) => x.key === r)!.title).join(', ')}.
                {format === 'both' && ' This makes two linked contests, in person and online; switch between them from the contest menu.'}
              </span>
            </div>
          </>
        )}

        <div className="form-foot">
          {step > 0 ? <button className="btn btn-quiet" type="button" onClick={() => setStep(step - 1)}><Icon name="back" />Back</button> : <button className="btn btn-quiet" type="button" onClick={() => navigate(-1)}>Cancel</button>}
          <div className="row wrap" style={{ gap: 12, justifyContent: 'flex-end' }}>
            {!ok[step] && <span className="muted small">{missing}</span>}
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" type="button" onClick={next}>Continue<Icon name="arrow" /></button>
            ) : (
              <button className="btn btn-primary" type="button" onClick={create}><Icon name="check" />Create {plan.short || 'contest'}</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
