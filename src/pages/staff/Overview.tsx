import { Link, useNavigate } from 'react-router-dom';
import { useContest, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { useDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Roll, State, useNow } from '../../components/ui';

export function Overview() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const navigate = useNavigate();
  const now = useNow(1000);

  const teams = db.teams.filter((t) => t.status !== 'withdrawn');
  const comps = db.competitors.filter((c) => teams.some((t) => t.id === c.teamId));
  const signed = comps.filter((c) => c.waiverSignedAt).length;
  const inTest = db.attempts.filter((a) => a.source === 'online' && a.startedAt && !a.submittedAt).length;
  const questions = db.clarifications.filter((c) => !c.answer).length;
  const locked = db.attempts.filter((a) => a.locked && !a.submittedAt).length;
  const unreviewed = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);
  const keyGaps = contest.rounds.flatMap((r) => r.problems).filter((p) => !p.answers.join('').trim()).length;
  const online = teams.filter((t) => t.divisionId === 'online');
  const roomless = online.filter((t) => !contest.rooms.some((r) => r.teamIds.includes(t.id))).length;

  const todo = [
    { n: questions, text: questions === 1 ? 'question waiting for an answer' : 'questions waiting for an answer', to: '/staff/live' },
    { n: locked, text: locked === 1 ? 'online test locked' : 'online tests locked', to: '/staff/live' },
    { n: unreviewed, text: unreviewed === 1 ? 'answer needs a ruling' : 'answers need a ruling', to: '/staff/grading' },
    { n: comps.length - signed, text: 'waivers not signed', to: '/staff/roster' },
  ].filter((t) => t.n > 0);

  const ready = [
    { ok: keyGaps === 0, text: 'Answer keys complete' },
    { ok: signed === comps.length, text: 'Every waiver signed' },
    { ok: roomless === 0, text: 'Every online team in a Zoom room' },
    { ok: contest.rooms.every((r) => r.proctorId), text: 'Every room has a proctor' },
  ];

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{contest.short}</h1>
          <p className="page-sub">{contest.dateLabel} · San Francisco and online</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/live')}>Go to Live</button>
      </div>

      <div className="figures">
        <div className="figure"><b><Roll value={teams.length} /></b><span>teams</span></div>
        <div className="figure"><b><Roll value={comps.length} /></b><span>competitors</span></div>
        <div className="figure"><b><Roll value={signed} /></b><span>of {comps.length} waivers signed</span></div>
        <div className="figure"><b><Roll value={inTest} /></b><span>in an online test now</span></div>
      </div>

      <section className="section">
        <div className="section-head"><h2>Today</h2><Link to="/staff/rounds" className="small">Edit rounds</Link></div>
        {contest.rounds.map((r) => <RoundLine key={r.id} round={r} now={now} tz={contest.timeZone} />)}
      </section>

      {todo.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Waiting on you</h2></div>
          {todo.map((t) => (
            <div key={t.text} className="round-line" style={{ gridTemplateColumns: '74px minmax(0, 1fr) auto' }}>
              <b className="wait" style={{ fontSize: 18 }}>{t.n}</b>
              <span>{t.text}</span>
              <Link to={t.to} className="btn btn-sm">Open</Link>
            </div>
          ))}
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Ready for the day</h2><span className="label">{ready.filter((r) => r.ok).length} of {ready.length}</span></div>
        <div className="split-wide" style={{ gap: '6px 40px' }}>
          {ready.map((r) => <State key={r.text} tone={r.ok ? 'ok' : 'wait'}>{r.text}</State>)}
        </div>
      </section>
    </div>
  );
}

function RoundLine({ round, now, tz }: { round: Round; now: number; tz: string }) {
  const db = useDB();
  const navigate = useNavigate();
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const attempts = db.attempts.filter((a) => a.roundId === round.id);
  const online = attempts.filter((a) => a.source === 'online');
  const paper = attempts.filter((a) => a.source === 'paper').length;
  const pct = ends ? Math.max(0, Math.min(100, ((now - (ends - round.minutes * 60000)) / (round.minutes * 60000)) * 100)) : 0;
  return (
    <div className="round-line">
      <time>{clockIn(round.startsAt, tz).replace(' PT', '')}</time>
      <div className="grow">
        <div className="row wrap" style={{ gap: 14 }}>
          <b>{round.name}</b>
          {state === 'open' && ends ? <State tone="go">Open · {duration(ends - now)} left</State> : state === 'closed' ? <State tone="ok">Finished</State> : <State tone="off">Not started</State>}
        </div>
        <div className="muted small" style={{ marginTop: 2 }}>
          {round.kind === 'guts'
            ? `${attempts.reduce((n, a) => n + (a.setsSubmitted ?? 0), 0)} sets in from ${attempts.filter((a) => (a.setsSubmitted ?? 0) > 0).length} teams · ${online.filter((a) => !a.submittedAt && a.startedAt).length} online teams working`
            : `${online.filter((a) => a.submittedAt).length} online handed in · ${online.filter((a) => !a.submittedAt && a.startedAt).length} working · ${paper} paper sheets keyed`}
        </div>
        {state === 'open' && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
      </div>
      {round.kind === 'guts' ? (
        <button className="btn btn-sm" type="button" onClick={() => navigate('/board')}>Scoreboard</button>
      ) : (
        <span />
      )}
    </div>
  );
}
