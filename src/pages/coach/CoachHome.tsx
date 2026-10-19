import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { modeOf, remindWaiver } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Contest, Round, Team, User } from '../../lib/model';
import { useUser } from '../../lib/session';
import { setActiveContest, useAllDB, useDB } from '../../lib/store';
import { duration, roundEnds, roundState } from '../../lib/time';
import { PortalLayout } from '../../layouts/PortalLayout';
import { Icon } from '../../components/icons';
import { ArtEmpty } from '../../components/art';
import { ModeChip, Segmented, State, toast, Track, useNow } from '../../components/ui';
import { dayIn, hm, Timeline, until, type TimelineItem } from '../student/parts';
import { usePublished } from '../student/report';
import { TeamCard } from './CoachTeam';
import { CoachResults } from './CoachResults';
import '../../styles/portal.css';

/**
 * A coach's page: the teams they brought, what each still needs before the
 * day, how the rounds are going on the day, and results afterwards.
 */
export function CoachHome() {
  const user = useUser();
  const contest = useContest() as Contest | undefined;
  if (!user || user.role !== 'coach') return <Navigate to="/sign-in" replace />;
  if (!contest) return <NoTeams />;
  return <CoachPage user={user} />;
}

/** No contest in reach yet (connected, nothing registered or still loading): one way forward. */
function NoTeams() {
  const navigate = useNavigate();
  return (
    <PortalLayout>
      <div className="pt stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}><div><h1 className="page-title">Your teams</h1><p className="page-sub">Nothing registered yet.</p></div></div>
        <section className="section pt-empty">
          <ArtEmpty kind="teams" />
          <div>
            <h2>Register your first team</h2>
            <p className="soft">Pick a contest that is taking sign-ups. Your team then shows here, with its roster, waivers and schedule.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/welcome')}><Icon name="plus" />Register a team</button>
        </section>
      </div>
    </PortalLayout>
  );
}

function CoachPage({ user }: { user: User }) {
  const db = useDB();
  const all = useAllDB();
  const contest = useContest();
  const navigate = useNavigate();
  const now = useNow(1000);
  const results = usePublished();
  const mine = all.teams.filter((t) => user.teamIds?.includes(t.id));
  const contestIds = [...new Set(mine.map((t) => t.contestId))].filter((id) => all.contests.some((c) => c.id === id));
  const teams = db.teams.filter((t) => user.teamIds?.includes(t.id)).sort((a, b) => a.code.localeCompare(b.code));
  const modes = [...new Set(teams.map((t) => modeOf(contest, t)))];
  const states = contest.rounds.map((r) => roundState(r, now));
  const phase = contest.resultsPublished ? 'after' : states.some((s) => s !== 'scheduled') ? 'day' : 'before';
  const students = db.competitors.filter((c) => teams.some((t) => t.id === c.teamId));
  const signed = students.filter((c) => c.waiverSignedAt).length;

  return (
    <PortalLayout>
      <div className="pt stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{teams.length === 1 ? teams[0].name : 'Your teams'}</h1>
            <p className="page-sub row wrap" style={{ gap: '4px 10px' }}>
              <span>{teams.length} {teams.length === 1 ? 'team' : 'teams'}, {students.length} students</span>
              {students.length > 0 && phase !== 'after' && (signed === students.length ? <State tone="ok">All waivers signed</State> : <State tone="wait">{students.length - signed} {students.length - signed === 1 ? 'waiver' : 'waivers'} missing</State>)}
              {modes.map((m) => <ModeChip key={m} mode={m} />)}
              <span className="muted">{contest.short} · {contest.dateLabel}</span>
            </p>
          </div>
          <div className="actions">
            {contestIds.length > 1 && (
              <Segmented label="Contest" value={contest.id} onChange={setActiveContest} items={contestIds.map((id) => ({ key: id, label: all.contests.find((c) => c.id === id)?.short ?? id }))} />
            )}
            {teams.length > 0 && <button className="btn" type="button" onClick={() => navigate(`/register/${contest.slug}`)}><Icon name="plus" />Register a team</button>}
          </div>
        </div>

        {teams.length === 0 ? (
          <section className="section pt-empty">
            <ArtEmpty kind="teams" />
            <div>
              <h2>No teams in {contest.short} yet</h2>
              <p className="soft">Register a team and it shows here, with its roster, waivers and schedule.</p>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => navigate(`/register/${contest.slug}`)}><Icon name="plus" />Register a team</button>
          </section>
        ) : (
          <>
            {phase === 'day' && <Today teams={teams} now={now} />}
            {phase === 'after' && results.length > 0 && <CoachResults teams={teams} results={results} />}
            {phase === 'before' && <Checklist teams={teams} now={now} />}
            {teams.map((t) => <TeamCard key={t.id} team={t} results={results} />)}
            {phase === 'after' && results.length === 0 && (
              <section className="section pt-empty">
                <ArtEmpty kind="results" />
                <div><h2>Results are not out yet</h2><p className="soft">The organisers are checking answers. Scores and a report for each student appear here when they publish.</p></div>
              </section>
            )}
            <Schedule modes={modes} now={now} />
          </>
        )}
      </div>
    </PortalLayout>
  );
}

