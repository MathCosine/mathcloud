import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { markDeviceCheck, modeOf, openRound } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { AgendaItem, Competitor, Round, Team } from '../../lib/model';
import { useStudent } from '../../lib/session';
import { useDB } from '../../lib/store';
import { duration, roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Icon } from '../../components/icons';
import { Modal, State, toast, useNow } from '../../components/ui';
import { verifyCode } from '../staff/Certificates';

/**
 * A student's page. In person and online are two different days, so they
 * get two different pages: one is a pass and a map of the building, the
 * other a checklist, a Zoom room and a start button, in the student's own
 * time zone.
 */
export function StudentHome() {
  const me = useStudent();
  const contest = useContest();
  if (!me) return <Navigate to="/sign-in" replace />;
  const mode = modeOf(contest, me.team);
  return (
    <PortalLayout mode={mode}>
      {mode === 'online' ? <OnlineHome competitor={me.competitor} team={me.team} /> : <InPersonHome competitor={me.competitor} team={me.team} />}
    </PortalLayout>
  );
}

// ------------------------------------------------------------------ shared

const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
const ymd = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
function zoneLabel(tz: string, at: string) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  return part.replace(' Standard', '').replace(' Daylight', '');
}

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

function Greeting({ competitor, team, extra }: { competitor: Competitor; team: Team; extra?: string }) {
  return (
    <div>
      <h1 className="page-title">Hi {competitor.name.split(' ')[0]}</h1>
      <p className="page-sub"><span className="mono">{competitor.publicId}</span> · {team.name}{extra ? ` · ${extra}` : ''}</p>
    </div>
  );
}

