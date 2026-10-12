import { Link } from 'react-router-dom';
import { useContest, useStandings } from '../../lib/hooks';
import { useDB } from '../../lib/store';
import { clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { Roll, Status, Tick, useNow } from '../../components/ui';
import type { Round } from '../../lib/model';

export function Overview() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const now = useNow(1000);

  const liveTeams = db.teams.filter((t) => t.status !== 'withdrawn');
  const comps = db.competitors.filter((c) => liveTeams.some((t) => t.id === c.teamId));
  const signed = comps.filter((c) => c.waiverSignedAt).length;
  const online = liveTeams.filter((t) => t.divisionId === 'online');
  const inPerson = liveTeams.filter((t) => t.divisionId === 'in_person');
  const inTest = db.attempts.filter((a) => a.source === 'online' && a.startedAt && !a.submittedAt).length;
  const unanswered = db.clarifications.filter((c) => !c.answer);
  const locked = db.attempts.filter((a) => a.locked && !a.submittedAt);
  const unreviewed = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);
  const roomless = online.filter((t) => !contest.rooms.some((r) => r.teamIds.includes(t.id)));
  const keyGaps = contest.rounds.flatMap((r) => r.problems.filter((p) => !p.answers.length || !p.answers[0].trim()));

  const checks: { ok: boolean; text: string; to: string; detail?: string }[] = [
    { ok: keyGaps.length === 0, text: 'Every answer key is filled in', to: '/staff/rounds', detail: keyGaps.length ? `${keyGaps.length} empty` : `${contest.rounds.reduce((n, r) => n + r.problems.length, 0)} answers` },
    { ok: signed === comps.length, text: 'Every competitor has a signed waiver', to: '/staff/roster', detail: signed === comps.length ? 'all signed' : `${comps.length - signed} missing` },
    { ok: roomless.length === 0, text: 'Every online team has a Zoom room', to: '/staff/proctoring', detail: `${contest.rooms.length} rooms, ${online.length} teams` },
    { ok: contest.rooms.every((r) => r.proctorId), text: 'Every Zoom room has a proctor', to: '/staff/people' },
    { ok: db.users.some((u) => u.role === 'grader'), text: 'Graders have accounts', to: '/staff/people', detail: `${db.users.filter((u) => u.role === 'grader').length} grader` },
    { ok: db.orgs[0].emailProvider.kind !== 'none', text: 'Email is connected', to: '/staff/emails', detail: 'Resend · 100 a day' },
  ];

  return (
    <>
      <div className="crumbs">{db.orgs[0].name}</div>
      <div className="page-head">
        <div>
          <h1>{contest.short}</h1>
          <div className="meta">
            <span>{contest.dateLabel}</span>
            <span className="dot-sep" />
            <span>In person in San Francisco, and online on Zoom at the same time</span>
          </div>
        </div>
        <div className="actions">
          <Link className="btn" to="/staff/roster">Roster</Link>
          <Link className="btn btn-primary" to="/staff/proctoring">Open proctoring</Link>
        </div>
      </div>

      <section className="stats panel" style={{ ['--n' as string]: 4 }}>
        <div className="stat">
          <div className="stat-label">Teams</div>
          <div className="stat-value"><Roll value={liveTeams.length} /></div>
          <div className="stat-sub">{inPerson.length} in person · {online.length} online</div>
        </div>
        <div className="stat">
          <div className="stat-label">Competitors</div>
          <div className="stat-value"><Roll value={comps.length} /></div>
          <div className="stat-sub">{comps.filter((c) => c.checkedInAt).length} checked in at the venue</div>
        </div>
        <div className="stat">
          <div className="stat-label">Waivers signed</div>
          <div className="stat-value"><Roll value={signed} /><span className="of">/ {comps.length}</span></div>
          <div className="bar"><i style={{ width: `${(signed / comps.length) * 100}%` }} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">Online, in a test now</div>
          <div className="stat-value"><Roll value={inTest} /></div>
          <div className="stat-sub">{locked.length ? <span className="warn-text">{locked.length} locked, waiting for a proctor</span> : 'none locked'}</div>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <div className="panel-head"><h3>Rounds today</h3><Link to="/staff/rounds" className="sub" style={{ fontSize: 12.5 }}>Edit rounds →</Link></div>
          {contest.rounds.map((r) => (
            <RoundLine key={r.id} round={r} now={now} tz={contest.timeZone} />
          ))}
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Ready for the day</h3><span className="sub" style={{ fontSize: 12.5 }}>{checks.filter((c) => c.ok).length} of {checks.length}</span></div>
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.text}>
                <span className={`tick ${c.ok ? 'ok' : ''}`}>{c.ok && <Tick />}</span>
                <Link to={c.to} style={{ color: 'inherit' }}>{c.text}</Link>
                <span className={c.ok ? 'sub' : 'warn-text'} style={{ fontSize: 12.5 }}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="section-title"><h2>Needs you</h2></div>
      <div className="panel">
        <ul className="checklist">
          <Attention n={unanswered.length} to="/staff/proctoring" text={unanswered.length === 1 ? 'question from a competitor is waiting for an answer' : 'questions from competitors are waiting for an answer'} />
          <Attention n={locked.length} to="/staff/proctoring" text={locked.length === 1 ? 'online test is locked until a proctor unlocks it' : 'online tests are locked until a proctor unlocks them'} />
          <Attention n={unreviewed} to="/staff/grading" text="answers in an unusual form need a ruling" />
          <Attention n={comps.length - signed} to="/staff/roster" text="competitors have no signed waiver" />
          {!unanswered.length && !locked.length && !unreviewed && signed === comps.length && (
            <li><span className="tick ok"><Tick /></span><span>Nothing is waiting on you.</span><span /></li>
          )}
        </ul>
      </div>
    </>
  );
}

function Attention({ n, text, to }: { n: number; text: string; to: string }) {
  if (!n) return null;
  return (
    <li>
      <span className="tick" style={{ borderColor: 'var(--amber)' }} />
      <span><b className="mono">{n}</b> {text}</span>
      <Link to={to} className="btn btn-sm">Open</Link>
    </li>
  );
}

function RoundLine({ round, now, tz }: { round: Round; now: number; tz: string }) {
  const db = useDB();
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const attempts = db.attempts.filter((a) => a.roundId === round.id);
  const online = attempts.filter((a) => a.source === 'online');
  const paper = attempts.filter((a) => a.source === 'paper');
  return (
    <div className="round-card">
      <div>
        <div className="row">
          <b>{round.name}</b>
          <span className="sub" style={{ fontSize: 12.5 }}>{round.kind === 'individual' ? 'individual' : round.kind === 'guts' ? 'team, guts' : 'team'} · {round.minutes} min · {round.problems.length} problems</span>
        </div>
        <div className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>
          {online.filter((a) => a.submittedAt).length} online handed in, {online.filter((a) => !a.submittedAt).length} in progress · {paper.length} paper sheets keyed
        </div>
      </div>
      <div>
        {state === 'open' && ends ? (
          <Status tone="blue">Open · {duration(ends - now)} left</Status>
        ) : state === 'closed' ? (
          <Status tone="green">Finished</Status>
        ) : (
          <Status tone="grey">Starts {clockIn(round.startsAt, tz)}</Status>
        )}
      </div>
    </div>
  );
}
