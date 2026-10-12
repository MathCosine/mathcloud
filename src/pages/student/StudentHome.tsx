import { Link, Navigate, useNavigate } from 'react-router-dom';
import { openRound } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { State, toast, useNow } from '../../components/ui';
import { verifyCode } from '../staff/Certificates';

export function StudentHome() {
  const me = useStudent();
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const navigate = useNavigate();
  const now = useNow(1000);
  if (!me) return <Navigate to="/sign-in" replace />;
  const { competitor, team } = me;
  const division = contest.divisions.find((d) => d.id === team.divisionId)!;
  const online = division.mode === 'online';
  const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const mates = db.competitors.filter((c) => c.teamId === team.id);
  const entrant = (r: Round) => (r.kind === 'individual' ? competitor.id : team.id);
  const attempt = (r: Round) => db.attempts.find((a) => a.roundId === r.id && a.entrantId === entrant(r));
  const openRoundNow = contest.rounds.find((r) => roundState(r, now) === 'open');
  const next = contest.rounds.find((r) => roundState(r, now) === 'scheduled');
  const row = standings.individuals[division.id]?.find((r) => r.competitor.id === competitor.id);
  const teamRow = standings.teams[division.id]?.find((r) => r.team.id === team.id);
  const canStart = !!competitor.waiverSignedAt;

  const hero = () => {
    if (contest.resultsPublished) return null;
    if (openRoundNow) {
      const a = attempt(openRoundNow);
      const ends = roundEnds(openRoundNow)!;
      if (!online) {
        return (
          <div className="note blue" style={{ padding: '22px 24px' }}>
            <div className="strong" style={{ fontSize: 18 }}>{openRoundNow.name} is under way in the room</div>
            <p className="soft" style={{ marginTop: 4 }}>{duration(ends - now)} left. Write {competitor.publicId} on every sheet.</p>
          </div>
        );
      }
      return (
        <div className="note blue" style={{ padding: '22px 24px' }}>
          <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="strong" style={{ fontSize: 18 }}>{a?.submittedAt ? `${openRoundNow.name}: handed in` : `${openRoundNow.name} is open`}</div>
              <p className="soft" style={{ marginTop: 4 }}>{duration(ends - now)} left{room ? ` · stay on camera in ${room.name}` : ''}</p>
            </div>
            {!a?.submittedAt && (
              <button className="btn btn-primary btn-lg" type="button" disabled={!canStart} onClick={() => navigate(`/me/test/${openRoundNow.id}`)}>
                {a?.startedAt ? 'Back to the test' : `Start ${openRoundNow.name}`}
              </button>
            )}
          </div>
          {!canStart && <p className="wait small" style={{ marginTop: 10 }}>Your waiver needs signing before you can start.</p>}
        </div>
      );
    }
    if (next) {
      return (
        <div className="note" style={{ padding: '22px 24px' }}>
          <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="strong" style={{ fontSize: 18 }}>Next: {next.mystery ? 'the Mystery Dive' : next.name}</div>
              <p className="soft" style={{ marginTop: 4 }}>{clockIn(next.startsAt, contest.timeZone)}, the same moment as the room in San Francisco.</p>
            </div>
            <button className="btn" type="button" onClick={() => { openRound(next.id); toast(`${next.name} is open`, 'In the demo you can open a round yourself.'); }}>Open it now (demo)</button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <PortalLayout>
      <div className="stack-lg">
        <div>
          <h1 className="page-title">Hi {competitor.name.split(' ')[0]}</h1>
          <p className="page-sub"><span className="mono">{competitor.publicId}</span> · {team.name} · {division.name} division</p>
        </div>

        {!competitor.waiverSignedAt && (
          <div className="note amber row wrap" style={{ justifyContent: 'space-between' }}>
            <span>Your waiver is not signed yet. We emailed {competitor.guardianName}.</span>
            <Link to={`/waiver/${competitor.id}`} className="btn btn-sm">Open the waiver link</Link>
          </div>
        )}

        {hero()}

        {contest.resultsPublished && row && (
          <section className="section">
            <div className="section-head"><h2>Your results</h2></div>
            <div className="row wrap" style={{ gap: 40, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em' }}>{row.score}<span className="muted" style={{ fontSize: 20 }}> / {row.max}</span></div>
                <p className="soft" style={{ marginTop: 8 }}>{ordinal(row.place)} of {standings.individuals[division.id].length} in the {division.name.toLowerCase()} division{row.tied ? ', tied' : ''}.</p>
                {row.award && <p className="strong" style={{ color: 'var(--blue)', marginTop: 2 }}>{row.award}</p>}
              </div>
              <div className="grow stack" style={{ gap: 10 }}>
                <div className="marks">{row.results.map((x) => <span key={x.problemId} className={`mark ${x.status}`} title={`Problem ${x.number}: ${x.status}`}>{x.number}</span>)}</div>
                {teamRow && <p className="soft small">{team.name}: {ordinal(teamRow.place)} of {standings.teams[division.id].length} teams, {teamRow.total} points.</p>}
                <div><button className="btn btn-sm" type="button" onClick={() => toast('Certificate', `${row.award ?? 'Participation'}. Check code ${verifyCode(contest.slug, competitor.publicId)}.`)}>Certificate</button></div>
              </div>
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head"><h2>Today</h2><span className="label">{contest.dateLabel}</span></div>
          {contest.rounds.map((r) => {
            const s = roundState(r, now);
            const a = attempt(r);
            return (
              <div key={r.id} className="round-line">
                <time>{clockIn(r.startsAt, contest.timeZone).replace(' PT', '')}</time>
                <div>
                  <b>{r.mystery && s === 'scheduled' ? 'Mystery Dive' : r.name}</b>
                  <div className="muted small">{r.mystery && s === 'scheduled' ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'On your own' : 'With your team'}, ${r.minutes} minutes`}</div>
                </div>
                {online && a?.submittedAt ? <State tone="ok">Handed in</State> : s === 'open' ? <State tone="go">Open</State> : s === 'closed' ? <State tone="off">Finished</State> : <State tone="off">Later</State>}
              </div>
            );
          })}
        </section>

        <div className="split-wide">
          <section className="section">
            <div className="section-head"><h2>Your team</h2></div>
            {mates.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                <span><span className="mono muted">{c.publicId}</span>&nbsp; {c.name}</span>
                {c.waiverSignedAt ? <span className="muted small">Waiver signed</span> : <span className="wait small">Waiver missing</span>}
              </div>
            ))}
          </section>
          {online && room ? (
            <section className="section">
              <div className="section-head"><h2>Zoom</h2></div>
              <p>{room.name} · proctor {db.users.find((u) => u.id === room.proctorId)?.name}</p>
              <p className="muted small" style={{ margin: '4px 0 12px' }}>Join 20 minutes before each round. Camera on, showing you and your desk.</p>
              <button className="btn" type="button" onClick={() => toast('Opens Zoom', 'The demo meeting link is not real.')}>Join {room.name}</button>
            </section>
          ) : (
            <section className="section">
              <div className="section-head"><h2>Check-in</h2></div>
              <div className="mono" style={{ fontSize: 36, fontWeight: 600 }}>{competitor.publicId}</div>
              <p className="muted small">{competitor.checkedInAt ? `Checked in at ${clock(competitor.checkedInAt)}.` : 'Show this at the desk.'} Write it on every answer sheet.</p>
            </section>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
