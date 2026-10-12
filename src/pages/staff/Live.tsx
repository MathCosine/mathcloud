import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { answerClarification, broadcast, closeRound, lockAttempt, openRound, setBoard, unlockAttempt } from '../../lib/actions';
import { useBoard, useContest, useLookups } from '../../lib/hooks';
import type { Attempt, IntegrityEvent, Round } from '../../lib/model';
import { rareWrongCollisions } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { ago, clockSec, duration, roundEnds, roundState } from '../../lib/time';
import { ScoreList } from '../../components/Scoreboard';
import { Drawer, Modal, Segmented, State, toast, useNow } from '../../components/ui';

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

export function Live() {
  const contest = useContest();
  const me = useUser()!;
  const now = useNow(1000);
  const director = me.role === 'director' || me.role === 'staff';
  const openNow = contest.rounds.find((r) => roundState(r, now) === 'open');
  const [roundId, setRoundId] = useState(openNow?.id ?? contest.rounds[contest.rounds.length - 1].id);
  const round = contest.rounds.find((r) => r.id === roundId)!;
  const state = roundState(round, now);
  const ends = roundEnds(round);
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const pct = ends ? Math.max(0, Math.min(100, ((now - (ends - round.minutes * 60000)) / (round.minutes * 60000)) * 100)) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Live</h1>
          <p className="page-sub">
            {state === 'open' && ends ? <>{round.name} is open. <b>{duration(ends - now)}</b> left.</> : state === 'closed' ? `${round.name} has finished.` : `${round.name} has not started.`}
          </p>
        </div>
        <div className="actions">
          <Segmented label="Round" value={roundId} onChange={setRoundId} items={contest.rounds.map((r) => ({ key: r.id, label: r.short }))} />
          {director && (state === 'open' ? (
            <button className="btn btn-danger" type="button" onClick={() => setConfirm('close')}>Close round</button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setConfirm('open')}>{state === 'closed' ? 'Reopen' : 'Open'} {round.short}</button>
          ))}
        </div>
      </div>
      {state === 'open' && <div className="progress" style={{ marginTop: -14, marginBottom: 28 }}><i style={{ width: `${pct}%` }} /></div>}

      <div className="stack-lg">
        {round.kind === 'guts' && <BoardSection now={now} director={director} proctorId={director ? undefined : me.id} />}
        <div className="split">
          <Rooms round={round} now={now} />
          <Questions round={round} />
        </div>
      </div>

      {confirm && (
        <Modal
          title={confirm === 'open' ? `Open ${round.name}?` : `Close ${round.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={`btn ${confirm === 'open' ? 'btn-primary' : 'btn-danger'}`} type="button" onClick={() => {
                if (confirm === 'open') openRound(round.id);
                else closeRound(round.id);
                toast(confirm === 'open' ? `${round.name} is open` : `${round.name} is closed`, undefined, 'g');
                setConfirm(null);
              }}>{confirm === 'open' ? 'Open now' : 'Close and hand in'}</button>
            </>
          }
        >
          <p>{confirm === 'open' ? `The ${round.minutes}-minute clock starts for both divisions at once.` : 'Every online test still open is handed in as it is.'}</p>
        </Modal>
      )}
    </>
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
  return (
    <section className="section">
      <div className="section-head">
        <h2>Guts scoreboard</h2>
        <div className="actions">
          <Segmented label="Division" value={div} onChange={setDiv} items={contest.divisions.map((d) => ({ key: d.id, label: d.name }))} />
          <button className="btn btn-primary" type="button" onClick={() => navigate('/board')}>Show on projector</button>
        </div>
      </div>
      <div className="split">
        <ScoreList board={board} limit={8} />
        <div className="stack small">
          {board.frozen ? (
            <div className="note amber">Frozen {contest.board.freezeMinutes} minutes before the end. The projector and students keep seeing the standings from that moment.</div>
          ) : freezeIn !== null && freezeIn > 0 ? (
            <div className="note">Freezes in {duration(freezeIn)}, at {contest.board.freezeMinutes} minutes left.</div>
          ) : (
            <div className="note">Live. Every set handed in or keyed appears straight away.</div>
          )}
          {director && (
            <>
              <label className="field">
                <span>Freeze before the end</span>
                <select className="select" value={contest.board.freezeMinutes} onChange={(e) => setBoard({ freezeMinutes: Number(e.target.value) })}>
                  <option value={0}>Never</option>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                </select>
              </label>
              {(board.frozen || contest.board.revealed) && (
                <button className="btn" type="button" onClick={() => { setBoard({ revealed: !contest.board.revealed }); toast(contest.board.revealed ? 'Board frozen again' : 'Final standings revealed', undefined, 'g'); }}>
                  {contest.board.revealed ? 'Freeze again' : 'Reveal final standings'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
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

  return (
    <section className="section" style={{ minWidth: 0 }}>
      <div className="section-head">
        <h2>Online, on Zoom</h2>
        {rooms.length > 1 && <Segmented label="Room" value={room?.id ?? ''} onChange={setRoomId} items={rooms.map((r) => ({ key: r.id, label: r.name }))} />}
      </div>
      {room && (
        <div className="row wrap soft small" style={{ marginBottom: 6, gap: 14 }}>
          <span>{room.name} · proctor {db.users.find((u) => u.id === room.proctorId)?.name ?? 'none'}</span>
          <span className="mono muted">{room.url}</span>
          <button className="linkbtn" type="button" onClick={() => toast('Opens Zoom', 'The demo meeting links are not real.')}>Open Zoom</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="t">
          <thead>
            <tr><th>{round.kind === 'individual' ? 'ID' : 'Team'}</th><th>Name</th><th>Status</th><th className="num">{round.kind === 'guts' ? 'Sets' : 'Answered'}</th><th>Last save</th><th>Flags</th><th /></tr>
          </thead>
          <tbody>
            {entrants.map((e) => {
              const a = attemptOf(e.id);
              const flags = a?.events.filter((x) => FLAGS.includes(x.kind)) ?? [];
              const answered = a ? Object.values(a.responses).filter((r) => r.value.trim()).length : 0;
              const last = a ? Object.values(a.responses).reduce((m, r) => (r.savedAt > m ? r.savedAt : m), '') : '';
              return (
                <tr key={e.id} className={`click ${openId === e.id ? 'current' : ''}`} onClick={() => setOpenId(e.id)}>
                  <td className="mono soft">{e.code}</td>
                  <td className="name">{e.name}</td>
                  <td>{!a?.startedAt ? <State tone="off">Not started</State> : a.submittedAt ? <State tone="ok">Handed in</State> : a.locked ? <State tone="wait">Locked</State> : <State tone="go">Working</State>}</td>
                  <td className="num">{round.kind === 'guts' ? `${a?.setsSubmitted ?? 0} of 6` : `${answered} of ${round.problems.length}`}</td>
                  <td className="muted">{last ? ago(last, now) : '–'}</td>
                  <td>{flags.length ? <span className={flags.length >= 3 ? 'wait' : 'soft'}>{flags.length} · {EVENT[flags[flags.length - 1].kind].toLowerCase()}</span> : <span className="muted">–</span>}</td>
                  <td className="num">
                    {a?.locked && !a.submittedAt && <button className="btn btn-sm btn-primary" type="button" onClick={(ev) => { ev.stopPropagation(); unlockAttempt(a.id, me.name); toast(`${e.code} unlocked`, undefined, 'g'); }}>Unlock</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {collisions.length > 0 && (
        <div className="stack" style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14 }}>Shared rare wrong answers</h3>
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
  return (
    <Drawer
      open={!!attempt}
      onClose={onClose}
      kicker="Test log"
      title={title}
      foot={
        attempt && !attempt.submittedAt && (attempt.locked ? (
          <button className="btn btn-primary" type="button" onClick={() => unlockAttempt(attempt.id, me.name)}>Unlock</button>
        ) : (
          <button className="btn" type="button" onClick={() => { lockAttempt(attempt.id, me.name); toast('Test locked'); }}>Lock test</button>
        ))
      }
    >
      {attempt && (
        <>
          <section>
            <dl className="dl">
              <dt>Honour code</dt><dd>{attempt.honorName ?? '–'}</dd>
              <dt>Time away</dt><dd>{duration(away)}</dd>
            </dl>
          </section>
          <section>
            <h3>Events</h3>
            <ul className="log">
              {attempt.startedAt && <li><time>{clockSec(attempt.startedAt)}</time><span>Started</span></li>}
              {attempt.events.map((e, i) => (
                <li key={i}><time>{clockSec(e.at)}</time><span className={e.kind === 'locked' ? 'bad' : e.kind === 'unlocked' ? 'ok' : ''}>{EVENT[e.kind]}{e.ms ? ` for ${duration(e.ms)}` : ''}{e.by ? ` by ${e.by}` : ''}</span></li>
              ))}
              {attempt.submittedAt && <li><time>{clockSec(attempt.submittedAt)}</time><span>Handed in</span></li>}
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
    <aside className="stack-lg" style={{ gap: 28 }}>
      <section className="section">
        <div className="section-head"><h2>Questions</h2>{pending.length > 0 && <span className="badge">{pending.length}</span>}</div>
        {pending.length === 0 && <p className="muted small">None waiting.</p>}
        {pending.map((c) => {
          const who = c.fromCompetitorId ? competitor.get(c.fromCompetitorId) : undefined;
          return <Reply key={c.id} id={c.id} who={who ? `${who.publicId} ${who.name}` : 'A competitor'} question={c.question} at={c.at} />;
        })}
      </section>
      <section className="section">
        <div className="section-head"><h2>Announce</h2></div>
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="textarea" style={{ minHeight: 72 }} placeholder="Shown on every online test screen" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" type="button" disabled={!text.trim()} onClick={() => { broadcast(round.id, text); setText(''); toast('Announcement sent', undefined, 'g'); }}>Send to everyone</button>
        </div>
        {sent.slice(0, 3).map((b) => (
          <div key={b.id} className="qa"><small>{clockSec(b.answeredAt ?? b.at)}</small>{b.question && <span className="soft">{b.question} </span>}{b.answer}</div>
        ))}
      </section>
    </aside>
  );
}

function Reply({ id, who, question, at }: { id: string; who: string; question: string; at: string }) {
  const [text, setText] = useState('');
  return (
    <div className="qa new">
      <small>{who} · {clockSec(at)}</small>
      <p style={{ margin: '2px 0 8px' }}>{question}</p>
      <textarea className="textarea" style={{ minHeight: 56 }} placeholder="Answer" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" type="button" disabled={!text.trim()} onClick={() => answerClarification(id, text, false)}>Reply to them</button>
        <button className="btn btn-sm btn-primary" type="button" disabled={!text.trim()} onClick={() => { answerClarification(id, text, true); toast('Answered for everyone', undefined, 'g'); }}>Reply to all</button>
      </div>
    </div>
  );
}
