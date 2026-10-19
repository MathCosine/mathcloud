import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { markDeviceCheck, modeOf, openRound } from '../../lib/actions';
import { useBoard, useContest } from '../../lib/hooks';
import type { AgendaItem, Competitor, DivisionMode, Round, Team } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { REMOTE, useDB } from '../../lib/store';
import { duration, roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Icon } from '../../components/icons';
import { ScoreList } from '../../components/Scoreboard';
import { ModeChip, Modal, State, toast, useNow } from '../../components/ui';
import { verifyCode } from '../staff/Certificates';
import { dayIn, hm, Timeline, until, type TimelineItem } from './parts';
import { fieldScores, ScoreReport, usePublished } from './report';
import '../../styles/portal.css';

/**
 * A student's page. In person and online are two different days, so they
 * get two different pages: one is a pass and a map of the building, the
 * other a checklist, a Zoom room and a start button, in the student's own
 * time zone. Both start the same way: who you are, and the next thing to do.
 */
export function StudentHome() {
  const me = useStudent();
  const contest = useContest() as ReturnType<typeof useContest> | undefined;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!contest) return <NoContest />;
  const mode = modeOf(contest, me.team);
  return (
    <PortalLayout mode={mode}>
      <div className="pt stack-lg">
        <Identity competitor={me.competitor} team={me.team} mode={mode} />
        {mode === 'online' ? <OnlineHome competitor={me.competitor} team={me.team} /> : <InPersonHome competitor={me.competitor} team={me.team} />}
      </div>
    </PortalLayout>
  );
}

// ------------------------------------------------------------------ shared

/** Connected, before this person's contest has loaded (or if it has gone). */
function NoContest() {
  return (
    <PortalLayout>
      <div className="pt stack-lg">
        <section className="section pt-empty">
          <div>
            <h2>Your contest is not here yet</h2>
            <p className="soft">It may still be loading, or the organisers have not opened it yet. Try again in a moment.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => location.reload()}>Try again</button>
        </section>
      </div>
    </PortalLayout>
  );
}

function zoneLabel(tz: string, at: string) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  return part.replace(' Standard', '').replace(' Daylight', '');
}
const ymd = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));

/** Where each line of the day stands right now: done, happening, or to come. */
function agendaState(rounds: Round[], now: number) {
  const started = (r: Round) => roundState(r, now) !== 'scheduled';
  const lastStarted = [...rounds].filter(started).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  return (item: AgendaItem): 'past' | 'now' | 'next' => {
    const r = item.roundId ? rounds.find((x) => x.id === item.roundId) : undefined;
    if (r) return roundState(r, now) === 'open' ? 'now' : roundState(r, now) === 'closed' ? 'past' : 'next';
    return lastStarted && item.at < lastStarted.startsAt ? 'past' : 'next';
  };
}

function Identity({ competitor, team, mode }: { competitor: Competitor; team: Team; mode: DivisionMode }) {
  const contest = useContest();
  return (
    <div className="pt-who">
      <div className={`pt-who-id ${mode}`} aria-label="Competitor ID">
        <span>ID</span>
        <b>{competitor.publicId}</b>
      </div>
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{competitor.name}</h1>
        <p className="page-sub row wrap" style={{ gap: '4px 10px' }}>
          <span>Team {team.code}, {team.name}</span>
          <ModeChip mode={mode} />
          <span className="muted">{contest.short} · {contest.dateLabel}</span>
        </p>
      </div>
    </div>
  );
}

/** The waiver as the one thing to do: the guardian has the link, the student can nudge them. */
function WaiverHero({ competitor, mode }: { competitor: Competitor; mode: DivisionMode }) {
  return (
    <div className={`pt-hero todo ${mode}`}>
      <div className="pt-hero-main">
        <span className="pt-hero-kicker"><State tone="wait">To do first</State></span>
        <h2>Your waiver is not signed yet</h2>
        <p>We emailed {competitor.guardianName || 'your guardian'}{competitor.guardianEmail ? ` at ${competitor.guardianEmail}` : ''}. Ask them to open that email and sign. You cannot compete without it.</p>
      </div>
      {!REMOTE && <div className="pt-hero-side"><Link to={`/waiver/${competitor.id}`} className="btn btn-primary btn-lg">Open the waiver<Icon name="arrow" /></Link></div>}
    </div>
  );
}

