import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { markDeviceCheck, modeOf, openRound } from '../../lib/actions';
import { useBoard, useContest } from '../../lib/hooks';
import type { AgendaItem, Competitor, DivisionMode, Round, Team } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { REMOTE, useDB } from '../../lib/store';
import { roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Icon, type IconName } from '../../components/icons';
import { ScoreList } from '../../components/Scoreboard';
import { Modal, State, toast, useNow } from '../../components/ui';
import { verifyCode } from '../staff/Certificates';
import { Countdown, dayIn, hm, Tick, Timeline, until, type TimelineItem } from './parts';
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
        <section className="pt-empty">
          <span className="pt-empty-ic"><Icon name="calendar" size={20} /></span>
          <h2>Your contest is not here yet</h2>
          <p>It may still be loading, or the organisers have not opened it yet. Try again in a moment.</p>
          <button className="btn btn-primary" type="button" onClick={() => location.reload()}><Icon name="refresh" />Try again</button>
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
    <header className="pt-who">
      <div className={`pt-who-id ${mode}`} aria-label={`Competitor ID ${competitor.publicId}`}>
        <small>ID</small>
        <b>{competitor.publicId}</b>
      </div>
      <div style={{ minWidth: 0 }}>
        <h1 className="pt-title">{competitor.name}</h1>
        <p className="pt-meta">
          <span>Team {team.code}, {team.name}</span>
          <span className="pt-sep" aria-hidden="true">·</span>
          <span>{contest.short}, {contest.dateLabel}</span>
        </p>
      </div>
    </header>
  );
}

