import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { answerClarification, broadcast, closeRound, lockAttempt, modeOf, offers, openRound, setBoard, unlockAttempt } from '../../lib/actions';
import { useBoard, useContest, useLookups } from '../../lib/hooks';
import type { Attempt, IntegrityEvent, Round } from '../../lib/model';
import { rareWrongCollisions } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { REMOTE, useDB } from '../../lib/store';
import { ago, clockIn, clockSec, duration, roundEnds, roundState } from '../../lib/time';
import { ScoreList } from '../../components/Scoreboard';
import { Icon, type IconName } from '../../components/icons';
import { Drawer, EmptyState, Modal, ModeChip, Roll, Segmented, State, toast, useNow } from '../../components/ui';
import '../../styles/live.css';

const EVENT: Record<IntegrityEvent['kind'], string> = {
  hidden: 'Left the test tab',
  blur: 'Switched to another window',
  fullscreen_exit: 'Left fullscreen',
  paste: 'Pasted text',
  resize: 'Shrank the window',
  offline: 'Lost connection',
  second_session: 'Opened the test on a second device',
  warned: 'Was warned',
  locked: 'Test locked',
  unlocked: 'Unlocked',
};
const FLAGS: IntegrityEvent['kind'][] = ['hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'offline', 'second_session'];
const setsIn = (round: Round) => Math.max(1, ...round.problems.map((p) => p.set ?? 1));

export function Live() {
  const contest = useContest();
  if (!contest.rounds.length) return <NoRounds />;
  return <LiveRounds />;
}

function NoRounds() {
  const me = useUser()!;
  const navigate = useNavigate();
  const director = me.role === 'director' || me.role === 'staff';
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Live</h1><p className="page-sub">Follow each round while it runs.</p></div></div>
      <section className="card">
        <EmptyState
          icon="live"
          title="No rounds yet"
          action={director && <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/rounds')}><Icon name="plus" />Add rounds</button>}
        >
          Once the contest has rounds, this is where you open them, watch online tests and answer questions.
        </EmptyState>
      </section>
    </>
  );
}

function LiveRounds() {
  const contest = useContest();
  const me = useUser()!;
  const navigate = useNavigate();
  const now = useNow(1000);
  const director = me.role === 'director' || me.role === 'staff';
  const openNow = contest.rounds.find((r) => roundState(r, now) === 'open');
  const [roundId, setRoundId] = useState(openNow?.id ?? contest.rounds[contest.rounds.length - 1].id);
  const round = contest.rounds.find((r) => r.id === roundId) ?? contest.rounds[0];
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const pct = ends ? Math.max(0, Math.min(100, ((now - (ends - round.minutes * 60000)) / (round.minutes * 60000)) * 100)) : 0;
  const guts = round.kind === 'guts';
  const online = offers(contest, 'online');

  const board = guts && <BoardSection now={now} director={director} proctorId={director ? undefined : me.id} />;
  const zoom = online && (
    <div className="lv-zoom">
      <Rooms round={round} now={now} />
      <Questions round={round} />
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Live</h1>
          <p className="page-sub lv-sub">
            {state === 'open' && ends
              ? <><span className="lv-pulse" aria-hidden="true" /><span>{round.name} is open · <b className="mono">{duration(ends - now)}</b> left</span></>
              : state === 'closed'
                ? <><Icon name="check-circle" size={15} /><span>{round.name} has finished.</span></>
                : <><Icon name="clock" size={15} /><span>{round.name} has not started. It is set for {clockIn(round.startsAt, contest.timeZone).replace(' PT', '')}.</span></>}
          </p>
        </div>
        <div className="actions">
          {contest.rounds.length > 1 && <Segmented label="Round" value={round.id} onChange={setRoundId} items={contest.rounds.map((r) => ({ key: r.id, label: r.short }))} />}
          {director && state === 'open' && <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>}
          {director && state !== 'open' && (
            <button className={`btn ${state === 'closed' ? '' : 'btn-primary'}`} type="button" onClick={() => setConfirm('open')}>
              {state === 'closed' ? <Icon name="refresh" /> : <Icon name="timer" />}{state === 'closed' ? 'Reopen' : 'Open'} {round.short}
            </button>
          )}
          {guts && (state === 'open' || !director) && <button className="btn btn-primary" type="button" onClick={() => navigate('/board')}><Icon name="board" />Show on projector</button>}
        </div>
      </div>
      {state === 'open' && (
        <div className="lv-progress" role="progressbar" aria-label="Time gone" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="stack-lg lv-stack">
        <LiveFigures round={round} now={now} />
        {director ? <>{board}{zoom}</> : <>{zoom}{board}</>}
        {director && offers(contest, 'in_person') && <VenueRooms round={round} />}
      </div>

      {confirm && (
        <Modal
          title={confirm === 'open' ? `Open ${round.name}?` : `Close ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' ? 'btn-primary' : 'btn-primary btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') openRound(round.id);
                else closeRound(round.id);
                toast(confirm === 'open' ? `${round.name} is open` : `${round.name} is closed`, undefined, 'g');
                setConfirm(null);
              }}>{confirm === 'open' ? 'Open now' : 'Close and hand in'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `The ${round.minutes}-minute clock starts${contest.divisions.length > 1 ? ' for both divisions at once' : ''}.` : online ? 'Every online test still open is handed in as it is. Students cannot change answers after this.' : 'Collect the papers; graders key them under Grading.'}</p>
        </Modal>
      )}
    </>
  );
}

/** One number someone might need to act on, with a bar when it is a share of something. */
function Fig({ label, icon, n, of, sub, tone, bar }: { label: ReactNode; icon?: IconName; n: number; of?: number; sub: ReactNode; tone?: 'wait' | 'bad'; bar?: 'green' | 'blue' }) {
  return (
    <div className={`figure lv-fig ${tone && n ? tone : ''}`}>
      <div className="top-label">{icon && <Icon name={icon} size={15} />}{label}</div>
      <b><Roll value={n} /></b>
      <span>{sub}</span>
      {bar && of !== undefined && <i className={`lv-fig-bar ${bar}`} aria-hidden="true"><i style={{ width: `${of ? Math.min(100, (n / of) * 100) : 0}%` }} /></i>}
    </div>
  );
}

/** The round at a glance: one number per thing someone might need to act on. */
function LiveFigures({ round, now }: { round: Round; now: number }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const director = me.role === 'director' || me.role === 'staff';
  const state = roundState(round, now);
  const live = db.teams.filter((t) => t.status !== 'withdrawn');
  const proctorRoom = !director ? contest.rooms.find((r) => r.id === me.roomId || r.proctorId === me.id) : undefined;
  const inScope = (teamId: string) => !proctorRoom || proctorRoom.teamIds.includes(teamId);
  const here = live.filter((t) => modeOf(contest, t) === 'in_person');
  const away = live.filter((t) => modeOf(contest, t) === 'online' && inScope(t.id));
  const hereComps = db.competitors.filter((c) => here.some((t) => t.id === c.teamId));
  const entrants = (teams: typeof live) => (round.kind === 'individual' ? db.competitors.filter((c) => teams.some((t) => t.id === c.teamId)).map((c) => c.id) : teams.map((t) => t.id));
  const awayIds = new Set(entrants(away));
  const hereIds = new Set(entrants(here));
  const atts = db.attempts.filter((a) => a.roundId === round.id);
  const onl = atts.filter((a) => a.source === 'online' && awayIds.has(a.entrantId));
  const working = onl.filter((a) => a.startedAt && !a.submittedAt && !a.locked).length;
  const handed = onl.filter((a) => a.submittedAt).length;
  const locked = onl.filter((a) => a.locked && !a.submittedAt).length;
  const paper = atts.filter((a) => a.source === 'paper' && hereIds.has(a.entrantId));
  const keyed = round.kind === 'guts' ? paper.reduce((n, a) => n + (a.setsSubmitted ?? 0), 0) : paper.filter((a) => Object.keys(a.responses).length).length;
  const toKey = round.kind === 'guts' ? here.length * setsIn(round) : hereIds.size;
  const questions = db.clarifications.filter((c) => c.roundId === round.id && !c.answer).length;
  const showHere = director && offers(contest, 'in_person') && here.length > 0;
  const showAway = offers(contest, 'online') && away.length > 0;
  if (!showHere && !showAway) return null;
  const unit = round.kind === 'individual' ? 'students' : 'teams';
  const checkedIn = hereComps.filter((c) => c.checkedInAt).length;
  return (
    <div className="figures lv-figs">
      {showHere && <Fig label={<ModeChip mode="in_person">Checked in</ModeChip>} n={checkedIn} of={hereComps.length} sub={`of ${hereComps.length} students`} bar="green" />}
      {showHere && state !== 'scheduled' && <Fig label={<ModeChip mode="in_person">{round.kind === 'guts' ? 'Sets keyed' : 'Sheets keyed'}</ModeChip>} n={keyed} of={toKey} sub={`of ${toKey}`} bar="green" />}
      {showAway && (state === 'closed'
        ? <Fig label={<ModeChip mode="online">Handed in</ModeChip>} n={handed} of={awayIds.size} sub={`of ${awayIds.size} ${unit}`} bar="blue" />
        : state === 'scheduled'
          ? <Fig label={<ModeChip mode="online">Waiting</ModeChip>} n={awayIds.size} sub={unit} />
          : <Fig label={<ModeChip mode="online">Working</ModeChip>} n={working} of={awayIds.size} sub={`${handed} handed in · ${Math.max(0, awayIds.size - working - handed - locked)} not started`} bar="blue" />)}
      {showAway && <Fig label="Questions" icon="chat" n={questions} tone="wait" sub={questions ? 'waiting for an answer' : 'none waiting'} />}
      {showAway && state !== 'scheduled' && <Fig label="Locked tests" icon="lock" n={locked} tone="bad" sub={locked ? 'need you to unlock' : 'none locked'} />}
    </div>
  );
}

function BoardSection({ now, director, proctorId }: { now: number; director: boolean; proctorId?: string }) {
  const contest = useContest();
  const db = useDB();
  const navigate = useNavigate();
  // A proctor starts on the division their own room is in.
  const room = proctorId ? contest.rooms.find((r) => r.proctorId === proctorId) : undefined;
  const roomTeam = room ? db.teams.find((t) => room.teamIds.includes(t.id)) : undefined;
  const [div, setDiv] = useState(roomTeam?.divisionId ?? contest.divisions[0].id);
  const board = useBoard(div, now);
  if (!board) return null;
  const freezeIn = board.freezeAt ? board.freezeAt - now : null;
  const status: { icon: IconName; title: string; text: ReactNode; tone?: string } = board.frozen
    ? { icon: 'lock', title: 'Frozen', text: <>{contest.board.freezeMinutes} minutes before the end. The projector and students keep seeing the standings from that moment.</>, tone: 'frozen' }
    : freezeIn !== null && freezeIn > 0
      ? { icon: 'timer', title: `Freezes in ${duration(freezeIn)}`, text: <>With {contest.board.freezeMinutes} minutes left, so the finish is a reveal at the awards.</> }
      : { icon: 'live', title: 'Live', text: 'Every set handed in or keyed appears straight away.', tone: 'live' };
  return (
    <section className="card lv-card">
      <div className="lv-head">
        <h2 className="lv-h"><Icon name="board" />Guts scoreboard</h2>
        <div className="actions">
          {contest.divisions.length > 1 && <Segmented label="Division" value={div} onChange={setDiv} items={contest.divisions.map((d) => ({ key: d.id, label: d.name }))} />}
          <button className="icon-btn" type="button" aria-label="Show on projector" title="Show on projector" onClick={() => navigate('/board')}><Icon name="arrow-up-right" /></button>
        </div>
      </div>
      <div className="lv-board">
        <ScoreList board={board} limit={10} />
        <aside className="lv-side">
          <div className={`lv-status ${status.tone ?? ''}`}>
            <span className="lv-status-ic"><Icon name={status.icon} size={15} /></span>
            <div><b>{status.title}</b><span>{status.text}</span></div>
          </div>
          {director && (
            <>
              <label className="field">
                <span>Freeze the board</span>
                <select className="select" value={contest.board.freezeMinutes} onChange={(e) => { setBoard({ freezeMinutes: Number(e.target.value) }); toast(Number(e.target.value) ? `Freezes with ${e.target.value} minutes left` : 'The board will not freeze'); }}>
                  <option value={0}>Never</option>
                  <option value={5}>5 minutes before the end</option>
                  <option value={10}>10 minutes before the end</option>
                  <option value={15}>15 minutes before the end</option>
                </select>
              </label>
              {(board.frozen || contest.board.revealed) && (
                <button className="btn" type="button" onClick={() => { setBoard({ revealed: !contest.board.revealed }); toast(contest.board.revealed ? 'Board frozen again' : 'Final standings revealed', undefined, 'g'); }}>
                  <Icon name={contest.board.revealed ? 'lock' : 'eye'} />{contest.board.revealed ? 'Freeze again' : 'Reveal final standings'}
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

/** A count with a short bar under it, for "15 of 16" in a table. */
function Share({ n, of }: { n: number; of: number }) {
  return (
    <span className="lv-share">
      <span>{n} <span className="muted">of {of}</span></span>
      <i aria-hidden="true"><i style={{ width: `${of ? Math.min(100, (n / of) * 100) : 0}%` }} className={n >= of && of > 0 ? 'full' : ''} /></i>
    </span>
  );
}

/** The venue's rooms during a round: who is here, and how many papers are keyed. */
function VenueRooms({ round }: { round: Round }) {
  const db = useDB();
  const contest = useContest();
  const navigate = useNavigate();
  const rooms = contest.venue?.rooms ?? [];
  return (
    <section className="card flush lv-venue">
      <div className="card-head">
        <span className="row lv-titled"><ModeChip mode="in_person" /><h2>{round.kind === 'guts' ? `In the ${contest.venue?.hall ?? 'hall'}` : 'In the rooms'}</h2></span>
        <button className="btn btn-sm" type="button" onClick={() => navigate('/staff/grading')}><Icon name="grading" />Key papers</button>
      </div>
      {rooms.length === 0 ? (
        <EmptyState icon="pin" title="No rooms set up">Rooms and the teams in each are set under Settings.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Room</th><th className="hide-sm">Teams</th><th className="num">Checked in</th><th className="num">{round.kind === 'individual' ? 'Sheets keyed' : round.kind === 'guts' ? 'Sets keyed' : 'Team sheets keyed'}</th></tr></thead>
            <tbody>
              {rooms.map((r) => {
                const teams = db.teams.filter((t) => r.teamIds.includes(t.id) && t.status !== 'withdrawn');
                const people = db.competitors.filter((c) => teams.some((t) => t.id === c.teamId));
                const ids = round.kind === 'individual' ? people.map((c) => c.id) : teams.map((t) => t.id);
                const atts = db.attempts.filter((a) => a.roundId === round.id && a.source === 'paper' && ids.includes(a.entrantId));
                const keyed = round.kind === 'guts' ? atts.reduce((n, a) => n + (a.setsSubmitted ?? 0), 0) : atts.filter((a) => Object.keys(a.responses).length).length;
                const of = round.kind === 'guts' ? teams.length * setsIn(round) : ids.length;
                return (
                  <tr key={r.id}>
                    <td className="name">{round.kind === 'guts' ? `Teams from ${r.name}` : r.name}</td>
                    <td className="soft mono small hide-sm">{teams.map((t) => t.code).join(' ') || <span className="muted">Empty</span>}</td>
                    <td className="num"><Share n={people.filter((c) => c.checkedInAt).length} of={people.length} /></td>
                    <td className="num"><Share n={keyed} of={of} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Rooms({ round, now }: { round: Round; now: number }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const { team, competitor } = useLookups();
  const rooms = me.role === 'proctor' ? contest.rooms.filter((r) => r.id === me.roomId) : contest.rooms;
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [openId, setOpenId] = useState<string | null>(null);
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const teamIds = new Set(room?.teamIds ?? []);
  const entrants =
    round.kind === 'individual'
      ? db.competitors.filter((c) => teamIds.has(c.teamId)).map((c) => ({ id: c.id, code: c.publicId, name: c.name }))
      : db.teams.filter((t) => teamIds.has(t.id)).map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const attemptOf = (id: string) => db.attempts.find((a) => a.roundId === round.id && a.entrantId === id);
  const collisions = useMemo(
    () => (roundState(round, now) === 'closed' && round.kind === 'individual' ? rareWrongCollisions(round, db.attempts.filter((a) => a.roundId === round.id && a.source === 'online'), db.rulings, 2) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.attempts, db.rulings, round.id],
  );
  const opened = openId ? attemptOf(openId) : undefined;
  const nameOf = (id: string) => competitor.get(id)?.name ?? team.get(id)?.name ?? id;
  const codeOf = (id: string) => competitor.get(id)?.publicId ?? team.get(id)?.code ?? id;
  const proctor = room?.proctorId ? db.users.find((u) => u.id === room.proctorId)?.name : undefined;
  const sets = setsIn(round);

  return (
    <section className="card flush lv-rooms">
      <div className="lv-head lv-pad">
        <span className="row lv-titled"><ModeChip mode="online" /><h2>{me.role === 'proctor' ? 'Your Zoom room' : 'On Zoom'}</h2></span>
        {rooms.length > 1 && <Segmented label="Room" value={room?.id ?? ''} onChange={setRoomId} items={rooms.map((r) => ({ key: r.id, label: r.name }))} />}
      </div>
      {room && (
        <div className="lv-room-meta lv-pad">
          <span className="row"><Icon name="user" size={14} />{room.name} · {proctor ? <>proctor {proctor}</> : <span className="wait">no proctor</span>}</span>
          {room.url && <span className="mono hide-sm" title={room.url}>{room.url.replace(/^https?:\/\//, '')}</span>}
          {room.url && (REMOTE
            ? <a className="row" href={room.url} target="_blank" rel="noreferrer"><Icon name="video" size={14} />Open Zoom</a>
            : <button className="linkbtn row" type="button" onClick={() => toast('Opens Zoom', 'The sandbox meeting links are not real.')}><Icon name="video" size={14} />Open Zoom</button>)}
        </div>
      )}
      {entrants.length === 0 ? (
        <EmptyState icon="screen" title="Nobody in this room">Online {round.kind === 'individual' ? 'students' : 'teams'} are placed in Zoom rooms under Settings.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="t lv-t">
            <thead>
              <tr><th>{round.kind === 'individual' ? 'ID' : 'Team'}</th><th>Name</th><th>Status</th><th className="num">{round.kind === 'guts' ? 'Sets' : 'Answered'}</th><th className="hide-sm">Last save</th><th>Flags</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {entrants.map((e) => {
                const a = attemptOf(e.id);
                const flags = a?.events.filter((x) => FLAGS.includes(x.kind)) ?? [];
                const answered = a ? Object.values(a.responses).filter((r) => r.value.trim()).length : 0;
                const last = a ? Object.values(a.responses).reduce((m, r) => (r.savedAt > m ? r.savedAt : m), '') : '';
                const isLocked = !!a?.locked && !a.submittedAt;
                return (
                  <tr key={e.id} className={`click ${openId === e.id ? 'current' : ''} ${isLocked ? 'lv-locked' : ''}`} onClick={() => setOpenId(e.id)}>
                    <td className="mono soft">{e.code}</td>
                    <td className="name">{e.name}</td>
                    <td>{!a?.startedAt ? <State tone="off">Not started</State> : a.submittedAt ? <State tone="ok">Handed in</State> : a.locked ? <State tone="wait">Locked</State> : <State tone="go">Working</State>}</td>
                    <td className="num">{round.kind === 'guts' ? <>{a?.setsSubmitted ?? 0} <span className="muted">of {sets}</span></> : <>{answered} <span className="muted">of {round.problems.length}</span></>}</td>
                    <td className="muted hide-sm">{last ? ago(last, now) : '–'}</td>
                    <td>{flags.length ? <span className={`lv-flags ${flags.length >= 3 ? 'many' : ''}`} title={flags.map((f) => EVENT[f.kind]).join(', ')}><Icon name="flag" size={13} />{flags.length} · {EVENT[flags[flags.length - 1].kind].toLowerCase()}</span> : <span className="muted">–</span>}</td>
                    <td className="num lv-act">
                      {isLocked
                        ? <button className="btn btn-sm btn-primary" type="button" onClick={(ev) => { ev.stopPropagation(); unlockAttempt(a!.id, me.name); toast(`${e.code} unlocked`, undefined, 'g'); }}><Icon name="unlock" />Unlock</button>
                        : <Icon name="chevron-right" className="lv-chev" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {collisions.length > 0 && (
        <div className="lv-collide lv-pad">
          <h3><Icon name="warning" size={15} />Shared rare wrong answers</h3>
          {collisions.map((c) => (
            <p key={c.a + c.b} className="small">
              <span className="mono">{codeOf(c.a)}</span> {nameOf(c.a)} and <span className="mono">{codeOf(c.b)}</span> {nameOf(c.b)} gave the same wrong answer to {c.shared.map((s) => `problem ${s.split(':')[0]}`).join(', ')}.
            </p>
          ))}
          <p className="muted small">Something to look at with the Zoom recordings, not proof of anything.</p>
        </div>
      )}
      <AttemptDrawer attempt={opened} title={openId ? `${codeOf(openId)} ${nameOf(openId)}` : ''} onClose={() => setOpenId(null)} />
    </section>
  );
}

function AttemptDrawer({ attempt, title, onClose }: { attempt?: Attempt; title: string; onClose: () => void }) {
  const me = useUser()!;
  const away = attempt?.events.reduce((n, e) => n + (e.ms ?? 0), 0) ?? 0;
  const flags = attempt?.events.filter((x) => FLAGS.includes(x.kind)).length ?? 0;
  return (
    <Drawer
      open={!!attempt}
      onClose={onClose}
      kicker="Test log"
      title={title}
      foot={
        attempt && !attempt.submittedAt && (attempt.locked ? (
          <button className="btn btn-primary" type="button" onClick={() => { unlockAttempt(attempt.id, me.name); toast('Test unlocked', undefined, 'g'); }}><Icon name="unlock" />Unlock</button>
        ) : (
          <button className="btn" type="button" onClick={() => { lockAttempt(attempt.id, me.name); toast('Test locked'); }}><Icon name="lock" />Lock test</button>
        ))
      }
    >
      {attempt && (
        <>
          <section>
            <dl className="dl">
              <dt>Status</dt><dd>{!attempt.startedAt ? <State tone="off">Not started</State> : attempt.submittedAt ? <State tone="ok">Handed in</State> : attempt.locked ? <State tone="wait">Locked</State> : <State tone="go">Working</State>}</dd>
              <dt>Honour code</dt><dd>{attempt.honorName ?? '–'}</dd>
              <dt>Time away</dt><dd>{duration(away)}</dd>
              <dt>Flags</dt><dd className={flags >= 3 ? 'wait' : ''}>{flags || 'None'}</dd>
            </dl>
          </section>
          <section>
            <h3>Events</h3>
            <ul className="log lv-log">
              {attempt.startedAt && <li><time>{clockSec(attempt.startedAt)}</time><span>Started</span></li>}
              {attempt.events.map((e, i) => (
                <li key={i}><time>{clockSec(e.at)}</time><span className={e.kind === 'locked' ? 'bad' : e.kind === 'unlocked' ? 'ok' : FLAGS.includes(e.kind) ? 'lv-ev-flag' : ''}>{EVENT[e.kind]}{e.ms ? ` for ${duration(e.ms)}` : ''}{e.by ? ` by ${e.by}` : ''}</span></li>
              ))}
              {attempt.submittedAt && <li><time>{clockSec(attempt.submittedAt)}</time><span className="ok">Handed in</span></li>}
            </ul>
            <p className="muted small" style={{ marginTop: 12 }}>The browser reports tab switches, fullscreen and pasting. It cannot see a phone; the Zoom camera can.</p>
          </section>
        </>
      )}
    </Drawer>
  );
}

function Questions({ round }: { round: Round }) {
  const db = useDB();
  const { competitor } = useLookups();
  const [text, setText] = useState('');
  const pending = db.clarifications.filter((c) => c.roundId === round.id && !c.answer);
  const sent = db.clarifications.filter((c) => c.roundId === round.id && c.answer && c.broadcast).sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''));
  return (
    <aside className="lv-aside">
      <section className="card lv-card">
        <div className="lv-head"><h2 className="lv-h"><Icon name="chat" />Questions</h2>{pending.length > 0 && <span className="badge">{pending.length}</span>}</div>
        {pending.length === 0 ? (
          <div className="lv-none"><Icon name="check-circle" size={16} /><span>None waiting. Questions students ask from their test screen appear here.</span></div>
        ) : pending.map((c) => {
          const who = c.fromCompetitorId ? competitor.get(c.fromCompetitorId) : undefined;
          return <Reply key={c.id} id={c.id} who={who ? `${who.publicId} ${who.name}` : 'A competitor'} question={c.question} at={c.at} />;
        })}
      </section>
      <section className="card lv-card">
        <div className="lv-head"><h2 className="lv-h"><Icon name="announce" />Announce</h2></div>
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="textarea" style={{ minHeight: 76 }} placeholder="Shown on every online test screen" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" type="button" disabled={!text.trim()} onClick={() => { broadcast(round.id, text); setText(''); toast('Announcement sent', 'It shows on every online test screen.', 'g'); }}><Icon name="send" />Send to every online test</button>
        </div>
        {sent.length > 0 && (
          <div className="lv-sent">
            {sent.slice(0, 3).map((b) => (
              <div key={b.id} className="qa new"><small>{clockSec(b.answeredAt ?? b.at)}</small>{b.question && <span className="soft">{b.question} </span>}{b.answer}</div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function Reply({ id, who, question, at }: { id: string; who: string; question: string; at: string }) {
  const [text, setText] = useState('');
  return (
    <div className="lv-q">
      <small>{who} · {clockSec(at)}</small>
      <p>{question}</p>
      <textarea className="textarea" style={{ minHeight: 56 }} placeholder="Answer" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" type="button" disabled={!text.trim()} onClick={() => { answerClarification(id, text, false); toast('Answered', 'Only they see it.', 'g'); }}>Reply to them</button>
        <button className="btn btn-sm btn-primary" type="button" disabled={!text.trim()} onClick={() => { answerClarification(id, text, true); toast('Answered for everyone', undefined, 'g'); }}>Reply to all</button>
      </div>
    </div>
  );
}
