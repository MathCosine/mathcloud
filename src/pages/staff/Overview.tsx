import { Link, useNavigate } from 'react-router-dom';
import { useContest, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { useDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { contestOf, modeOf, offers } from '../../lib/actions';
import { Ring, Spark } from '../../components/charts';
import { Icon } from '../../components/icons';
import { ModeChip, Roll, State, useNow } from '../../components/ui';

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
  const online = teams.filter((t) => modeOf(contest, t) === 'online');
  const here = teams.filter((t) => modeOf(contest, t) === 'in_person');
  const roomless = online.filter((t) => !contest.rooms.some((r) => r.teamIds.includes(t.id))).length;
  const seatless = here.filter((t) => !contest.venue?.rooms.some((r) => r.teamIds.includes(t.id))).length;
  const hereComps = comps.filter((c) => here.some((t) => t.id === c.teamId));
  const onlineComps = comps.filter((c) => online.some((t) => t.id === c.teamId));
  const checkedIn = hereComps.filter((c) => c.checkedInAt).length;
  const devices = onlineComps.filter((c) => c.deviceCheckedAt).length;
  const started = contest.rounds.some((r) => roundState(r, now) !== 'scheduled');
  const keyed = contest.rounds.flatMap((r) => r.problems).filter((p) => p.answers.join('').trim()).length;
  const problemCount = contest.rounds.flatMap((r) => r.problems).length;

  const todo = [
    { n: questions, text: questions === 1 ? 'question waiting for an answer' : 'questions waiting for an answer', to: '/staff/live' },
    { n: locked, text: locked === 1 ? 'online test locked' : 'online tests locked', to: '/staff/live' },
    { n: unreviewed, text: unreviewed === 1 ? 'answer needs a ruling' : 'answers need a ruling', to: '/staff/grading' },
    { n: comps.length - signed, text: comps.length - signed === 1 ? 'waiver not signed' : 'waivers not signed', to: '/staff/waivers' },
    { n: teams.filter((t) => t.status === 'pending').length, text: 'teams waiting to be confirmed', to: '/staff/teams' },
  ].filter((t) => t.n > 0);

  const ready: { ok: boolean; text: string; to: string; mode?: 'in_person' | 'online' }[] = [
    { ok: teams.length > 0, text: teams.length ? `${teams.length} teams registered` : 'Teams registered or imported', to: '/staff/teams' },
    { ok: keyGaps === 0, text: keyGaps ? `Answer keys: ${keyed} of ${problemCount} filled in` : 'Answer keys complete', to: '/staff/rounds' },
    { ok: comps.length > 0 && signed === comps.length, text: 'Every waiver signed', to: '/staff/waivers' },
    ...(offers(contest, 'in_person') ? [
      { ok: !!contest.venue?.name, text: contest.venue?.name ? `Venue: ${contest.venue.name}` : 'Venue named', to: '/staff/settings', mode: 'in_person' as const },
      { ok: seatless === 0, text: 'Every in-person team has a room', to: '/staff/settings', mode: 'in_person' as const },
    ] : []),
    ...(offers(contest, 'online') ? [
      { ok: contest.rooms.length > 0 && roomless === 0, text: 'Every online team in a Zoom room', to: '/staff/settings', mode: 'online' as const },
      { ok: contest.rooms.length > 0 && contest.rooms.every((r) => r.proctorId), text: 'Every Zoom room has a proctor', to: '/staff/settings', mode: 'online' as const },
    ] : []),
  ];

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{contest.short}</h1>
          <p className="page-sub">{contest.dateLabel} · {contest.divisions.map((d) => (d.mode === 'online' ? 'online' : contest.venue?.name || 'in person')).join(' and ')}</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/staff/import"><Icon name="upload" />Import</Link>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/live')}>Go to Live</button>
        </div>
      </div>

      <div className="figures">
        <Link to="/staff/teams" className="figure fig-link">
          <div className="top-label">Teams</div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <span><b><Roll value={teams.length} /></b><span>{comps.length} competitors</span></span>
            <Spark dates={teams.map((t) => t.registeredAt)} width={96} height={34} />
          </div>
        </Link>
        <Link to="/staff/waivers" className="figure fig-link">
          <div className="top-label">Waivers</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><b><Roll value={signed} /></b><span>of {comps.length} signed</span></span>
            <Ring value={signed} total={comps.length} size={46} tone={signed === comps.length ? 'green' : 'amber'} />
          </div>
        </Link>
        {offers(contest, 'in_person') && (
          <div className="figure">
            <div className="top-label"><ModeChip mode="in_person">{here.length} teams</ModeChip></div>
            <b><Roll value={checkedIn} /></b><span>of {hereComps.length} checked in</span>
          </div>
        )}
        {offers(contest, 'online') && (
          <div className="figure">
            <div className="top-label"><ModeChip mode="online">{online.length} teams</ModeChip></div>
            {started ? <><b><Roll value={inTest} /></b><span>in a test right now</span></> : <><b><Roll value={devices} /></b><span>of {onlineComps.length} device checks done</span></>}
          </div>
        )}
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

      {contest.rounds.length > 0 && contest.rounds.every((r) => roundState(r, now) === 'closed') && (
        <section className="section">
          <div className="section-head"><h2>After the contest</h2></div>
          <ul className="checklist">
            <li className={unreviewed === 0 ? 'done' : ''}><span className="box">{unreviewed === 0 && <Icon name="check" size={13} />}</span><b style={{ fontWeight: 500 }}>{unreviewed ? `${unreviewed} answers to rule on` : 'Every answer ruled on'}</b>{unreviewed ? <Link to="/staff/grading" className="btn btn-sm">Grade</Link> : <span />}</li>
            <li className={contest.resultsPublished ? 'done' : ''}><span className="box">{contest.resultsPublished && <Icon name="check" size={13} />}</span><b style={{ fontWeight: 500 }}>{contest.resultsPublished ? 'Results published' : 'Publish results'}</b>{contest.resultsPublished ? <span /> : <Link to="/staff/results" className="btn btn-sm">Results</Link>}</li>
            <li className={db.sends.some((x) => x.kind === 'score_report') ? 'done' : ''}><span className="box">{db.sends.some((x) => x.kind === 'score_report') && <Icon name="check" size={13} />}</span><b style={{ fontWeight: 500 }}>Send score reports</b><Link to="/staff/reports" className="btn btn-sm">Reports</Link></li>
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Ready for the day</h2><span className="label">{ready.filter((r) => r.ok).length} of {ready.length}</span></div>
        <ul className="checklist">
          {ready.map((r) => (
            <li key={r.text} className={r.ok ? 'done' : ''}>
              <span className="box">{r.ok && <Icon name="check" size={13} />}</span>
              <span className="row" style={{ gap: 10 }}><b style={{ fontWeight: 500 }}>{r.text}</b>{r.mode && <ModeChip mode={r.mode} />}</span>
              {r.ok ? <span /> : <Link to={r.to} className="btn btn-sm">Fix</Link>}
            </li>
          ))}
        </ul>
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
  const contest = contestOf(db);
  const hasOnline = offers(contest, 'online');
  const hasPaper = offers(contest, 'in_person');
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
          {state === 'scheduled'
            ? `${round.minutes} minutes, ${round.problems.length} problems`
            : round.kind === 'guts'
              ? `${attempts.reduce((n, a) => n + (a.setsSubmitted ?? 0), 0)} sets in from ${attempts.filter((a) => (a.setsSubmitted ?? 0) > 0).length} teams${hasOnline ? ` · ${online.filter((a) => !a.submittedAt && a.startedAt).length} online teams working` : ''}`
              : [hasOnline && `${online.filter((a) => a.submittedAt).length} online handed in · ${online.filter((a) => !a.submittedAt && a.startedAt).length} working`, hasPaper && `${paper} paper sheets keyed`].filter(Boolean).join(' · ')}
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