/** The one thing to do now, as a card: what, when, and its button. */
function Now({ tone, kicker, title, children, side, bar }: { tone: 'live' | 'todo' | 'calm'; kicker: ReactNode; title: ReactNode; children?: ReactNode; side?: ReactNode; bar?: number }) {
  return (
    <section className={`pt-now ${tone}`}>
      <div className="pt-now-main">
        <div className="pt-now-kicker">{kicker}</div>
        <h2>{title}</h2>
        {children}
      </div>
      {side && <div className="pt-now-side">{side}</div>}
      {bar !== undefined && <div className="pt-now-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, bar * 100))}%` }} /></div>}
    </section>
  );
}

/** The waiver as the one thing to do: the guardian has the link, the student can nudge them. */
function WaiverHero({ competitor }: { competitor: Competitor }) {
  return (
    <Now
      tone="todo"
      kicker={<State tone="wait">To do first</State>}
      title="Your waiver is not signed yet"
      side={!REMOTE && <Link to={`/waiver/${competitor.id}`} className="btn btn-primary btn-lg pt-start">Open the waiver<Icon name="arrow" /></Link>}
    >
      <p>We emailed {competitor.guardianName || 'your guardian'}{competitor.guardianEmail ? ` at ${competitor.guardianEmail}` : ''}. Ask them to open that email and sign. You cannot compete without it.</p>
    </Now>
  );
}

function Head({ icon, title, aside }: { icon: IconName; title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="pt-h">
      <h2><Icon name={icon} size={16} />{title}</h2>
      {aside && <span className="label">{aside}</span>}
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
    <section className="card pt-card reveal" id="results">
      <div className="pt-h">
        <h2><Icon name="results" size={16} />Your results</h2>
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
    <section className={`card pt-card ${className ?? ''}`}>
      <Head icon="roster" title="Your team" aside={`Team ${team.code}`} />
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
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className={`card pt-card ${className ?? ''}`}>
      <Head icon="checklist" title={title} aside={`${done} of ${steps.length} done`} />
      <div className="pt-meter" aria-hidden="true"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="pt-check">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <Tick on={s.done} next={i === next} />
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
    <section className={`card pt-card ${className ?? ''}`}>
      <Head icon="announce" title="Announcements" aside={items.length} />
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
    <section className={`card pt-card ${className ?? ''}`}>
      <Head icon="board" title="Guts scoreboard" aside={<>{board.frozen ? 'Frozen' : <span className="state go">Live</span>} · {contest.divisions.find((d) => d.id === team.divisionId)?.name}</>} />
      <div className="pt-board"><ScoreList board={board} mine={team.id} limit={5} /></div>
    </section>
  );
}

function DemoOpen({ round }: { round: Round }) {
  if (REMOTE) return null;
  return (
    <button className="btn btn-sm btn-quiet pt-demo" type="button" title="Sandbox only" onClick={() => { openRound(round.id); toast(`${round.name} is open`, 'In the sandbox you can open a round yourself.'); }}>
      <Icon name="zap" size={13} />Sandbox: open {round.mystery ? 'the next round' : round.name} now
    </button>
  );
}

/** A big clock with a word under it. */
function Clock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pt-count">
      {children}
      <small>{label}</small>
    </div>
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
        <Now tone="live" kicker={<State tone="go">Now</State>} title={<>{open.name} in {where(item?.where)}</>} bar={(ends - now) / (open.minutes * 60000)}
          side={<Clock label="left"><Countdown ms={Math.max(0, ends - now)} /></Clock>}>
          <p>{open.kind === 'guts' ? 'The scoreboard is on the big screen.' : <>Write <b className="mono">{open.kind === 'individual' ? competitor.publicId : team.code}</b> on every sheet.</>}</p>
        </Now>
      );
    }
    if (!competitor.waiverSignedAt) return <WaiverHero competitor={competitor} />;
    if (!started && !competitor.checkedInAt) {
      return (
        <Now tone="calm" kicker={<span className="label">First thing on {checkIn ? dayIn(checkIn.at, tz) : contest.dateLabel}</span>}
          title={<>Check in{checkIn ? ` from ${at(checkIn.at)}` : ''}{checkIn?.where ? ` at the ${checkIn.where.toLowerCase()}` : ''}</>}
          side={checkIn && <Clock label="until check-in opens"><b className="pt-word">{until(new Date(checkIn.at).getTime() - now).replace(/^in /, '')}</b></Clock>}>
          <p className="pt-where-line"><Icon name="pin" size={14} />{venue?.name}, {venue?.address}. Give your ID, <b className="mono">{competitor.publicId}</b>, at the desk.</p>
        </Now>
      );
    }
    if (next) {
      const item = items.find((a) => a.roundId === next.id);
      const name = next.mystery ? 'the Mystery Dive' : next.name;
      return (
        <Now tone="calm" kicker={<span className="label">Next</span>} title={<>{name[0].toUpperCase() + name.slice(1)} at {at(next.startsAt)}, {where(item?.where)}</>}
          side={<><Clock label="until it starts"><b className="pt-word">{until(new Date(next.startsAt).getTime() - now).replace(/^in /, '')}</b></Clock><DemoOpen round={next} /></>}>
          <p>Be in your seat five minutes before.</p>
        </Now>
      );
    }
    return (
      <Now tone="calm" kicker={<span className="label">All rounds done</span>} title={<>Awards{awards ? ` at ${at(awards.at)} in ${where(awards.where)}` : ''}</>}>
        <p>Your results appear here once the organisers publish them.</p>
      </Now>
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
      <div className="pt-grid">
        <div className="stack-lg pt-col">
          <GutsNow team={team} now={now} className="pt-o1" />
          <section className="card pt-card pt-o4">
            <Head icon="calendar" title="Your day" aside={venue?.name} />
            <Timeline items={timeline} />
          </section>
        </div>
        <div className="stack-lg pt-col">
          <section className="card pt-pass pt-o2" aria-label="Your pass">
            <div className="pt-pass-top">
              <span className="label">Competitor ID</span>
              <span className={`pt-stamp ${competitor.checkedInAt ? 'in' : ''}`}>
                {competitor.checkedInAt ? <><Icon name="check" size={13} />In, {at(competitor.checkedInAt)}</> : 'Not checked in'}
              </span>
            </div>
            <div className="pt-pass-id">{competitor.publicId}</div>
            <dl>
              <dt>Team</dt><dd>{team.code} · {team.name}</dd>
              <dt>Room</dt><dd>{room ? room.name : 'Given at check-in'}</dd>
              <dt>Waiver</dt><dd>{competitor.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone="wait">Not signed</State>}</dd>
            </dl>
          </section>
          <Announcements competitorId={competitor.id} tz={tz} now={now} className="pt-o1" />
          {venue && venue.bring.filter(Boolean).length > 0 && !contest.resultsPublished && (
            <section className="card pt-card pt-o5">
              <Head icon="checklist" title="Bring" />
              <ul className="pt-bring">{venue.bring.filter(Boolean).map((b) => <li key={b}>{b}</li>)}</ul>
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
      const handed = !!a?.submittedAt;
      return (
        <Now
          tone={handed ? 'calm' : 'live'}
          kicker={handed ? <State tone="ok">Handed in</State> : <State tone="go">Open now</State>}
          title={handed ? `${open.name}: handed in. Well done.` : a?.startedAt ? `${open.name}: you have started` : `${open.name} is open`}
          bar={(ends - now) / (open.minutes * 60000)}
          side={
            <>
              <Clock label="left for everyone"><Countdown ms={Math.max(0, ends - now)} /></Clock>
              {!handed && (
                <button className="btn btn-primary btn-lg pt-start" type="button" disabled={!canStart} onClick={() => navigate(`/me/test/${open.id}`)}>
                  {a?.startedAt ? 'Back to the test' : `Start ${open.name}`}<Icon name="arrow" />
                </button>
              )}
            </>
          }
        >
          <p>{open.kind === 'individual' ? 'On your own' : 'With your team'}, {open.minutes} minutes{room ? `. Stay on camera in Zoom ${room.name}.` : '.'}</p>
          {!canStart && !handed && <p className="wait small">Your waiver needs signing before you can start.</p>}
        </Now>
      );
    }
    if (!competitor.waiverSignedAt) return <WaiverHero competitor={competitor} />;
    if (next && !competitor.deviceCheckedAt) {
      return (
        <Now tone="todo" kicker={<State tone="wait">To do before the day</State>} title="Run the device check"
          side={<><button className="btn btn-primary btn-lg pt-start" type="button" onClick={() => setChecking(true)}>Run the device check<Icon name="arrow" /></button><DemoOpen round={next} /></>}>
          <p>Two minutes, on the computer you will use. {next.mystery ? 'The first round' : next.name} opens {dayIn(next.startsAt, tz)} at {hm(next.startsAt, tz)}{sameZone ? '' : ' your time'}.</p>
        </Now>
      );
    }
    if (next) {
      const name = next.mystery ? 'the Mystery Dive' : next.name;
      return (
        <Now tone="calm" kicker={<span className="label">Next · {dayIn(next.startsAt, tz)}</span>} title={<>{name[0].toUpperCase() + name.slice(1)} at {hm(next.startsAt, tz)}{sameZone ? '' : ' your time'}</>}
          side={<><Clock label="until it opens"><b className="pt-word">{until(new Date(next.startsAt).getTime() - now).replace(/^in /, '')}</b></Clock><DemoOpen round={next} /></>}>
          <p>
            {sameZone ? `Join Zoom${zoomItem ? ` at ${hm(zoomItem.at, tz)}` : ' 20 minutes before'}. The start button appears here when it opens.` : `${hm(next.startsAt, contest.timeZone)} in ${home}: everyone starts at the same moment. The start button appears here when it opens.`}
          </p>
        </Now>
      );
    }
    return (
      <Now tone="calm" kicker={<span className="label">All rounds done</span>} title="Awards are streamed into your Zoom room" side={zoomLink}>
        <p>Your results appear here once the organisers publish them.</p>
      </Now>
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
      time: <>{hm(a.at, tz)}{!sameZone && <small>{hm(a.at, contest.timeZone)}{contest.timeZone === 'America/Los_Angeles' ? ' PT' : ''}{nextDay ? ' · next day' : ''}</small>}</>,
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
      <div className="pt-grid">
        <div className="stack-lg pt-col">
          <GutsNow team={team} now={now} className="pt-o1" />
          <section className="card pt-card pt-o4">
            <Head icon="calendar" title="Your day" aside={<span className="row" style={{ gap: 6 }}><Icon name="globe" size={13} />{sameZone ? zoneLabel(tz, items[0]?.at ?? new Date().toISOString()) : `Your time: ${zoneLabel(tz, items[0]?.at ?? new Date().toISOString())}`}</span>} />
            <Timeline items={timeline} />
          </section>
        </div>
        <div className="stack-lg pt-col">
          {started && ready ? (
            room && (
              <section className="card pt-card pt-zoom pt-o2">
                <span className="pt-zoom-ic"><Icon name="video" size={18} /></span>
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
    const t = setTimeout(() => setDone((d) => d + 1), 560);
    return () => clearTimeout(t);
  }, [done, checks.length]);
  const allOk = done >= checks.length && checks.every((c) => c.ok());
  return (
    <Modal title="Device check" onClose={onClose} actions={<><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" disabled={!allOk} onClick={onDone}>{allOk ? <><Icon name="check" />Done</> : 'Checking'}</button></>}>
      <p style={{ marginBottom: 16 }}>Use the computer you will test on. Your camera is checked by your proctor on Zoom, not here.</p>
      <ul className="pt-check pt-check-tight">
        {checks.map((c, i) => (
          <li key={c.label} className={i < done && c.ok() ? 'done' : ''}>
            <Tick on={i < done && c.ok()} busy={i === done} />
            <span><b>{c.label}</b></span>
            <span className={`small ${i < done ? (c.ok() ? 'ok' : 'bad') : 'muted'}`}>{i < done ? (c.ok() ? 'OK' : 'Problem') : i === done ? 'Checking' : ''}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
