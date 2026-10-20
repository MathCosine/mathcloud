import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { closeRound, offers, openRound, saveRound } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Contest, IntegrityPolicy, Round, RoundKind } from '../../lib/model';
import { isAnswered } from '../../lib/problem-grid';
import { useUser } from '../../lib/session';
import { useDraft } from '../../lib/useDraft';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Icon, type IconName } from '../../components/icons';
import { EmptyState, Modal, State, toast, useNow } from '../../components/ui';
import '../../styles/rounds.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const INTEGRITY: Record<IntegrityPolicy, string> = { log: 'leaving the test is logged', warn: 'leaving the test is logged and warned', lock: 'leaving the test locks it' };
const KIND: Record<RoundKind, { icon: IconName; label: string }> = {
  individual: { icon: 'user', label: 'Individual' },
  team: { icon: 'people', label: 'Team round' },
  guts: { icon: 'zap', label: 'Guts' },
};

// ------------------------------------------------------------------- page

export function Rounds() {
  const contest = useContest();
  const now = useNow(1000);
  const [params] = useSearchParams();
  const wanted = params.get('round');
  const states = contest.rounds.map((r) => roundState(r, now));
  const open = contest.rounds.find((_, i) => states[i] === 'open');
  const next = open ? undefined : contest.rounds.find((_, i) => states[i] === 'scheduled');
  const missing = contest.rounds.reduce((n, r) => n + r.problems.filter((p) => !isAnswered(p)).length, 0);
  const ends = open ? roundEnds(open) : null;

  // Arriving from elsewhere with ?round=: bring that round into view.
  useEffect(() => {
    if (!wanted) return;
    const t = setTimeout(() => document.getElementById(`round-${wanted}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    return () => clearTimeout(t);
  }, [wanted]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rounds</h1>
          <p className="page-sub">
            {!contest.rounds.length ? 'No rounds yet.'
              : open ? `${open.name} is open${ends ? `, ${duration(ends - now)} left` : ''}.`
                : next ? `Next: ${next.name} at ${clockIn(next.startsAt, contest.timeZone)}.`
                  : `All ${plural(contest.rounds.length, 'round')} are over.`}
            {missing > 0 && <> <span className="rd-amber">{plural(missing, 'problem')} still {missing === 1 ? 'needs' : 'need'} an answer.</span></>}
          </p>
        </div>
        {contest.rounds.length > 0 && (
          <div className="actions">
            <Link className="btn" to="/staff/problems"><Icon name="sigma" />Problems and answers</Link>
          </div>
        )}
      </div>
      {!contest.rounds.length ? (
        <section className="card">
          <EmptyState icon="rounds" title="No rounds yet" action={<Link className="btn btn-primary" to="/staff/new"><Icon name="plus" />Create a contest</Link>}>
            Rounds are set when the contest is created.
          </EmptyState>
        </section>
      ) : (
        <div className="stack rd-list">
          {contest.rounds.map((r) => <RoundCard key={r.id} round={r} contest={contest} next={next?.id === r.id} wanted={wanted === r.id} />)}
        </div>
      )}
    </>
  );
}

// -------------------------------------------------------------- one round

function RoundCard({ round, contest, next, wanted }: { round: Round; contest: Contest; next: boolean; wanted: boolean }) {
  const me = useUser()!;
  const now = useNow(1000);
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const [settings, setSettings] = useState(false);
  const director = me.role === 'director';
  const online = offers(contest, 'online');
  const guts = round.kind === 'guts';
  const total = round.problems.length;
  const noAnswer = round.problems.filter((p) => !isAnswered(p)).length;
  const answered = total - noAnswer;
  const sets = new Set(round.problems.map((p) => p.set ?? 1)).size;
  const points = [...new Set(round.problems.map((p) => p.points))];

  const kind = KIND[round.kind];
  // "Individual · 60 minutes", not "Individual · Individual".
  const named = round.name.trim().toLowerCase() === kind.label.toLowerCase();
  const format = [
    guts && sets ? (named ? plural(sets, 'set') : `${kind.label}, ${plural(sets, 'set')}`) : named ? '' : kind.label,
    `${round.minutes} minutes`,
    `starts ${clockIn(round.startsAt, contest.timeZone)}`,
  ].filter(Boolean).join(' · ');
  const rules = [
    round.graceSeconds ? `${round.graceSeconds} s grace` : 'no grace period',
    online ? INTEGRITY[round.integrity.policy] : '',
    round.mystery ? 'format secret until it starts' : '',
  ].filter(Boolean).join(' · ');

  const roundButton = !director ? null : state === 'open' ? (
    <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>
  ) : state === 'closed' ? (
    <button className="btn" type="button" onClick={() => setConfirm('open')}>Reopen round</button>
  ) : (
    <button className={`btn ${next ? 'btn-primary' : ''}`} type="button" onClick={() => setConfirm('open')}><Icon name="clock" />Open round</button>
  );

  return (
    <section className={`card rd-card ${wanted ? 'wanted' : ''} ${state}`} id={`round-${round.id}`}>
      <div className="rd-top">
        <span className="rd-ic"><Icon name={kind.icon} size={18} /></span>
        <div className="rd-title">
          <h2>{round.name}</h2>
          <span className="rd-format">{format}</span>
        </div>
        <div className="rd-act">
          {state === 'open' && ends ? <State tone="go">Open · {duration(ends - now)} left</State>
            : state === 'closed' ? <State tone="ok">Finished</State>
              : <State tone="off">Not started</State>}
          {roundButton}
        </div>
      </div>

      <div className="rd-line">
        <Icon name="sigma" size={15} />
        <div className="rd-line-main">
          <span className={`rd-key ${!total ? 'rd-amber' : noAnswer ? 'rd-amber' : ''}`}>
            {!total ? 'No problems yet'
              : noAnswer ? <>{plural(total, 'problem')}, <b>{noAnswer} without an answer</b></>
                : <>{plural(total, 'problem')}, all answered</>}
          </span>
          {total > 0 && (
            <span className="rd-bar" role="img" aria-label={`${answered} of ${total} answered`}>
              <i style={{ width: `${(answered / total) * 100}%` }} className={noAnswer ? 'part' : ''} />
            </span>
          )}
          {points.length > 0 && <span className="rd-soft">{points.length === 1 ? `${plural(points[0], 'point')} each` : `${Math.min(...points)} to ${Math.max(...points)} points`}</span>}
        </div>
        <Link className="btn btn-sm" to={`/staff/problems?round=${round.id}`}>{total ? 'Edit problems and answers' : 'Add problems and answers'}<Icon name="arrow" size={14} /></Link>
      </div>

      <div className="rd-line">
        <Icon name="setup" size={15} />
        <div className="rd-line-main"><span className="rd-soft">{rules}</span></div>
        <button className="btn btn-sm btn-quiet rd-toggle" type="button" aria-expanded={settings} onClick={() => setSettings((s) => !s)}>
          {settings ? 'Hide settings' : 'Edit settings'}<Icon name="chevron" size={14} className="rd-chev" />
        </button>
      </div>
      <div className={`rd-fold ${settings ? 'open' : ''}`} inert={!settings}><div><RoundSettings round={round} online={online} /></div></div>

      {confirm && (
        <Modal
          title={confirm === 'open' ? `${state === 'closed' ? 'Reopen' : 'Open'} ${round.name}?` : `Close ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' && state !== 'closed' ? 'btn-primary' : 'btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') { openRound(round.id); toast(`${round.name} is open`, `${round.minutes} minutes from now.`, 'g'); }
                else { closeRound(round.id); toast(`${round.name} is closed`, 'Every online test was handed in.'); }
                setConfirm(null);
              }}>{confirm === 'open' ? (state === 'closed' ? 'Reopen and clear answers' : 'Open now') : 'Close and hand in'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `The ${round.minutes}-minute clock starts now for everyone${contest.divisions.length > 1 ? ', in both divisions' : ''}.${state === 'closed' ? ' Online answers from the last run are cleared.' : ''}` : 'Every online test still open is handed in as it is.'}</p>
          {confirm === 'open' && (noAnswer > 0 || !total) && (
            <p className="rd-warn small">
              <Icon name="alert" size={15} />
              <span>{!total ? 'This round has no problems yet.' : `${plural(noAnswer, 'problem')} ${noAnswer === 1 ? 'has' : 'have'} no answer yet.`} <Link to={`/staff/problems?round=${round.id}`}>Add {noAnswer === 1 ? 'it' : 'them'} first</Link></span>
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

// ------------------------------------------------------- round settings

function RoundSettings({ round, online }: { round: Round; online: boolean }) {
  const [name, setName, flushName] = useDraft(round.name, (v) => v.trim() && saveRound(round.id, { name: v.trim() }));
  const [minutes, setMinutes, flushMinutes] = useDraft(String(round.minutes), (v) => Number(v) > 0 && saveRound(round.id, { minutes: Number(v) }));
  const [grace, setGrace, flushGrace] = useDraft(String(round.graceSeconds), (v) => Number(v) >= 0 && v !== '' && saveRound(round.id, { graceSeconds: Number(v) }));
  const [rules, setRules, flushRules] = useDraft(round.rules, (v) => saveRound(round.id, { rules: v }));
  return (
    <div className="rd-settings">
      <div className="rd-settings-grid">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={flushName} />
        </label>
        <label className="field">
          <span>Length</span>
          <span className="rd-unit"><input className="input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={flushMinutes} /><em>minutes</em></span>
        </label>
        <label className="field">
          <span>Grace period</span>
          <span className="rd-unit"><input className="input" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} onBlur={flushGrace} /><em>seconds</em></span>
          <small>Late answers accepted after time.</small>
        </label>
        {online && (
          <label className="field">
            <span>When a student leaves the test</span>
            <select className="select" value={round.integrity.policy} onChange={(e) => saveRound(round.id, { integrity: { ...round.integrity, policy: e.target.value as IntegrityPolicy } })}>
              <option value="log">Log it</option>
              <option value="warn">Log it and warn</option>
              <option value="lock">Lock after {round.integrity.lockAfter} times</option>
            </select>
          </label>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={!!round.mystery} onChange={(e) => saveRound(round.id, { mystery: e.target.checked })} />
        Keep the format secret until it starts
      </label>
      <label className="field">
        <span>Rules shown before the start</span>
        <textarea className="textarea rd-rules" value={rules} onChange={(e) => setRules(e.target.value)} onBlur={flushRules} placeholder="Work alone. No calculators. Exact answers only." />
      </label>
    </div>
  );
}
