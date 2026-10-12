import { useMemo, useState } from 'react';
import { answerClarification, broadcast, lockAttempt, unlockAttempt } from '../../lib/actions';
import { useContest, useLookups } from '../../lib/hooks';
import type { Attempt, IntegrityEvent } from '../../lib/model';
import { rareWrongCollisions } from '../../lib/scoring/engine';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { ago, clockSec, duration, roundEnds, roundState } from '../../lib/time';
import { CloseIcon, Roll, Segmented, Status, toast, useNow } from '../../components/ui';

const KIND_TEXT: Record<IntegrityEvent['kind'], string> = {
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
const FLAG_KINDS: IntegrityEvent['kind'][] = ['hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'offline', 'second_session'];

export function Proctoring() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const { team, competitor } = useLookups();
  const now = useNow(1000);
  const openRound = contest.rounds.find((r) => roundState(r, now) === 'open');
  const [roundId, setRoundId] = useState(openRound?.id ?? contest.rounds[0].id);
  const round = contest.rounds.find((r) => r.id === roundId)!;
  const myRooms = me.role === 'proctor' ? contest.rooms.filter((r) => r.id === me.roomId) : contest.rooms;
  const [roomId, setRoomId] = useState<string>(me.role === 'proctor' ? me.roomId! : 'all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const rooms = roomId === 'all' ? myRooms : myRooms.filter((r) => r.id === roomId);
  const teamIds = new Set(rooms.flatMap((r) => r.teamIds));
  const entrants = useMemo(() => {
    if (round.kind === 'individual') {
      return db.competitors
        .filter((c) => teamIds.has(c.teamId))
        .map((c) => ({ id: c.id, code: c.publicId, name: c.name, teamId: c.teamId }));
    }
    return db.teams.filter((t) => teamIds.has(t.id)).map((t) => ({ id: t.id, code: t.code, name: t.name, teamId: t.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, round.id, roomId]);

  const attemptOf = (id: string) => db.attempts.find((a) => a.roundId === round.id && a.entrantId === id);
  const ends = roundEnds(round);
  const state = roundState(round, now);
  const pending = db.clarifications.filter((c) => !c.answer && c.roundId === round.id && (!c.fromCompetitorId || teamIds.has(competitor.get(c.fromCompetitorId)?.teamId ?? '')));
  const broadcasts = db.clarifications.filter((c) => c.roundId === round.id && c.broadcast && c.answer).sort((a, b) => b.at.localeCompare(a.at));
  const inTest = entrants.filter((e) => { const a = attemptOf(e.id); return a?.startedAt && !a.submittedAt; }).length;
  const done = entrants.filter((e) => attemptOf(e.id)?.submittedAt).length;
  const lockedCount = entrants.filter((e) => attemptOf(e.id)?.locked && !attemptOf(e.id)?.submittedAt).length;
  const flagsTotal = entrants.reduce((n, e) => n + (attemptOf(e.id)?.events.filter((x) => FLAG_KINDS.includes(x.kind)).length ?? 0), 0);

  const collisions = useMemo(() => {
    if (state !== 'closed') return [];
    const online = db.attempts.filter((a) => a.roundId === round.id && a.source === 'online');
    return rareWrongCollisions(round, online, db.rulings, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, round.id, state]);

  const name = (id: string) => competitor.get(id)?.name ?? team.get(id)?.name ?? id;
  const code = (id: string) => competitor.get(id)?.publicId ?? team.get(id)?.code ?? id;
  const opened = openId ? attemptOf(openId) : undefined;

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Proctoring</span></div>
      <div className="page-head">
        <div>
          <h1>Proctoring</h1>
          <div className="meta">
            <span className="live"><i />Live</span>
            <span className="dot-sep" />
            <span>{round.name}: {state === 'open' && ends ? `${duration(ends - now)} left` : state === 'closed' ? 'finished' : 'not started'}</span>
            <span className="dot-sep" />
            <span>Online division only. In-person rooms are proctored on paper.</span>
          </div>
        </div>
        <Segmented label="Round" value={roundId} onChange={(id) => { setRoundId(id); setOpenId(null); }} items={contest.rounds.map((r) => ({ key: r.id, label: r.short }))} />
      </div>

      <div className="grid-main-side">
        <div className="stack">
          <section className="stats panel">
            <div className="stat"><div className="stat-label">In the test</div><div className="stat-value"><Roll value={inTest} /><span className="of">/ {entrants.length}</span></div></div>
            <div className="stat"><div className="stat-label">Handed in</div><div className="stat-value"><Roll value={done} /></div></div>
            <div className="stat"><div className="stat-label">Locked</div><div className="stat-value" style={{ color: lockedCount ? 'var(--amber)' : undefined }}><Roll value={lockedCount} /></div></div>
            <div className="stat"><div className="stat-label">Flags logged</div><div className="stat-value"><Roll value={flagsTotal} /></div></div>
          </section>

          {myRooms.length > 1 && (
            <Segmented label="Room" value={roomId} onChange={setRoomId} items={[{ key: 'all', label: 'All rooms' }, ...myRooms.map((r) => ({ key: r.id, label: r.name, count: r.teamIds.length }))]} />
          )}

          {rooms.map((r) => (
            <div key={r.id} className="callout blue" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1 }}>
                <b>{r.name}</b> · proctor {db.users.find((u) => u.id === r.proctorId)?.name ?? 'unassigned'} · {r.teamIds.map((id) => team.get(id)?.code).join(', ')}
                <br />
                <span className="mono" style={{ fontSize: 12 }}>{r.url}</span>
              </span>
              <button className="btn btn-sm" type="button" onClick={() => toast('Opens Zoom', 'In the demo the meeting link is not real.')}>Open Zoom</button>
            </div>
          ))}

          <div className="panel table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{round.kind === 'individual' ? 'ID' : 'Team'}</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>{round.kind === 'guts' ? 'Sets' : 'Answered'}</th>
                  <th>Last save</th>
                  <th>Flags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entrants.map((e) => {
                  const a = attemptOf(e.id);
                  const flags = a?.events.filter((x) => FLAG_KINDS.includes(x.kind)) ?? [];
                  const answered = a ? Object.values(a.responses).filter((r) => r.value.trim()).length : 0;
                  const last = a ? Object.values(a.responses).reduce((m, r) => (r.savedAt > m ? r.savedAt : m), '') : '';
                  return (
                    <tr key={e.id} className={`click ${openId === e.id ? 'open' : ''}`} onClick={() => setOpenId(e.id)}>
                      <td className="mono">{e.code}</td>
                      <td className="tname">{e.name}{round.kind === 'individual' && <span className="sub"> · {team.get(e.teamId)?.name}</span>}</td>
                      <td>
                        {!a?.startedAt ? <Status tone="grey">Not started</Status> : a.submittedAt ? <Status tone="green">Handed in</Status> : a.locked ? <Status tone="amber">Locked</Status> : <Status tone="blue">In the test</Status>}
                      </td>
                      <td className="mono">{round.kind === 'guts' ? `${a?.setsSubmitted ?? 0} / 6` : `${answered} / ${round.problems.length}`}</td>
                      <td className="mono sub">{last ? ago(last, now) : '—'}</td>
                      <td>{flags.length ? <span className={flags.length >= 3 ? 'warn-text' : 'sub2'}><b className="mono">{flags.length}</b> · {KIND_TEXT[flags[flags.length - 1].kind].toLowerCase()}</span> : <span className="sub">none</span>}</td>
                      <td>
                        {a?.locked && !a.submittedAt && (
                          <button className="btn btn-sm btn-primary" type="button" onClick={(ev) => { ev.stopPropagation(); unlockAttempt(a.id, me.name); toast(`${e.code} unlocked`, 'They can carry on. The unlock is in their log.', 'g'); }}>Unlock</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {collisions.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Shared rare wrong answers</h3><span className="sub" style={{ fontSize: 12.5 }}>Evidence for a person to review, never a verdict</span></div>
              <div className="panel-body stack" style={{ gap: 8 }}>
                {collisions.map((c) => (
                  <div key={c.a + c.b} className="row-wrap">
                    <span className="mono">{code(c.a)}</span> {name(c.a)} <span className="sub">and</span> <span className="mono">{code(c.b)}</span> {name(c.b)}
                    <span className="sub">gave the same wrong answers to</span>
                    {c.shared.map((s) => <span key={s} className="tag amber mono">P{s.replace(':', ' = ')}</span>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h3>Questions</h3><span className="sub" style={{ fontSize: 12.5 }}>{pending.length} waiting</span></div>
            <div className="panel-body stack">
              {pending.length === 0 && <p className="sub" style={{ fontSize: 13 }}>No questions waiting.</p>}
              {pending.map((c) => <QuestionReply key={c.id} id={c.id} who={c.fromCompetitorId ? `${code(c.fromCompetitorId)} ${name(c.fromCompetitorId)}` : 'Someone'} question={c.question} at={c.at} />)}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Announce to everyone</h3></div>
            <div className="panel-body stack">
              <textarea className="textarea" style={{ minHeight: 70 }} placeholder="Shown at the top of every online test screen in this round" value={announce} onChange={(e) => setAnnounce(e.target.value)} />
              <button className="btn btn-primary" type="button" disabled={!announce.trim()} onClick={() => { broadcast(round.id, announce); setAnnounce(''); toast('Announcement sent', 'Every online student in this round sees it now.', 'g'); }}>Send to everyone</button>
              {broadcasts.slice(0, 4).map((b) => (
                <div key={b.id} className="clar"><small>{clockSec(b.answeredAt ?? b.at)}</small>{b.question && <span className="sub">Q: {b.question} </span>}{b.answer}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className={`drawer ${opened ? 'open' : ''}`} aria-hidden={!opened}>
        {opened && openId && <AttemptDetail attempt={opened} title={`${code(openId)} ${name(openId)}`} onClose={() => setOpenId(null)} meName={me.name} />}
      </aside>
    </>
  );
}

function QuestionReply({ id, who, question, at }: { id: string; who: string; question: string; at: string }) {
  const [text, setText] = useState('');
  return (
    <div className="clar new" style={{ borderTop: 0 }}>
      <small>{who} · {clockSec(at)}</small>
      <div style={{ margin: '4px 0 8px' }}>{question}</div>
      <textarea className="textarea" style={{ minHeight: 56 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn btn-sm" type="button" disabled={!text.trim()} onClick={() => { answerClarification(id, text, false); toast('Answered privately'); }}>Reply to them</button>
        <button className="btn btn-sm btn-primary" type="button" disabled={!text.trim()} onClick={() => { answerClarification(id, text, true); toast('Answered for everyone', 'The question and answer now show on every screen.', 'g'); }}>Reply to everyone</button>
      </div>
    </div>
  );
}

function AttemptDetail({ attempt, title, onClose, meName }: { attempt: Attempt; title: string; onClose: () => void; meName: string }) {
  const away = attempt.events.filter((e) => e.ms).reduce((n, e) => n + (e.ms ?? 0), 0);
  return (
    <>
      <div className="drawer-head">
        <div className="drawer-top">
          <span className="drawer-code">Integrity log</span>
          <button className="x" type="button" onClick={onClose}><span className="kbd">esc</span><CloseIcon /></button>
        </div>
        <h2>{title}</h2>
        <div className="drawer-chips">
          <span>Honour code signed as “{attempt.honorName ?? '—'}”</span>
          <span className="dot-sep" />
          <span>Away {duration(away)} in total</span>
        </div>
      </div>
      <div className="drawer-body">
        <section>
          <h3>Events</h3>
          {attempt.events.length === 0 && <p className="sub">Nothing logged. They stayed in the test the whole time.</p>}
          <ul className="timeline">
            {attempt.startedAt && <li className="b">Started<time>{clockSec(attempt.startedAt)}</time></li>}
            {attempt.events.map((e, i) => (
              <li key={i} className={e.kind === 'unlocked' ? 'g' : e.kind === 'locked' ? 'r' : e.kind === 'warned' ? '' : 'a'}>
                {KIND_TEXT[e.kind]}{e.ms ? ` for ${duration(e.ms)}` : ''}{e.by ? ` by ${e.by}` : ''}
                <time>{clockSec(e.at)}</time>
              </li>
            ))}
            {attempt.submittedAt && <li className="g">Handed in<time>{clockSec(attempt.submittedAt)}</time></li>}
          </ul>
        </section>
        <section>
          <h3>What this can and cannot show</h3>
          <p className="sub" style={{ fontSize: 13 }}>The browser reports leaving the tab, switching windows, leaving fullscreen and pasting. It cannot see a phone or another person. Use this with what the Zoom camera showed.</p>
        </section>
      </div>
      <div className="drawer-foot">
        {!attempt.submittedAt && !attempt.locked && <button className="btn" type="button" onClick={() => { lockAttempt(attempt.id, meName); toast('Test locked', 'They see a lock screen until you unlock it.'); }}>Lock test</button>}
        {attempt.locked && !attempt.submittedAt && <button className="btn btn-primary" type="button" onClick={() => unlockAttempt(attempt.id, meName)}>Unlock</button>}
      </div>
    </>
  );
}