// ---------------------------------------------------------------- what's next

type NextItem = { done: boolean; title: string; sub: string; when: string; action?: ReactNode; ongoing?: boolean };

/** What is left before the day: the next step large, with its button; the rest on request. */
function Checklist({ teams, now }: { teams: Team[]; now: number }) {
  const db = useDB();
  const contest = useContest();
  const user = useUser()!;
  const [open, setOpen] = useState(false);
  const tz = contest.timeZone;
  const online = teams.filter((t) => modeOf(contest, t) === 'online');
  const inPerson = teams.filter((t) => modeOf(contest, t) === 'in_person');
  const of = (ts: Team[]) => db.competitors.filter((c) => ts.some((t) => t.id === c.teamId));
  const all = of(teams);
  const onl = of(online);
  const first = [...contest.rounds].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const ag = (re: RegExp, mode: 'online' | 'in_person') => contest.agenda.find((a) => a.modes.includes(mode) && re.test(a.title));
  const checkIn = ag(/check/i, 'in_person');
  const zoom = ag(/zoom/i, 'online');
  const awards = contest.agenda.find((a) => /award/i.test(a.title));
  const day = first ? dayIn(first.startsAt, tz) : contest.dateLabel;
  const started = !!first && roundState(first, now) !== 'scheduled';
  const tzShort = tz === 'America/Los_Angeles' ? 'PT' : tz.split('/').pop()!.replace(/_/g, ' ');
  const unsigned = all.filter((c) => !c.waiverSignedAt);
  const toRemind = unsigned.filter((c) => !c.reminderSentAt);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const remindAll = () => {
    toRemind.forEach((c) => remindWaiver(c.id, user.name));
    toast(`${toRemind.length} ${toRemind.length === 1 ? 'reminder' : 'reminders'} sent`, toRemind.map((c) => c.guardianName || c.guardianEmail).join(', '), 'g');
  };

  const items: NextItem[] = [
    { done: !contest.registration.open, title: contest.registration.open ? 'Finish the roster' : 'Roster set', sub: contest.registration.open ? 'Add, edit or move students, or switch in person / online.' : 'Registration closed. The organisers can still make changes.', when: contest.registration.open ? `Until ${contest.registration.closesLabel}` : `Closed ${contest.registration.closesLabel}`, ongoing: true, action: <button className="btn" type="button" onClick={() => jump(`team-${teams[0].id}`)}>Open the roster</button> },
    { done: all.length > 0 && all.every((c) => c.waiverSignedAt), title: 'Waivers signed', sub: `${all.length - unsigned.length} of ${all.length}. Nobody competes without one.${unsigned.length ? ` Waiting: ${unsigned.map((c) => c.name).join(', ')}.` : ''}`, when: `Before ${day}`, action: toRemind.length ? <button className="btn btn-primary" type="button" onClick={remindAll}><Icon name="mail" />Remind {toRemind.length} {toRemind.length === 1 ? 'guardian' : 'guardians'}</button> : <span className="muted small">Reminders sent</span> },
    ...(online.length ? [
      { done: onl.length > 0 && onl.every((c) => c.deviceCheckedAt), title: 'Device checks', sub: `${onl.filter((c) => c.deviceCheckedAt).length} of ${onl.length}. Each student runs it from their own page, on the computer they will use.`, when: `Before ${day}` },
      { done: onl.length > 0 && onl.every((c) => db.users.some((u) => u.competitorId === c.id)), title: 'Hand out sign-ins', sub: 'Print or copy each student’s username and password from Student sign-ins on each team.', when: `Before ${day}`, action: <button className="btn" type="button" onClick={() => jump(`team-${online[0].id}`)}><Icon name="ticket" />Student sign-ins</button> },
      { done: started, title: 'Students join Zoom', sub: 'Camera on, showing the student and their desk. Rounds run in the browser.', when: zoom ? `${dayIn(zoom.at, tz)}, ${hm(zoom.at, tz)} ${tzShort}` : day },
    ] : []),
    ...(inPerson.length ? [
      { done: of(inPerson).length > 0 && of(inPerson).every((c) => c.checkedInAt), title: `Check in at ${contest.venue?.name ?? 'the venue'}`, sub: `${contest.venue?.address ?? ''}${checkIn?.where ? `, ${checkIn.where.toLowerCase()}` : ''}. Pencils; no calculators.`, when: checkIn ? `${dayIn(checkIn.at, tz)}, ${hm(checkIn.at, tz)}` : day },
    ] : []),
    ...(first ? [{ done: started, title: `${first.name} starts`, sub: 'Every division starts at the same moment.', when: started ? 'Started' : `${hm(first.startsAt, tz)} ${tzShort}, ${until(new Date(first.startsAt).getTime() - now)}` }] : []),
    ...(awards ? [{ done: contest.resultsPublished, title: 'Awards and results', sub: 'Scores and a report for each student appear on this page.', when: `${hm(awards.at, tz)} ${tzShort}` }] : []),
  ];
  // The roster stays open until registration closes; it is the next step only when nothing else is.
  const firstReal = items.findIndex((i) => !i.done && !i.ongoing);
  const nextIdx = firstReal >= 0 ? firstReal : items.findIndex((i) => !i.done);
  const next = items[nextIdx];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="section pt-nextcard">
      <div className="section-head">
        <h2>What’s next</h2>
        <span className="row" style={{ gap: 10 }}>
          <span className="pt-dots" aria-label={`${doneCount} of ${items.length} done`}>{items.map((i, k) => <i key={i.title} className={i.done ? 'done' : k === nextIdx ? 'up' : ''} />)}</span>
          <span className="label">{doneCount} of {items.length} done</span>
        </span>
      </div>
      {next && !open && (
        <div className="pt-nextup">
          <div style={{ minWidth: 0 }}>
            <b>{next.title}</b>
            <p className="soft small">{next.sub}</p>
            <span className="pt-when">{next.when}</span>
          </div>
          {next.action && <div className="pt-nextup-act">{next.action}</div>}
        </div>
      )}
      {open && (
        <ul className="checklist pt-next">
          {items.map((i, k) => (
            <li key={i.title} className={`${i.done ? 'done' : ''} ${k === nextIdx ? 'pt-next-up' : ''}`}>
              <span className="box">{i.done && <Icon name="check" size={13} />}</span>
              <span><b>{i.title}</b><small>{i.sub}</small></span>
              <span className="pt-when">{i.when}</span>
            </li>
          ))}
        </ul>
      )}
      <button className="linkbtn small pt-more" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show only the next step' : `See all ${items.length} steps`}</button>
    </section>
  );
}