function Results({ competitor, team }: { competitor: Competitor; team: Team }) {
  const contest = useContest();
  const results = usePublished();
  const mine = results.find((r) => r.competitorId === competitor.id);
  const teamRes = results.find((r) => r.teamId === team.id);
  if (!contest.resultsPublished || !mine) return null;
  return (
    <section className="section reveal" id="results">
      <div className="section-head">
        <h2>Your results</h2>
        <button className="btn btn-sm" type="button" onClick={() => toast('Certificate', `${mine.data.award ?? 'Participation'}. Check code ${verifyCode(contest.slug, competitor.publicId)}.`)}><Icon name="certificate" />Certificate</button>
      </div>
      <ScoreReport me={mine.data} team={teamRes?.data} field={fieldScores(results, mine.data.division)} />
    </section>
  );
}

function TeamCard({ team, inPerson, className }: { team: Team; inPerson: boolean; className?: string }) {
  const db = useDB();
  const mates = db.competitors.filter((c) => c.teamId === team.id).sort((a, b) => a.slot.localeCompare(b.slot));
  return (
    <section className={`section ${className ?? ''}`}>
      <div className="section-head"><h2>Your team</h2><span className="label">Team {team.code}</span></div>
      <ul className="pt-mates">
        {mates.map((c) => (
          <li key={c.id}>
            <span className="mono muted">{c.publicId}</span>
            <span className="pt-mate-name">{c.name}</span>
            {!c.waiverSignedAt ? <State tone="wait">Waiver</State>
              : inPerson ? (c.checkedInAt ? <State tone="ok">Here</State> : <State tone="off">Not here yet</State>)
              : c.deviceCheckedAt ? <State tone="ok">Ready</State> : <State tone="off">Device check</State>}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Step = { done: boolean; title: string; sub: ReactNode; action?: ReactNode };
function Ready({ title, steps, className }: { title: string; steps: Step[]; className?: string }) {
  return (
    <section className={`section ${className ?? ''}`}>
      <div className="section-head"><h2>{title}</h2><span className="label">{steps.filter((s) => s.done).length} of {steps.length} done</span></div>
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <span className="box">{s.done && <Icon name="check" size={13} />}</span>
            <span><b>{s.title}</b><small>{s.sub}</small></span>
            {s.action || <span />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Answers from the proctors: to everyone, and to this student's own questions. */
function Announcements({ competitorId, tz, now, className }: { competitorId: string; tz: string; now: number; className?: string }) {
  const db = useDB();
  const contest = useContest();
  const started = (roundId?: string | null) => {
    const r = roundId ? contest.rounds.find((x) => x.id === roundId) : undefined;
    return !r || roundState(r, now) !== 'scheduled';
  };
  const items = db.clarifications
    .filter((c) => ((c.broadcast && c.answer) || c.fromCompetitorId === competitorId) && started(c.roundId))
    .sort((a, b) => (b.answeredAt ?? b.at).localeCompare(a.answeredAt ?? a.at))
    .slice(0, 6);
  if (!items.length) return null;
  return (
    <section className={`section ${className ?? ''}`}>
      <div className="section-head"><h2>Announcements</h2><span className="label">{items.length}</span></div>
      <ul className="pt-news">
        {items.map((c) => (
          <li key={c.id}>
            <small>{contest.rounds.find((r) => r.id === c.roundId)?.name ?? 'Contest'} · {hm(c.answeredAt ?? c.at, tz)} · {c.broadcast ? 'to everyone' : 'your question'}</small>
            {c.question && <div className="soft">{c.question}</div>}
            {c.answer ? <div>{c.answer}</div> : <div className="muted">Waiting for a proctor</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Guts standings while the round runs. Connected, a student's board comes from the server every 15 seconds. */
function GutsNow({ team, now, className }: { team: Team; now: number; className?: string }) {
  const contest = useContest();
  const board = useBoard(team.divisionId, now);
  if (!board || roundState(board.round, now) !== 'open') return null;
  return (
    <section className={`section ${className ?? ''}`}>
      <div className="section-head"><h2>Guts scoreboard</h2><span className="label">{board.frozen ? 'Frozen' : 'Live'} · {contest.divisions.find((d) => d.id === team.divisionId)?.name}</span></div>
      <ScoreList board={board} mine={team.id} limit={5} />
    </section>
  );
}

function DemoOpen({ round }: { round: Round }) {
  if (REMOTE) return null;
  return (
    <button className="btn btn-sm btn-quiet pt-demo" type="button" title="Sandbox only" onClick={() => { openRound(round.id); toast(`${round.name} is open`, 'In the sandbox you can open a round yourself.'); }}>
      Sandbox: open {round.mystery ? "the next round" : round.name} now
    </button>
  );
}

// --------------------------------------------------------------- in person

function InPersonHome({ competitor, team }: { competitor: Competitor; team: Team }) {
  const contest = useContest();
  const now = useNow(1000);
  const venue = contest.venue;
  const tz = contest.timeZone;
  const at = (iso: string) => hm(iso, tz);
  const room = venue?.rooms.find((r) => r.teamIds.includes(team.id));
  const where = (w?: string) => (w === 'room' ? room?.name ?? 'Your room' : w === 'hall' ? venue?.hall ?? 'The hall' : w);
  const items = contest.agenda.filter((a) => a.modes.includes('in_person')).sort((a, b) => a.at.localeCompare(b.at));
  const state = agendaState(contest.rounds, now);
  const open = contest.rounds.find((r) => roundState(r, now) === 'open');
  const next = contest.rounds.find((r) => roundState(r, now) === 'scheduled');
  const started = contest.rounds.some((r) => roundState(r, now) !== 'scheduled');
  const checkIn = items.find((a) => /check/i.test(a.title));
  const awards = items.find((a) => /award/i.test(a.title));

  const hero = () => {
    if (contest.resultsPublished) return null;
    if (open) {
      const item = items.find((a) => a.roundId === open.id);
      const ends = roundEnds(open)!;
      return (
        <div className="pt-hero now in_person">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker"><State tone="go">Now</State></span>
            <h2>{open.name} in {where(item?.where)}</h2>
            <p>{open.kind === 'guts' ? 'The scoreboard is on the big screen.' : `Write ${open.kind === 'individual' ? competitor.publicId : team.code} on every sheet.`}</p>
          </div>
          <div className="pt-hero-clock"><span className="label">Time left</span><b className="mono">{duration(ends - now)}</b></div>
        </div>
      );
    }
    if (!competitor.waiverSignedAt) return <WaiverHero competitor={competitor} mode="in_person" />;
    if (!started && !competitor.checkedInAt) {
      return (
        <div className="pt-hero in_person">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker label">First thing on {checkIn ? dayIn(checkIn.at, tz) : contest.dateLabel}</span>
            <h2>Check in{checkIn ? ` from ${at(checkIn.at)}` : ''}{checkIn?.where ? ` at the ${checkIn.where.toLowerCase()}` : ''}</h2>
            <p><Icon name="pin" size={13} /> {venue?.name}, {venue?.address}. Give your ID, <b className="mono">{competitor.publicId}</b>, at the desk.</p>
          </div>
          {checkIn && <div className="pt-hero-clock"><span className="label">Check-in opens</span><b>{until(new Date(checkIn.at).getTime() - now)}</b></div>}
        </div>
      );
    }
    if (next) {
      const item = items.find((a) => a.roundId === next.id);
      const name = next.mystery ? 'the Mystery Dive' : next.name;
      return (
        <div className="pt-hero in_person">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker label">Next</span>
            <h2>{name[0].toUpperCase() + name.slice(1)} at {at(next.startsAt)}, {where(item?.where)}</h2>
            <p>Be in your seat five minutes before.</p>
          </div>
          <div className="pt-hero-clock"><span className="label">Starts</span><b>{until(new Date(next.startsAt).getTime() - now)}</b><DemoOpen round={next} /></div>
        </div>
      );
    }
    return (
      <div className="pt-hero in_person">
        <div className="pt-hero-main">
          <span className="pt-hero-kicker label">All rounds done</span>
          <h2>Awards{awards ? ` at ${at(awards.at)} in ${where(awards.where)}` : ''}</h2>
          <p>Your results appear here once the organisers publish them.</p>
        </div>
      </div>
    );
  };

  const timeline: TimelineItem[] = items.map((a) => {
    const s = state(a);
    const r = a.roundId ? contest.rounds.find((x) => x.id === a.roundId) : undefined;
    return {
      id: a.id,
      state: s,
      time: at(a.at),
      title: r?.mystery && s === 'next' ? 'Mystery Dive' : a.title,
      detail: (
        <>
          {a.where && <span className="pt-where"><Icon name="pin" size={12} />{where(a.where)}</span>}
          {r ? <span>{r.mystery && s === 'next' ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'On your own' : 'With your team'}, ${r.minutes} minutes, on paper`}</span> : a.note && <span>{a.note}</span>}
        </>
      ),
      side: s === 'now' ? <State tone="go">Now</State> : null,
    };
  });

  return (
    <>
      {hero()}
      <Results competitor={competitor} team={team} />
      <div className="split pt-split">
        <div className="stack-lg pt-col">
          <GutsNow team={team} now={now} className="pt-o1" />
          <section className="section pt-o4">
            <div className="section-head"><h2>Your day</h2><span className="label">{contest.dateLabel} · {venue?.name}</span></div>
            <Timeline items={timeline} />
          </section>
        </div>
        <div className="stack-lg pt-col">
          <div className="pass pt-o2">
            <div style={{ minWidth: 0 }}>
              <span className="label">Competitor ID</span>
              <div className="pass-id">{competitor.publicId}</div>
              <dl>
                <dt>Team</dt><dd>{team.code} · {team.name}</dd>
                <dt>Room</dt><dd>{room ? `${room.name}` : 'Given at check-in'}</dd>
                <dt>Waiver</dt><dd>{competitor.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone="wait">Not signed</State>}</dd>
              </dl>
            </div>
            <span className={`stamp ${competitor.checkedInAt ? 'in' : ''}`}>
              {competitor.checkedInAt ? <><Icon name="check" size={13} />In, {at(competitor.checkedInAt)}</> : 'Not checked in'}
            </span>
          </div>
          <Announcements competitorId={competitor.id} tz={tz} now={now} className="pt-o1" />
          {venue && venue.bring.filter(Boolean).length > 0 && !contest.resultsPublished && (
            <section className="section pt-o5">
              <div className="section-head"><h2>Bring</h2></div>
              <ul className="bring">{venue.bring.filter(Boolean).map((b) => <li key={b}>{b}</li>)}</ul>
            </section>
          )}
          <TeamCard team={team} inPerson className="pt-o5" />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ online

function OnlineHome({ competitor, team }: { competitor: Competitor; team: Team }) {
  const contest = useContest();
  const db = useDB();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [checking, setChecking] = useState(false);
  const tz = team.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
  const proctor = db.users.find((u) => u.id === room?.proctorId);
  const items = contest.agenda.filter((a) => a.modes.includes('online')).sort((a, b) => a.at.localeCompare(b.at));
  const state = agendaState(contest.rounds, now);
  const entrant = (r: Round) => (r.kind === 'individual' ? competitor.id : team.id);
  const attempt = (r: Round) => db.attempts.find((a) => a.roundId === r.id && a.entrantId === entrant(r));
  const open = contest.rounds.find((r) => roundState(r, now) === 'open');
  const next = contest.rounds.find((r) => roundState(r, now) === 'scheduled');
  const contestDay = ymd(contest.rounds[0]?.startsAt ?? new Date().toISOString(), contest.timeZone);
  const sameZone = tz === contest.timeZone;
  const canStart = !!competitor.waiverSignedAt;
  const home = contest.timeZone === 'America/Los_Angeles' ? 'San Francisco' : contest.timeZone.split('/').pop()!.replace(/_/g, ' ');
  const zoomItem = items.find((a) => /zoom/i.test(a.title));

  const started = contest.rounds.some((r) => roundState(r, now) !== 'scheduled');
  const zoomLink = room && <a className="btn btn-sm" href={room.url} target="_blank" rel="noreferrer"><Icon name="video" />Join Zoom</a>;

  const hero = () => {
    if (contest.resultsPublished) return null;
    if (open) {
      const a = attempt(open);
      const ends = roundEnds(open)!;
      return (
        <div className="pt-hero now online">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker">{a?.submittedAt ? <State tone="ok">Handed in</State> : <State tone="go">Open now</State>}</span>
            <h2>{a?.submittedAt ? `${open.name}: handed in. Well done.` : a?.startedAt ? `${open.name}: you have started` : `${open.name} is open`}</h2>
            <p>{open.kind === 'individual' ? 'On your own' : 'With your team'}, {open.minutes} minutes{room ? `. Stay on camera in Zoom ${room.name}.` : '.'}</p>
            {!canStart && !a?.submittedAt && <p className="wait small">Your waiver needs signing before you can start.</p>}
          </div>
          <div className="pt-hero-side">
            <div className="pt-hero-clock"><span className="label">Time left</span><b className="mono">{duration(ends - now)}</b></div>
            {!a?.submittedAt && (
              <button className="btn btn-primary btn-lg pt-start" type="button" disabled={!canStart} onClick={() => navigate(`/me/test/${open.id}`)}>
                {a?.startedAt ? 'Back to the test' : `Start ${open.name}`}<Icon name="arrow" />
              </button>
            )}
          </div>
        </div>
      );
    }
    if (!competitor.waiverSignedAt) return <WaiverHero competitor={competitor} mode="online" />;
    if (next && !competitor.deviceCheckedAt) {
      return (
        <div className="pt-hero todo online">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker"><State tone="wait">To do before the day</State></span>
            <h2>Run the device check</h2>
            <p>Two minutes, on the computer you will use. {next.mystery ? 'The first round' : next.name} opens {dayIn(next.startsAt, tz)} at {hm(next.startsAt, tz)}{sameZone ? '' : ' your time'}.</p>
          </div>
          <div className="pt-hero-side">
            <button className="btn btn-primary btn-lg pt-start" type="button" onClick={() => setChecking(true)}>Run the device check<Icon name="arrow" /></button>
            <DemoOpen round={next} />
          </div>
        </div>
      );
    }
    if (next) {
      const name = next.mystery ? 'the Mystery Dive' : next.name;
      return (
        <div className="pt-hero online">
          <div className="pt-hero-main">
            <span className="pt-hero-kicker label">Next · {dayIn(next.startsAt, tz)}</span>
            <h2>{name[0].toUpperCase() + name.slice(1)} at {hm(next.startsAt, tz)}{sameZone ? '' : ' your time'}</h2>
            <p>
              {sameZone ? `Join Zoom${zoomItem ? ` at ${hm(zoomItem.at, tz)}` : ' 20 minutes before'}. The start button appears here when it opens.` : `${hm(next.startsAt, contest.timeZone)} in ${home}: everyone starts at the same moment. The start button appears here when it opens.`}
            </p>
          </div>
          <div className="pt-hero-clock"><span className="label">Opens</span><b>{until(new Date(next.startsAt).getTime() - now)}</b><DemoOpen round={next} /></div>
        </div>
      );
    }
    return (
      <div className="pt-hero online">
        <div className="pt-hero-main">
          <span className="pt-hero-kicker label">All rounds done</span>
          <h2>Awards are streamed into your Zoom room</h2>
          <p>Your results appear here once the organisers publish them.</p>
        </div>
        {zoomLink && <div className="pt-hero-side">{zoomLink}</div>}
      </div>
    );
  };

  const timeline: TimelineItem[] = items.map((a) => {
    const s = state(a);
    const r = a.roundId ? contest.rounds.find((x) => x.id === a.roundId) : undefined;
    const nextDay = ymd(a.at, tz) > contestDay;
    const att = r && attempt(r);
    return {
      id: a.id,
      state: s,
      time: <>{hm(a.at, tz)}{!sameZone && <small>{hm(a.at, contest.timeZone)}{contest.timeZone === 'America/Los_Angeles' ? '\u00a0PT' : ''}{nextDay ? ' · next day' : ''}</small>}</>,
      title: r?.mystery && s === 'next' ? 'Mystery Dive' : a.title,
      detail: r ? (r.mystery && s === 'next' ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'On your own' : 'With your team'}, ${r.minutes} minutes, in the browser`) : a.note,
      side: att?.submittedAt ? <State tone="ok">Handed in</State> : s === 'now' ? <State tone="go">Open</State> : null,
    };
  });

  const steps: Step[] = [
    { done: !!competitor.waiverSignedAt, title: 'Waiver signed', sub: competitor.waiverSignedAt ? `By ${competitor.waiverSignedBy || competitor.guardianName}` : `Emailed to ${competitor.guardianName || 'your guardian'}`, action: !competitor.waiverSignedAt && !REMOTE && <Link to={`/waiver/${competitor.id}`} className="btn btn-sm">Open</Link> },
    { done: !!competitor.deviceCheckedAt, title: 'Device check', sub: competitor.deviceCheckedAt ? 'This computer is ready' : 'Two minutes, on the computer you will use', action: !competitor.deviceCheckedAt ? <button className="btn btn-sm" type="button" onClick={() => setChecking(true)}>Run it</button> : <button className="btn btn-sm btn-quiet" type="button" onClick={() => setChecking(true)}>Run again</button> },
    { done: !!room, title: room ? `Zoom ${room.name}` : 'A Zoom room', sub: room ? `Proctor ${proctor?.name ?? 'to be named'}${zoomItem ? `, join at ${hm(zoomItem.at, tz)}` : ''}` : 'Assigned a week before', action: zoomLink },
  ];
  const ready = steps.every((x) => x.done);

  return (
    <>
      {hero()}
      <Results competitor={competitor} team={team} />
      <div className="split pt-split">
        <div className="stack-lg pt-col">
          <GutsNow team={team} now={now} className="pt-o1" />
          <section className="section pt-o4">
            <div className="section-head">
              <h2>Your day</h2>
              <span className="label row" style={{ gap: 6 }}><Icon name="globe" size={13} />{sameZone ? zoneLabel(tz, items[0]?.at ?? new Date().toISOString()) : `Your time: ${zoneLabel(tz, items[0]?.at ?? new Date().toISOString())}`}</span>
            </div>
            <Timeline items={timeline} />
          </section>
        </div>
        <div className="stack-lg pt-col">
          {started && ready ? (
            room && (
              <section className="section pt-zoom pt-o2">
                <div className="pt-zoom-ic"><Icon name="video" /></div>
                <div style={{ minWidth: 0 }}>
                  <b>Zoom {room.name}</b>
                  <small>Proctor {proctor?.name ?? 'to be named'}. Camera on, showing you and your desk.</small>
                </div>
                {zoomLink}
              </section>
            )
          ) : (
            <Ready title={started ? 'Ready to take part' : 'Before the day'} steps={steps} className="pt-o2" />
          )}
          <Announcements competitorId={competitor.id} tz={tz} now={now} className="pt-o1" />
          <TeamCard team={team} inPerson={false} className="pt-o5" />
        </div>
      </div>
      {checking && <DeviceCheck onDone={() => { markDeviceCheck(competitor.id); setChecking(false); toast('This computer is ready', 'See you on Zoom.', 'g'); }} onClose={() => setChecking(false)} />}
    </>
  );
}

/** A short, honest check: what the test needs from the browser. The camera is Zoom's job. */
function DeviceCheck({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const checks = [
    { label: 'Full screen works', ok: () => !!document.documentElement.requestFullscreen },
    { label: 'Screen is wide enough', ok: () => window.innerWidth >= 360 },
    { label: 'Answers save while you type', ok: () => { try { localStorage.setItem('mc-check', '1'); localStorage.removeItem('mc-check'); return true; } catch { return true; } } },
    { label: 'Connection is steady', ok: () => navigator.onLine !== false },
  ];
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (done >= checks.length) return;
    const t = setTimeout(() => setDone((d) => d + 1), 520);
    return () => clearTimeout(t);
  }, [done, checks.length]);
  const allOk = done >= checks.length && checks.every((c) => c.ok());
  return (
    <Modal title="Device check" onClose={onClose} actions={<><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" disabled={!allOk} onClick={onDone}>Done</button></>}>
      <p style={{ marginBottom: 12 }}>Use the computer you will test on. Your camera is checked by your proctor on Zoom, not here.</p>
      <ul className="checklist">
        {checks.map((c, i) => (
          <li key={c.label} className={i < done && c.ok() ? 'done' : ''}>
            <span className="box">{i < done && <Icon name="check" size={13} />}</span>
            <span><b>{c.label}</b></span>
            <span className="muted small">{i < done ? (c.ok() ? 'OK' : 'Problem') : i === done ? 'Checking' : ''}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
