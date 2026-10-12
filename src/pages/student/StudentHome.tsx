import { Link, Navigate } from 'react-router-dom';
import { openRound } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { Round } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, clockIn, duration, roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Status, Tick, toast, useNow } from '../../components/ui';
import { verifyCode } from '../staff/Certificates';

export function StudentHome() {
  const me = useStudent();
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const now = useNow(1000);
  if (!me) return <Navigate to="/sign-in" replace />;
  const { competitor, team } = me;
  const division = contest.divisions.find((d) => d.id === team.divisionId)!;
  const online = division.mode === 'online';
  const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const teammates = db.competitors.filter((c) => c.teamId === team.id);
  const myRow = standings.individuals[division.id]?.find((r) => r.competitor.id === competitor.id);
  const teamRow = standings.teams[division.id]?.find((r) => r.team.id === team.id);
  const dist = (standings.individuals[division.id] ?? []).map((r) => r.score);
  const max = myRow?.max ?? 20;

  return (
    <PortalLayout>
      <div className="eyebrow">{contest.short} · {division.name} division</div>
      <div className="page-head" style={{ marginTop: 4 }}>
        <div>
          <h1>Hi {competitor.name.split(' ')[0]}</h1>
          <div className="meta">
            <span>You are <b className="mono">{competitor.publicId}</b> on {team.name}</span>
            <span className="dot-sep" />
            <span>{contest.dateLabel}</span>
          </div>
        </div>
      </div>

      {!competitor.waiverSignedAt && (
        <div className="callout amber" style={{ marginBottom: 16 }}>
          <span style={{ flex: 1 }}><b>Your waiver is not signed yet.</b> We emailed {competitor.guardianName} a link. You cannot start a test until it is signed.</span>
          <Link className="btn btn-sm" to={`/waiver/${competitor.id}`}>Open the guardian’s link</Link>
        </div>
      )}

      {contest.resultsPublished && myRow && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head"><h3>Your results</h3><span className="tag green">Published</span></div>
          <div className="panel-body grid-2" style={{ alignItems: 'center' }}>
            <div>
              <div className="score-big">{myRow.score}<span className="sub" style={{ fontSize: 20 }}> / {myRow.max}</span></div>
              <p className="sub2" style={{ marginTop: 6 }}>
                {ordinal(myRow.place)} of {dist.length} in the {division.name.toLowerCase()} division{myRow.tied ? `, tied with ${myRow.tied} other${myRow.tied > 1 ? 's' : ''}` : ''}.
                {myRow.award && <> You earned <b>{myRow.award}</b>.</>}
              </p>
              {teamRow && <p className="sub" style={{ marginTop: 4 }}>{team.name}: {ordinal(teamRow.place)} of {standings.teams[division.id].length} teams, {teamRow.total} points.</p>}
              <div className="marks" style={{ marginTop: 12 }}>
                {myRow.results.map((r) => <span key={r.problemId} className={`mark ${r.status}`} title={`Problem ${r.number}: ${r.status}`}>{r.number}</span>)}
              </div>
            </div>
            <div>
              <div className="mini-bars" style={{ height: 70 }}>
                {Array.from({ length: max + 1 }, (_, s) => {
                  const n = dist.filter((x) => x === s).length;
                  const top = Math.max(...Array.from({ length: max + 1 }, (_, k) => dist.filter((x) => x === k).length), 1);
                  return <i key={s} className={s === myRow.score ? 'me' : ''} style={{ height: `${(n / top) * 100}%` }} title={`${n} scored ${s}`} />;
                })}
              </div>
              <p className="sub" style={{ fontSize: 12, marginTop: 4 }}>How the division scored. Your column is dark.</p>
              <button className="btn btn-sm" style={{ marginTop: 10 }} type="button" onClick={() => toast('Certificate', `${competitor.name}, ${myRow.award ?? 'Participation'}. Verification code ${verifyCode(contest.slug, competitor.publicId)}.`)}>Download certificate</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid-main-side">
        <div className="panel">
          <div className="panel-head"><h3>Your rounds</h3><span className="sub" style={{ fontSize: 12.5 }}>{online ? 'All online, at the same moment as the room in San Francisco' : 'On paper, at the venue'}</span></div>
          {contest.rounds.map((r) => <RoundRow key={r.id} round={r} now={now} online={online} entrantId={r.kind === 'individual' ? competitor.id : team.id} canStart={!!competitor.waiverSignedAt} tz={contest.timeZone} />)}
        </div>

        <div className="stack">
          {online && room && (
            <div className="side-card">
              <h3>Your Zoom room</h3>
              <p style={{ fontSize: 13 }}>{room.name} · proctor {db.users.find((u) => u.id === room.proctorId)?.name}</p>
              <p className="sub" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>Join 20 minutes before the first round. Camera on, showing you and your desk. Keep Zoom on a phone or second device; the test stays in this browser.</p>
              <button className="btn btn-primary" type="button" onClick={() => toast('Opens Zoom', 'In the demo the meeting link is not real.')}>Join Zoom</button>
            </div>
          )}
          {!online && (
            <div className="side-card" style={{ textAlign: 'center' }}>
              <h3>Check-in</h3>
              <div className="mono" style={{ fontSize: 40, fontWeight: 500, letterSpacing: '.04em', margin: '6px 0' }}>{competitor.publicId}</div>
              <p className="sub" style={{ fontSize: 12.5 }}>Show this at the desk, or the code in your confirmation email. Write {competitor.publicId} on every answer sheet.</p>
              {competitor.checkedInAt && <p className="ok-text row" style={{ justifyContent: 'center', marginTop: 6 }}><Tick /> Checked in at {clock(competitor.checkedInAt)}</p>}
            </div>
          )}
          <div className="side-card">
            <h3>Your team</h3>
            {teammates.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                <span><span className="mono sub">{c.publicId}</span> {c.name}</span>
                {c.waiverSignedAt ? <span className="ok-text"><Tick /></span> : <span className="warn-text" style={{ fontSize: 12 }}>waiver missing</span>}
              </div>
            ))}
          </div>
          {online && (
            <div className="side-card">
              <h3>Before Saturday</h3>
              <p className="sub" style={{ fontSize: 12.5 }}>Use a laptop or desktop with Chrome, Edge, Firefox or Safari. The test asks for fullscreen and notes when you leave it, so close other tabs first.</p>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

function RoundRow({ round, now, online, entrantId, canStart, tz }: { round: Round; now: number; online: boolean; entrantId: string; canStart: boolean; tz: string }) {
  const db = useDB();
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const a = db.attempts.find((x) => x.roundId === round.id && x.entrantId === entrantId);
  const label = round.mystery && state === 'scheduled' ? 'Format revealed when it starts' : `${round.kind === 'individual' ? 'On your own' : 'With your team'} · ${round.minutes} min · ${round.problems.length} problems`;
  return (
    <div className="round-card">
      <div>
        <b>{round.name}</b>
        <div className="sub" style={{ fontSize: 12.5 }}>{label}</div>
      </div>
      <div className="row">
        {!online ? (
          state === 'closed' ? <Status tone="green">Done</Status> : <Status tone="grey">{clockIn(round.startsAt, tz)} at the venue</Status>
        ) : a?.submittedAt ? (
          <Status tone="green">Handed in</Status>
        ) : state === 'open' ? (
          <>
            <span className="mono sub" style={{ fontSize: 12.5 }}>{ends ? `${duration(ends - now)} left` : ''}</span>
            <Link className={`btn ${canStart ? 'btn-primary' : ''}`} to={canStart ? `/me/test/${round.id}` : '#'} aria-disabled={!canStart} onClick={(e) => !canStart && e.preventDefault()}>{a?.startedAt ? 'Resume' : 'Start'}</Link>
          </>
        ) : state === 'closed' ? (
          <>
            <Status tone="grey">Closed</Status>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => openRound(round.id)} title="Demo only">Reopen (demo)</button>
          </>
        ) : (
          <>
            <Status tone="grey">Opens {clockIn(round.startsAt, tz)}</Status>
            <button className="btn btn-sm" type="button" onClick={() => { openRound(round.id); toast(`${round.name} is open`, 'In the real contest the director opens it at the scheduled time.'); }} title="Demo only">Open now (demo)</button>
          </>
        )}
      </div>
    </div>
  );
}
