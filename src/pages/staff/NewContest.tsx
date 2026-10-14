import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createContest, longDate, type NewContest as Plan, type RoundPlan } from '../../lib/actions';
import type { DivisionMode } from '../../lib/model';
import { Icon } from '../../components/icons';
import { Choice, ModeChip, toast } from '../../components/ui';

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

const STEPS = ['Basics', 'How teams take part', 'Rounds', 'Sign-ups'];

export function NewContest() {
  const navigate = useNavigate();
  const guessZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<Format | null>(null);
  const [signup, setSignup] = useState<Signup>('form');
  const [plan, setPlan] = useState<Plan>({
    name: '', short: '', date: '2027-03-13',
    timeZone: ZONES.some(([z]) => z === guessZone) ? guessZone : 'America/Los_Angeles',
    modes: [], venueName: '', venueAddress: '', onlineDetail: '', rounds: ['individual', 'team', 'guts'],
  });
  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));
  const modes: DivisionMode[] = format === 'both' ? ['in_person', 'online'] : format ? [format] : [];

  const problems = [
    !plan.name.trim() && 'Give the contest a name.',
    !plan.short.trim() && 'Give it a short name for the sidebar and certificates.',
  ].filter(Boolean) as string[];
  const ok = [problems.length === 0, !!format && (!modes.includes('in_person') || plan.venueName.trim().length > 1), plan.rounds.length > 0, true];

  const next = () => {
    if (!ok[step]) {
      toast(step === 0 ? problems[0] : step === 1 ? (format ? 'Where is it? Add the venue.' : 'Choose how teams take part.') : 'Pick at least one round.', undefined, 'a');
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const create = async () => {
    try {
      await createContest({ ...plan, modes });
    } catch (e) {
      return toast('Contest not created', e instanceof Error ? e.message : String(e), 'r');
    }
    toast(`${plan.short} is ready`, signup === 'import' ? 'Bring in your teams from a spreadsheet.' : 'Registration is open. Share the link from Setup.', 'g');
    navigate(signup === 'import' ? '/staff/roster/import' : '/staff', { replace: true });
  };


  return (
    <div className="stack-lg" style={{ maxWidth: 860 }}>
      <div>
        <h1 className="page-title">New contest</h1>
        <p className="page-sub">Four short steps. Everything here can be changed later in Setup.</p>
      </div>

      <nav className="steps" aria-label="Steps" style={{ marginBottom: 0 }}>
        {STEPS.map((s, i) => (
          <button key={s} type="button" aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''} disabled={i > step} onClick={() => i < step && setStep(i)}>
            <i>{i < step ? <Icon name="check" size={12} /> : i + 1}</i>{s}
          </button>
        ))}
      </nav>

      <section className="card form-card reveal" key={step}>
        {step === 0 && (
          <>
            <h2>What is it called, and when is it?</h2>
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
              <label className="field"><span>Name</span><input className="input" autoFocus value={plan.name} placeholder="Bay Area Math Meet 2027" onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="field"><span>Short name</span><input className="input" value={plan.short} placeholder="BAMM 2027" onChange={(e) => set({ short: e.target.value })} /></label>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
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
                points={[{ icon: 'switch', text: 'Each coach picks in person or online' }, { icon: 'results', text: 'Ranked separately, one set of rounds' }, { icon: 'board', text: 'One board, a column for each' }]}>
                A venue, plus an online division.
              </Choice>
            </div>
            {modes.includes('in_person') && (
              <div className="stack reveal" style={{ gap: 12 }}>
                <ModeChip mode="in_person">The venue</ModeChip>
                <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
                  <label className="field"><span>Venue</span><input className="input" value={plan.venueName} placeholder="Lincoln High School" onChange={(e) => set({ venueName: e.target.value })} /></label>
                  <label className="field"><span>Address</span><input className="input" value={plan.venueAddress} placeholder="2162 24th Ave, San Francisco" onChange={(e) => set({ venueAddress: e.target.value })} /></label>
                </div>
              </div>
            )}
            {modes.includes('online') && (
              <div className="stack reveal" style={{ gap: 12 }}>
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
              <h2>How will teams sign up?</h2>
              <p className="soft">Use one, or both: teams from a spreadsheet and teams from the form end up in the same roster.</p>
            </div>
            <div className="choices" role="radiogroup" aria-label="How teams sign up">
              <Choice tone="both" icon="link" title="Our registration form" checked={signup === 'form'} onSelect={() => setSignup('form')}>
                A page you link to. {format === 'both' ? 'Coaches choose in person or online first.' : 'Coaches add their students.'}
              </Choice>
              <Choice tone="both" icon="table" title="Import a spreadsheet" checked={signup === 'import'} onSelect={() => setSignup('import')}>
                Teams who signed up on your own site or a Google Form. CSV, with any columns.
              </Choice>
            </div>
            <div className="note">
              <b>{plan.name || 'Your contest'}</b> on {longDate(plan.date)}, {modes.map((m) => (m === 'online' ? 'online' : `in person at ${plan.venueName || 'the venue'}`)).join(' and ')}, with {plan.rounds.length} {plan.rounds.length === 1 ? 'round' : 'rounds'}: {plan.rounds.map((r) => ROUNDS.find((x) => x.key === r)!.title).join(', ')}.
            </div>
          </>
        )}

        <div className="form-foot">
          {step > 0 ? <button className="btn btn-quiet" type="button" onClick={() => setStep(step - 1)}><Icon name="back" />Back</button> : <button className="btn btn-quiet" type="button" onClick={() => navigate(-1)}>Cancel</button>}
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" type="button" onClick={next}>Continue<Icon name="arrow" /></button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={create}>Create {plan.short || 'contest'}</button>
          )}
        </div>
      </section>
    </div>
  );
}