// ------------------------------------------------------------------ the day

function Today({ teams, now }: { teams: Team[]; now: number }) {
  const db = useDB();
  const contest = useContest();
  const tz = contest.timeZone;
  const rounds = [...contest.rounds].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const guts = rounds.find((r) => r.kind === 'guts');
  const gutsOn = guts && roundState(guts, now) !== 'scheduled';

  const progress = (r: Round, t: Team) => {
    if (modeOf(contest, t) === 'in_person') return <span className="soft small">On paper in the room</span>;
    if (r.kind === 'individual') {
      const kids = db.competitors.filter((c) => c.teamId === t.id);
      const as = kids.map((c) => db.attempts.find((a) => a.roundId === r.id && a.entrantId === c.id));
      const started = as.filter((a) => a?.startedAt).length;
      const handed = as.filter((a) => a?.submittedAt).length;
      return <span className="small"><b>{handed}</b> of {kids.length} handed in{started > handed ? `, ${started - handed} working` : ''}</span>;
    }
    const a = db.attempts.find((x) => x.roundId === r.id && x.entrantId === t.id);
    if (r.kind === 'guts') {
      const total = Math.max(1, ...r.problems.map((p) => p.set ?? 1));
      const sets = a?.setsSubmitted ?? 0;
      // Connected, a coach only sees the sets already handed out, so the total is not always known.
      if (total <= sets || total === 1) return <span className="small"><b>{sets}</b> {sets === 1 ? 'set' : 'sets'} handed in</span>;
      return <span className="row small" style={{ gap: 8 }}><Track done={sets} total={total} current={a?.startedAt && sets < total ? sets + 1 : null} />{sets} of {total} sets</span>;
    }
    return <span className="small">{a?.submittedAt ? 'Handed in' : a?.startedAt ? 'Working' : 'Not started'}</span>;
  };

  return (
    <section className="section pt-today">
      <div className="section-head">
        <h2>Today</h2>
        {gutsOn && <Link className="btn btn-sm btn-primary" to="/board" target="_blank"><Icon name="board" />Guts scoreboard</Link>}
      </div>
      <div className="pt-rounds">
        {rounds.map((r) => {
          const s = roundState(r, now);
          const ends = roundEnds(r);
          return (
            <div key={r.id} className={`pt-round ${s}`}>
              <div className="pt-round-head">
                <b>{s === 'scheduled' && r.mystery ? 'Mystery Dive' : r.name}</b>
                {s === 'open' ? <State tone="go">{ends ? `${duration(ends - now)} left` : 'Open'}</State> : s === 'closed' ? <State tone="off">Done</State> : <span className="muted small">{hm(r.startsAt, tz)}</span>}
              </div>
              {s !== 'scheduled' && (
                <ul className="pt-round-teams">
                  {teams.map((t) => <li key={t.id}><span className="mono muted">{t.code}</span>{progress(r, t)}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Schedule({ modes, now }: { modes: ('online' | 'in_person')[]; now: number }) {
  const contest = useContest();
  const tz = contest.timeZone;
  const items = contest.agenda.filter((a) => a.modes.some((m) => modes.includes(m))).sort((a, b) => a.at.localeCompare(b.at));
  if (!items.length) return null;
  const lastStarted = contest.rounds.filter((r) => roundState(r, now) !== 'scheduled').sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const tl: TimelineItem[] = items.map((a) => {
    const r = a.roundId ? contest.rounds.find((x) => x.id === a.roundId) : undefined;
    const s = r ? (roundState(r, now) === 'open' ? 'now' : roundState(r, now) === 'closed' ? 'past' : 'next') : lastStarted && a.at < lastStarted.startsAt ? 'past' : 'next';
    const shown = a.modes.filter((m) => modes.includes(m));
    const where = a.where === 'room' ? 'Team rooms' : a.where === 'hall' ? contest.venue?.hall : a.where;
    return {
      id: a.id,
      state: s,
      time: hm(a.at, tz),
      title: r?.mystery && s === 'next' ? 'Mystery Dive' : a.title,
      detail: <>{where && shown.includes('in_person') && <span className="pt-where"><Icon name="pin" size={12} />{where}</span>}{a.note && <span>{a.note}</span>}</>,
      side: modes.length > 1 ? <span className="row" style={{ gap: 4 }}>{shown.map((m) => <ModeChip key={m} mode={m} />)}</span> : null,
    };
  });
  return (
    <section className="section">
      <div className="section-head"><h2>The day</h2><span className="label">{contest.dateLabel} · {tz === 'America/Los_Angeles' ? 'Pacific time' : tz}</span></div>
      <Timeline items={tl} />
    </section>
  );
}
