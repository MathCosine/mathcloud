import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useContest, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { useDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { contestOf, modeOf, offers } from '../../lib/actions';
import { Ring, Spark } from '../../components/charts';
import { Icon } from '../../components/icons';
import { ModeChip, Roll, State, useNow } from '../../components/ui';
import '../../styles/dayof.css';

/** What needs the organiser now: things waiting on them, then the day's rounds, then readiness. */
export function Overview() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [showReady, setShowReady] = useState(false);

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
  const states = contest.rounds.map((r) => roundState(r, now));
  const started = states.some((s) => s !== 'scheduled');
  const allDone = contest.rounds.length > 0 && states.every((s) => s === 'closed');
  const openRound = contest.rounds.find((_, i) => states[i] === 'open');
  const nextRound = contest.rounds.find((_, i) => states[i] === 'scheduled');
  const keyed = contest.rounds.flatMap((r) => r.problems).filter((p) => p.answers.join('').trim()).length;
  const problemCount = contest.rounds.flatMap((r) => r.problems).length;
  const pending = teams.filter((t) => t.status === 'pending').length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const todo = [
    { n: questions, text: plural(questions, 'question waiting for an answer', 'questions waiting for an answer'), to: '/staff/live', go: 'Answer' },
    { n: locked, text: plural(locked, 'online test locked', 'online tests locked'), to: '/staff/live', go: 'Unlock' },
    { n: allDone ? 0 : unreviewed, text: plural(unreviewed, 'answer needs a ruling', 'answers need a ruling'), to: '/staff/grading', go: 'Rule on them' },
    { n: started && !allDone ? hereComps.length - checkedIn : 0, text: plural(hereComps.length - checkedIn, 'in-person student not checked in', 'in-person students not checked in'), to: '/staff/people?tab=checkin', go: 'Check in' },
    { n: comps.length - signed, text: plural(comps.length - signed, 'waiver not signed', 'waivers not signed'), to: '/staff/waivers', go: 'Remind' },
    { n: pending, text: plural(pending, 'team waiting to be confirmed', 'teams waiting to be confirmed'), to: '/staff/teams', go: 'Review' },
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
  const readyCount = ready.filter((r) => r.ok).length;
  const allReady = readyCount === ready.length;

  // The title says where the day is; the subtitle says what needs you.
  const ends = openRound ? roundEnds(openRound) : null;
  const daysTo = nextRound ? Math.ceil((new Date(nextRound.startsAt).getTime() - now) / 86400000) : 0;
  const title = openRound && ends
    ? `${openRound.name} is open · ${Math.max(0, Math.ceil((ends - now) / 60000))} min left`
    : allDone
      ? 'Every round has finished'
      : nextRound && !started && daysTo > 1
        ? `${daysTo} days to go`
        : nextRound
          ? `${nextRound.name} ${started ? 'is next, at' : 'starts at'} ${clockIn(nextRound.startsAt, contest.timeZone).replace(' PT', '')}`
          : 'Overview';
  const afterSteps = allDone ? [unreviewed === 0, contest.resultsPublished, db.sends.some((x) => x.kind === 'score_report')] : [];
  const waiting = todo.length + afterSteps.filter((d) => !d).length;
  const sub = waiting === 0
    ? allDone ? 'Results are out and reports are sent. Nothing is waiting on you.' : 'Nothing is waiting on you right now.'
    : allDone && todo.length === 0
      ? `${afterSteps.filter((d) => !d).length} steps left to finish the contest.`
      : `${plural(waiting, 'thing needs', 'things need')} you, most urgent first.`;

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/staff/import"><Icon name="upload" />Import</Link>
          {allDone ? (
            <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/results')}>Go to Results</button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/live')}>Go to Live</button>
          )}
        </div>
      </div>

      {todo.length > 0 && (
        <section className="section ov-todo">
          <div className="section-head"><h2>Waiting on you</h2><span className="badge">{todo.length}</span></div>
          {todo.map((t) => (
            <Link key={t.text} to={t.to} className="ov-item">
              <span className="ov-n">{t.n}</span>
              <span className="ov-text">{t.text.replace(/^\d+ /, '')}</span>
              <span className="btn btn-sm">{t.go}<Icon name="arrow" size={14} /></span>
            </Link>
          ))}
        </section>
      )}

      {allDone && (
        <section className="section">
          <div className="section-head"><h2>Finish the contest</h2><span className="label">{afterSteps.filter(Boolean).length} of 3 done</span></div>
          <ul className="checklist">
            <Step done={unreviewed === 0} text={unreviewed ? `Rule on ${plural(unreviewed, 'answer', 'answers')}` : 'Every answer ruled on'} to="/staff/grading" go="Grade" />
            <Step done={contest.resultsPublished} text={contest.resultsPublished ? 'Results published' : 'Publish results'} to="/staff/results" go="Results" />
            <Step done={afterSteps[2]} text={afterSteps[2] ? 'Score reports sent' : 'Send score reports'} to="/staff/reports" go="Reports" />
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Today</h2><Link to="/staff/rounds" className="small">Edit rounds</Link></div>
        {contest.rounds.map((r) => <RoundLine key={r.id} round={r} now={now} tz={contest.timeZone} />)}
      </section>

      <div className="figures ov-figs">
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
            <Ring value={signed} total={comps.length} size={44} tone={signed === comps.length ? 'green' : 'amber'} label={`${signed} of ${comps.length} waivers signed`} />
          </div>
        </Link>
        {offers(contest, 'in_person') && (
          <Link to="/staff/people?tab=checkin" className="figure fig-link">
            <div className="top-label"><ModeChip mode="in_person">{here.length} teams</ModeChip></div>
            <b><Roll value={checkedIn} /></b><span>of {hereComps.length} checked in</span>
          </Link>
        )}
        {offers(contest, 'online') && (
          <Link to="/staff/live" className="figure fig-link">
            <div className="top-label"><ModeChip mode="online">{online.length} teams</ModeChip></div>
            {started ? <><b><Roll value={inTest} /></b><span>in a test right now</span></> : <><b><Roll value={devices} /></b><span>of {onlineComps.length} device checks done</span></>}
          </Link>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Ready for the day</h2>
          {allReady ? (
            <button type="button" className="linkbtn ov-link" aria-expanded={showReady} onClick={() => setShowReady((x) => !x)}>{showReady ? 'Hide checks' : `Show all ${ready.length} checks`}</button>
          ) : (
            <span className="label">{readyCount} of {ready.length}</span>
          )}
        </div>
        {allReady && !showReady ? (
          <p className="row ov-allready"><span className="ov-tick"><Icon name="check" size={13} /></span>All {ready.length} checks pass: teams, answer keys, waivers and rooms.</p>
        ) : (
          <ul className="checklist">
            {ready.slice().sort((a, b) => Number(a.ok) - Number(b.ok)).map((r) => (
              <li key={r.text} className={r.ok ? 'done' : ''}>
                <span className="box">{r.ok && <Icon name="check" size={13} />}</span>
                <span className="row" style={{ gap: 10 }}><b style={{ fontWeight: 500 }}>{r.text}</b>{r.mode && <ModeChip mode={r.mode} />}</span>
                {r.ok ? <span /> : <Link to={r.to} className="btn btn-sm">Fix</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Step({ done, text, to, go }: { done: boolean; text: string; to: string; go: string }) {
  return (
    <li className={done ? 'done' : ''}>
      <span className="box">{done && <Icon name="check" size={13} />}</span>
      <b style={{ fontWeight: 500 }}>{text}</b>
      {done ? <span /> : <Link to={to} className="btn btn-sm">{go}</Link>}
    </li>
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
    <div className={`round-line ${state === 'open' ? 'ov-open' : ''}`}>
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
              ? `${attempts.reduce((n, a) => n + (a.setsSubmitted ?? 0), 0)} sets in from ${attempts.filter((a) => (a.setsSubmitted ?? 0) > 0).length} teams${hasOnline && state === 'open' ? ` · ${online.filter((a) => !a.submittedAt && a.startedAt).length} online teams working` : ''}`
              : [hasOnline && (state === 'open' ? `${online.filter((a) => a.submittedAt).length} online handed in · ${online.filter((a) => !a.submittedAt && a.startedAt).length} working` : `${online.filter((a) => a.submittedAt).length} online handed in`), hasPaper && `${paper} paper sheets keyed`].filter(Boolean).join(' · ')}
        </div>
        {state === 'open' && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
      </div>
      {state === 'open' ? (
        <button className="btn btn-sm" type="button" onClick={() => navigate(round.kind === 'guts' ? '/board' : '/staff/live')}>{round.kind === 'guts' ? 'Scoreboard' : 'Watch'}</button>
      ) : round.kind === 'guts' && state === 'closed' ? (
        <button className="btn btn-sm btn-quiet" type="button" onClick={() => navigate('/board')}>Scoreboard</button>
      ) : (
        <span />
      )}
    </div>
  );
}