function Results({ competitor, team }: { competitor: Competitor; team: Team }) {
  const contest = useContest();
  const standings = useStandings();
  const row = standings.individuals[team.divisionId]?.find((r) => r.competitor.id === competitor.id);
  const teamRow = standings.teams[team.divisionId]?.find((r) => r.team.id === team.id);
  const division = contest.divisions.find((d) => d.id === team.divisionId)!;
  if (!contest.resultsPublished || !row) return null;
  return (
    <section className="section reveal">
      <div className="section-head"><h2>Your results</h2><span className="label">{division.name} division</span></div>
      <div className="row wrap" style={{ gap: 40, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em' }}>{row.score}<span className="muted" style={{ fontSize: 20 }}> / {row.max}</span></div>
          <p className="soft" style={{ marginTop: 8 }}>{ordinal(row.place)} of {standings.individuals[team.divisionId].length}{row.tied ? ', tied' : ''}</p>
          {row.award && <p className="strong" style={{ color: 'var(--blue)', marginTop: 2 }}>{row.award}</p>}
        </div>
        <div className="grow stack" style={{ gap: 10 }}>
          <div className="marks">{row.results.map((x) => <span key={x.problemId} className={`mark ${x.status}`} title={`Problem ${x.number}: ${x.status}`}>{x.number}</span>)}</div>
          {teamRow && <p className="soft small">{team.name}: {ordinal(teamRow.place)} of {standings.teams[team.divisionId].length} teams, {teamRow.total} points.</p>}
          <div><button className="btn btn-sm" type="button" onClick={() => toast('Certificate', `${row.award ?? 'Participation'}. Check code ${verifyCode(contest.slug, competitor.publicId)}.`)}><Icon name="certificate" />Certificate</button></div>
        </div>
      </div>
    </section>
  );
}

function TeamCard({ team, inPerson }: { team: Team; inPerson: boolean }) {
  const db = useDB();
  const mates = db.competitors.filter((c) => c.teamId === team.id);
  return (
    <section className="section">
      <div className="section-head"><h2>Your team</h2><span className="label">Team {team.code}</span></div>
      {mates.map((c) => (
        <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--line)' }}>
          <span><span className="mono muted">{c.publicId}</span>&nbsp; {c.name}</span>
          {!c.waiverSignedAt ? <span className="wait small">Waiver missing</span>
            : inPerson ? (c.checkedInAt ? <span className="muted small">Checked in</span> : <span className="muted small">Not here yet</span>)
            : c.deviceCheckedAt ? <span className="muted small">Ready</span> : <span className="muted small">Device check to do</span>}
        </div>
      ))}
    </section>
  );
}

// --------------------------------------------------------------- in person

function InPersonHome({ competitor, team }: { competitor: Competitor; team: Team }) {
  const contest = useContest();
  const now = useNow(1000);
  const venue = contest.venue;
  const at = (iso: string) => fmt(iso, contest.timeZone);
  const room = venue?.rooms.find((r) => r.teamIds.includes(team.id));
  const where = (w?: string) => (w === 'room' ? room?.name ?? 'Your room' : w === 'hall' ? venue?.hall ?? 'The hall' : w);
  const items = contest.agenda.filter((a) => a.modes.includes('in_person')).sort((a, b) => a.at.localeCompare(b.at));
  const state = agendaState(contest.rounds, now);
  const open = contest.rounds.find((r) => roundState(r, now) === 'open');
  const next = contest.rounds.find((r) => roundState(r, now) === 'scheduled');
  const started = contest.rounds.some((r) => roundState(r, now) !== 'scheduled');
  const checkIn = items.find((a) => /check/i.test(a.title));

  const hero = () => {
    if (contest.resultsPublished) return null;
    if (open) {
      const item = items.find((a) => a.roundId === open.id);
      const ends = roundEnds(open)!;
      return (
        <div className="hero room">
          <div>
            <h2>{open.name} is under way in {where(item?.where)}</h2>
            <p>{duration(ends - now)} left. {open.kind === 'guts' ? 'The scoreboard is on the big screen.' : `Write ${open.kind === 'individual' ? competitor.publicId : team.code} on every sheet.`}</p>
          </div>
          <span className="mono" style={{ fontSize: 30, fontWeight: 700 }}>{duration(ends - now)}</span>
        </div>
      );
    }
    if (!started && !competitor.checkedInAt) {
      return (
        <div className="hero">
          <div>
            <h2>Check in{checkIn ? ` from ${at(checkIn.at)}` : ''}{checkIn?.where ? ` at the ${checkIn.where.toLowerCase()}` : ''}</h2>
            <p>{venue?.name}, {venue?.address}. Give your ID, {competitor.publicId}, at the desk.</p>
          </div>
        </div>
      );
    }
    if (next) {
      const item = items.find((a) => a.roundId === next.id);
      return (
        <div className="hero">
          <div>
            <h2>Next: {next.mystery ? 'the Mystery Dive' : next.name} at {at(next.startsAt)}</h2>
            <p>In {where(item?.where)}. Be in your seat five minutes before.</p>
          </div>
          <button className="btn" type="button" onClick={() => { openRound(next.id); toast(`${next.name} has started`, 'In the demo you can start a round yourself.'); }}>Start it now (demo)</button>
        </div>
      );
    }
    const awards = items.find((a) => /award/i.test(a.title));
    return (
      <div className="hero">
        <div>
          <h2>That was every round</h2>
          <p>Results at the awards{awards ? `, ${at(awards.at)} in ${where(awards.where)}` : ''}.</p>
        </div>
      </div>
    );
  };

  return (
    <div className="stack-lg">
      <Greeting competitor={competitor} team={team} extra={venue?.name} />
      {!competitor.waiverSignedAt && (
        <div className="note amber row wrap" style={{ justifyContent: 'space-between' }}>
          <span>Your waiver is not signed yet. We emailed {competitor.guardianName}. You cannot compete without it.</span>
          <Link to={`/waiver/${competitor.id}`} className="btn btn-sm">Open the waiver link</Link>
        </div>
      )}
      {hero()}
      <Results competitor={competitor} team={team} />
      <div className="split">
        <section className="section">
          <div className="section-head"><h2>Your day</h2><span className="label">{contest.dateLabel}</span></div>
          <ol className="agenda">
            {items.map((a) => {
              const s = state(a);
              const r = a.roundId ? contest.rounds.find((x) => x.id === a.roundId) : undefined;
              return (
                <li key={a.id} className={s}>
                  <time>{at(a.at)}</time>
                  <span className="rail"><i /></span>
                  <div>
                    <b>{r?.mystery && s === 'next' ? 'Mystery Dive' : a.title}</b>
                    {a.where && <div className="where"><Icon name="pin" size={13} />{where(a.where)}</div>}
                    {r && <div className="note-line">{r.mystery && s === 'next' ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'On your own' : 'With your team'}, ${r.minutes} minutes`}</div>}
                    {!r && a.note && <div className="note-line">{a.note}</div>}
                  </div>
                  {s === 'now' ? <State tone="go">Now</State> : s === 'past' ? <State tone="off">Done</State> : <span />}
                </li>
              );
            })}
          </ol>
        </section>
        <div className="stack-lg">
          <div className="pass">
            <div style={{ minWidth: 0 }}>
              <span className="label">Competitor ID</span>
              <div className="pass-id">{competitor.publicId}</div>
              <dl>
                <dt>Name</dt><dd>{competitor.name}</dd>
                <dt>Team</dt><dd>{team.code} · {team.name}</dd>
                <dt>Room</dt><dd>{room?.name ?? 'Given at check-in'}</dd>
              </dl>
            </div>
            <span className={`stamp ${competitor.checkedInAt ? 'in' : ''}`}>
              {competitor.checkedInAt ? <><Icon name="check" size={13} />In, {at(competitor.checkedInAt)}</> : 'Not checked in'}
            </span>
          </div>
          {venue && venue.bring.filter(Boolean).length > 0 && (
            <section className="section">
              <div className="section-head"><h2>Bring</h2></div>
              <ul className="bring">{venue.bring.filter(Boolean).map((b) => <li key={b}>{b}</li>)}</ul>
            </section>
          )}
          <TeamCard team={team} inPerson />
        </div>
      </div>
    </div>
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

  const hero = () => {
    if (contest.resultsPublished) return null;
    if (open) {
      const a = attempt(open);
      const ends = roundEnds(open)!;
      return (
        <div className="hero go">
          <div>
            <h2>{a?.submittedAt ? `${open.name}: handed in` : `${open.name} is open`}</h2>
            <p>{duration(ends - now)} left{room ? ` · stay on camera in Zoom ${room.name}` : ''}</p>
            {!canStart && <p className="wait small">Your waiver needs signing before you can start.</p>}
          </div>
          {!a?.submittedAt && (
            <button className="btn btn-primary btn-lg" type="button" disabled={!canStart} onClick={() => navigate(`/me/test/${open.id}`)}>
              {a?.startedAt ? 'Back to the test' : `Start ${open.name}`}<Icon name="arrow" />
            </button>
          )}
        </div>
      );
    }
    if (next) {
      return (
        <div className="hero">
          <div>
            <h2>Next: {next.mystery ? 'the Mystery Dive' : next.name} at {fmt(next.startsAt, tz)}{sameZone ? '' : ' your time'}</h2>
            <p>{sameZone ? 'Join Zoom 20 minutes before.' : `${fmt(next.startsAt, contest.timeZone)} in ${home}: everyone starts at the same moment.`}</p>
          </div>
          <button className="btn" type="button" onClick={() => { openRound(next.id); toast(`${next.name} is open`, 'In the demo you can open a round yourself.'); }}>Open it now (demo)</button>
        </div>
      );
    }
    return (
      <div className="hero">
        <div>
          <h2>That was every round</h2>
          <p>Awards are streamed into your Zoom room. Results appear here when they are published.</p>
        </div>
      </div>
    );
  };

  const ready = [
    { done: !!competitor.waiverSignedAt, title: 'Waiver signed', sub: competitor.waiverSignedAt ? `By ${competitor.guardianName}` : `Emailed to ${competitor.guardianName}`, action: !competitor.waiverSignedAt && <Link to={`/waiver/${competitor.id}`} className="btn btn-sm">Open</Link> },
    { done: !!competitor.deviceCheckedAt, title: 'Device check', sub: competitor.deviceCheckedAt ? 'This computer is ready' : 'Two minutes, on the computer you will use', action: !competitor.deviceCheckedAt && <button className="btn btn-sm btn-primary" type="button" onClick={() => setChecking(true)}>Run it</button> },
    { done: !!room, title: room ? `Zoom ${room.name}` : 'A Zoom room', sub: room ? `Proctor ${proctor?.name ?? 'to be named'}` : 'Assigned a week before', action: room && <button className="btn btn-sm" type="button" onClick={() => toast('Opens Zoom', 'The demo meeting link is not real.')}><Icon name="video" />Join</button> },
  ];

  return (
    <div className="stack-lg">
      <Greeting competitor={competitor} team={team} extra={team.city} />
      {hero()}
      <Results competitor={competitor} team={team} />
      <div className="split">
        <section className="section">
          <div className="section-head">
            <h2>Your day</h2>
            <span className="label row" style={{ gap: 6 }}><Icon name="globe" size={13} />{sameZone ? zoneLabel(tz, items[0]?.at ?? new Date().toISOString()) : `Your time: ${zoneLabel(tz, items[0]?.at ?? new Date().toISOString())}`}</span>
          </div>
          <ol className="agenda">
            {items.map((a) => {
              const s = state(a);
              const r = a.roundId ? contest.rounds.find((x) => x.id === a.roundId) : undefined;
              const nextDay = ymd(a.at, tz) > contestDay;
              const att = r && attempt(r);
              return (
                <li key={a.id} className={s}>
                  <time>{fmt(a.at, tz)}{!sameZone && <small>{fmt(a.at, contest.timeZone)} {contest.timeZone === 'America/Los_Angeles' ? 'PT' : ''}{nextDay ? ' · next day for you' : ''}</small>}</time>
                  <span className="rail"><i /></span>
                  <div>
                    <b>{r?.mystery && s === 'next' ? 'Mystery Dive' : a.title}</b>
                    {r ? <div className="note-line">{r.mystery && s === 'next' ? 'Format revealed when it starts' : `${r.kind === 'individual' ? 'On your own' : 'With your team'}, ${r.minutes} minutes, in the browser`}</div>
                      : a.note && <div className="note-line">{a.note}</div>}
                  </div>
                  {att?.submittedAt ? <State tone="ok">Handed in</State> : s === 'now' ? <State tone="go">Open</State> : s === 'past' ? <State tone="off">Done</State> : <span />}
                </li>
              );
            })}
          </ol>
        </section>
        <div className="stack-lg">
          <section className="section">
            <div className="section-head"><h2>Before the day</h2><span className="label">{ready.filter((r) => r.done).length} of {ready.length}</span></div>
            <ul className="checklist">
              {ready.map((r) => (
                <li key={r.title} className={r.done ? 'done' : ''}>
                  <span className="box">{r.done && <Icon name="check" size={13} />}</span>
                  <span><b>{r.title}</b><small>{r.sub}</small></span>
                  {r.action || <span />}
                </li>
              ))}
            </ul>
          </section>
          <TeamCard team={team} inPerson={false} />
        </div>
      </div>
      {checking && <DeviceCheck onDone={() => { markDeviceCheck(competitor.id); setChecking(false); toast('This computer is ready', 'See you on Zoom.', 'g'); }} onClose={() => setChecking(false)} />}
    </div>
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

