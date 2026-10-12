import { useEffect, useMemo, useRef, useState } from 'react';
import { checkIn, remindWaiver, setTeamStatus } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Team } from '../../lib/model';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { clock, day, stamp } from '../../lib/time';
import { Checkbox, downloadCsv, Drawer, Roll, SearchBox, Segmented, State, Tabs, toast, type Tone } from '../../components/ui';

type View = 'teams' | 'people' | 'checkin';
type Div = 'all' | 'in_person' | 'online';
type SortKey = 'team' | 'waivers' | 'status' | 'reg';

const STATUS: Record<Team['status'], [Tone, string]> = {
  confirmed: ['ok', 'Confirmed'],
  pending: ['wait', 'Pending'],
  withdrawn: ['off', 'Withdrawn'],
};

export function Roster() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [view, setView] = useState<View>('teams');
  const [div, setDiv] = useState<Div>('all');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'team', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState(-1);
  const search = useRef<HTMLInputElement>(null);

  const members = (t: Team) => db.competitors.filter((c) => c.teamId === t.id);
  const missing = (t: Team) => members(t).filter((c) => !c.waiverSignedAt).length;
  const live = (t: Team) => t.status !== 'withdrawn';
  const inDiv = (t: Team) => div === 'all' || t.divisionId === div;
  const has = (s: string) => !q || s.toLowerCase().includes(q.trim().toLowerCase());
  const divName = (id: string) => contest.divisions.find((d) => d.id === id)?.name ?? id;

  const teamRows = useMemo(() => {
    let rows = db.teams.filter((t) => inDiv(t) && has([t.code, t.name, t.school, t.city, t.contactName, ...members(t).map((m) => `${m.publicId} ${m.name}`)].join(' ')));
    if (onlyMissing) rows = rows.filter((t) => live(t) && missing(t) > 0);
    if (onlyPending) rows = rows.filter((t) => t.status === 'pending');
    const key: Record<SortKey, (t: Team) => string | number> = {
      team: (t) => t.code,
      waivers: (t) => -missing(t),
      status: (t) => ({ pending: 0, confirmed: 1, withdrawn: 2 })[t.status],
      reg: (t) => t.registeredAt,
    };
    const k = key[sort.key];
    return rows.slice().sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, div, q, onlyMissing, onlyPending, sort]);

  const people = useMemo(() => {
    const byId = new Map(db.teams.map((t) => [t.id, t]));
    let rows = db.competitors.map((c) => ({ c, t: byId.get(c.teamId)! })).filter(({ c, t }) => t && inDiv(t) && has([c.publicId, c.name, c.guardianName, t.name].join(' ')));
    if (onlyMissing) rows = rows.filter(({ c, t }) => live(t) && !c.waiverSignedAt);
    if (onlyPending) rows = rows.filter(({ t }) => t.status === 'pending');
    if (view === 'checkin') rows = rows.filter(({ t }) => t.divisionId === 'in_person' && live(t));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, div, q, onlyMissing, onlyPending, view]);

  const liveTeams = db.teams.filter(live);
  const comps = db.competitors.filter((c) => liveTeams.some((t) => t.id === c.teamId));
  const here = comps.filter((c) => c.checkedInAt).length;
  const inPersonCount = comps.filter((c) => liveTeams.find((t) => t.id === c.teamId)?.divisionId === 'in_person').length;
  const ids = view === 'teams' ? teamRows.map((t) => t.id) : people.map((r) => r.t.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'j' || e.key === 'k') {
        const n = Math.max(0, Math.min(ids.length - 1, focus + (e.key === 'j' ? 1 : -1)));
        setFocus(n);
        if (open) setOpen(ids[n]);
      } else if (e.key === 'x' && view === 'teams' && teamRows[focus]) toggle(teamRows[focus].id);
      else if (e.key === 'Enter' && ids[focus]) setOpen(ids[focus]);
      else if (e.key === 'Escape' && !open) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.body.classList.toggle('has-bulk', selected.size > 0);
    return () => document.body.classList.remove('has-bulk');
  }, [selected]);

  function toggle(id: string) {
    const t = db.teams.find((x) => x.id === id);
    if (!t || !live(t)) return;
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const selectable = teamRows.filter(live);
  const picked = selectable.filter((t) => selected.has(t.id)).length;
  const allState: boolean | 'mixed' = picked === 0 ? false : picked === selectable.length ? true : 'mixed';

  const exportCsv = (only?: Set<string>) =>
    downloadCsv(
      'sfmo-2027-roster.csv',
      ['competitor_id', 'name', 'grade', 'team_code', 'team', 'division', 'status', 'waiver', 'guardian', 'guardian_email'],
      db.competitors
        .filter((c) => !only || only.has(c.teamId))
        .map((c) => {
          const t = db.teams.find((x) => x.id === c.teamId)!;
          return [c.publicId, c.name, c.grade, t.code, t.name, t.divisionId, t.status, c.waiverSignedAt ? 'signed' : 'missing', c.guardianName, c.guardianEmail];
        }),
    );

  const Sort = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" className={`sort ${sort.key === k ? 'on' : ''} ${sort.key === k && sort.dir < 0 ? 'desc' : ''}`} onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'reg' ? -1 : 1 }))}>
      {children}
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 6.2L5 3.7l2.5 2.5" /></svg>
    </button>
  );

  const checkinEnter = () => {
    const c = people.find(({ c }) => c.publicId.toLowerCase() === q.trim().toLowerCase())?.c;
    if (!c) return;
    if (!c.waiverSignedAt) toast(`${c.publicId} has no signed waiver`, 'A guardian can sign on a phone at the desk.', 'a');
    else if (!c.checkedInAt) { checkIn(c.id); toast(`${c.publicId} ${c.name} checked in`, undefined, 'g'); }
    setQ('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Roster</h1>
          <p className="page-sub">{liveTeams.length} teams · {comps.length} competitors · registration closed {contest.registration.closesLabel}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => exportCsv()}>Export CSV</button>
          <button className="btn btn-primary" type="button" onClick={() => toast('Add team', 'Opens the registration form, for teams who register by email.')}>Add team</button>
        </div>
      </div>

      <Tabs
        value={view}
        onChange={(v) => { setView(v); setFocus(-1); setOpen(null); setQ(''); }}
        items={[
          { key: 'teams', label: 'Teams', count: db.teams.length },
          { key: 'people', label: 'Competitors', count: db.competitors.length },
          { key: 'checkin', label: 'Check-in', count: here ? here : undefined },
        ]}
      />

      {view === 'checkin' ? (
        <div className="toolbar">
          <form onSubmit={(e) => { e.preventDefault(); checkinEnter(); }}>
            <SearchBox value={q} onChange={setQ} placeholder="Type or scan an ID, then Enter" inputRef={search} />
          </form>
          <span className="grow" />
          <span className="soft"><b className="ok"><Roll value={here} /></b> of {inPersonCount} here</span>
        </div>
      ) : (
        <div className="toolbar">
          <Segmented label="Division" value={div} onChange={(d) => { setDiv(d); setFocus(-1); }} items={[{ key: 'all', label: 'All' }, { key: 'in_person', label: 'In person' }, { key: 'online', label: 'Online' }]} />
          <SearchBox value={q} onChange={(v) => { setQ(v); setFocus(-1); }} placeholder="Search  /" inputRef={search} />
          <button type="button" className="filter" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((x) => !x)}>Waiver missing</button>
          <button type="button" className="filter" aria-pressed={onlyPending} onClick={() => setOnlyPending((x) => !x)}>Pending</button>
          <span className="grow" />
          <span className="muted small">{view === 'teams' ? teamRows.length : people.length} shown</span>
        </div>
      )}

      <div className="table-scroll">
        <table className="t">
          <thead>
            {view === 'teams' ? (
              <tr>
                <th className="w-check"><Checkbox checked={allState} label="Select all shown" onChange={() => setSelected((s) => { const n = new Set(s); selectable.forEach((t) => (allState === true ? n.delete(t.id) : n.add(t.id))); return n; })} /></th>
                <th><Sort k="team">Team</Sort></th>
                <th>Division</th>
                <th><Sort k="waivers">Waivers</Sort></th>
                <th>Contact</th>
                <th><Sort k="status">Status</Sort></th>
                <th className="num"><Sort k="reg">Registered</Sort></th>
              </tr>
            ) : view === 'people' ? (
              <tr><th>ID</th><th>Name</th><th>Grade</th><th>Team</th><th>Signs in with</th><th>Waiver</th></tr>
            ) : (
              <tr><th>ID</th><th>Name</th><th>Team</th><th>Waiver</th><th>Arrived</th><th /></tr>
            )}
          </thead>
          <tbody>
            {(view === 'teams' ? teamRows.length : people.length) === 0 && (
              <tr className="empty"><td colSpan={7}>Nothing matches. <button className="linkbtn" type="button" onClick={() => { setQ(''); setOnlyMissing(false); setOnlyPending(false); setDiv('all'); }}>Clear filters</button></td></tr>
            )}
            {view === 'teams' &&
              teamRows.map((t, i) => {
                const miss = missing(t);
                return (
                  <tr key={t.id} className={`click ${selected.has(t.id) ? 'selected' : ''} ${!live(t) ? 'dim' : ''} ${open === t.id || focus === i ? 'current' : ''}`} onClick={() => { setFocus(i); setOpen(t.id); }}>
                    <td className="w-check">{live(t) && <Checkbox checked={selected.has(t.id)} label={`Select ${t.name}`} onChange={() => toggle(t.id)} />}</td>
                    <td><span className="code">{t.code}</span><span className="name">{t.name}</span></td>
                    <td className="soft">{divName(t.divisionId)}</td>
                    <td>{!live(t) ? <span className="muted">–</span> : miss ? <span className="wait">{miss} missing</span> : <span className="muted">{members(t).length} of {members(t).length}</span>}</td>
                    <td className="soft">{t.contactName}</td>
                    <td><State tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</State></td>
                    <td className="num muted">{day(t.registeredAt)}</td>
                  </tr>
                );
              })}
            {view === 'people' &&
              people.map(({ c, t }, i) => {
                const acct = db.users.find((u) => u.competitorId === c.id);
                return (
                  <tr key={c.id} className={`click ${!live(t) ? 'dim' : ''} ${focus === i ? 'current' : ''}`} onClick={() => { setFocus(i); setOpen(t.id); }}>
                    <td className="mono">{c.publicId}</td>
                    <td className="name">{c.name}</td>
                    <td className="soft">{c.grade}</td>
                    <td><span className="ellipsis soft">{t.name}</span></td>
                    <td className="soft">{acct ? (acct.managed ? <span className="mono">{acct.email}</span> : acct.email) : <span className="muted">Invited</span>}</td>
                    <td>{c.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone="wait">Missing</State>}</td>
                  </tr>
                );
              })}
            {view === 'checkin' &&
              people.map(({ c, t }) => (
                <tr key={c.id}>
                  <td className="mono">{c.publicId}</td>
                  <td className="name">{c.name}</td>
                  <td className="soft">{t.name}</td>
                  <td>{c.waiverSignedAt ? <State tone="ok">Signed</State> : <State tone="wait">Missing</State>}</td>
                  <td className="muted">{c.checkedInAt ? clock(c.checkedInAt) : '–'}</td>
                  <td className="num">
                    <button className={`btn btn-sm ${c.checkedInAt ? 'btn-quiet' : ''}`} type="button" disabled={!c.waiverSignedAt && !c.checkedInAt} onClick={() => checkIn(c.id)}>
                      {c.checkedInAt ? 'Undo' : 'Check in'}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <TeamDrawer id={open} onClose={() => setOpen(null)} />

      <div className={`bulk ${selected.size ? 'show' : ''}`} role="toolbar" aria-label="Selected teams">
        <span className="n">{selected.size || 1} selected</span>
        <button type="button" onClick={() => {
          const pending = [...selected].filter((id) => db.teams.find((t) => t.id === id)?.status === 'pending');
          if (!pending.length) return toast('Already confirmed', 'Every selected team is confirmed.');
          setTeamStatus(pending, 'confirmed', me.name);
          toast(`Confirmed ${pending.length} ${pending.length === 1 ? 'team' : 'teams'}`, 'Confirmation emails are queued.', 'g');
        }}>Confirm</button>
        <button type="button" onClick={() => toast('Email', `Opens Email with ${selected.size} team contacts.`)}>Email</button>
        <button type="button" onClick={() => exportCsv(selected)}>Export</button>
        <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
    </>
  );
}

function TeamDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const t = db.teams.find((x) => x.id === id);
  const members = t ? db.competitors.filter((c) => c.teamId === t.id) : [];
  const log = t ? db.activity.filter((a) => a.teamId === t.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const coach = t?.coachId ? db.users.find((u) => u.id === t.coachId) : undefined;
  const room = t ? contest.rooms.find((r) => r.teamIds.includes(t.id)) : undefined;
  return (
    <Drawer
      open={!!t}
      onClose={onClose}
      kicker={t && `Team ${t.code} · ${contest.divisions.find((d) => d.id === t.divisionId)?.name}`}
      title={t?.name}
      foot={
        t && (
          <>
            <button className="btn" type="button" disabled={t.status === 'withdrawn'} onClick={() => toast('Confirmation sent again', `To ${t.contactEmail}.`, 'g')}>Resend confirmation</button>
            {t.status === 'pending' && <button className="btn btn-primary" type="button" onClick={() => setTeamStatus([t.id], 'confirmed', me.name)}>Confirm team</button>}
          </>
        )
      }
    >
      {t && (
        <>
          <section key={`${t.id}-m`}>
            <h3>Members</h3>
            <table className="t">
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="mono soft" style={{ width: 44 }}>{m.publicId}</td>
                    <td><b>{m.name}</b><div className="muted tiny">Grade {m.grade} · {m.guardianName}</div></td>
                    <td className="num">
                      {m.waiverSignedAt ? (
                        <span className="ok small">Signed {day(m.waiverSignedAt)}</span>
                      ) : t.status === 'withdrawn' ? null : m.reminderSentAt ? (
                        <span className="muted small">Reminded {clock(m.reminderSentAt)}</span>
                      ) : (
                        <button className="btn btn-sm" type="button" onClick={() => { remindWaiver(m.id, me.name); toast('Reminder sent', `${m.guardianName} gets the waiver link again.`); }}>Remind</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section key={`${t.id}-d`}>
            <h3>Details</h3>
            <dl className="dl">
              <dt>Status</dt><dd><State tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</State></dd>
              <dt>School</dt><dd>{t.school}, {t.city}</dd>
              <dt>Contact</dt><dd>{t.contactName} · {t.contactEmail}</dd>
              <dt>Coach</dt><dd>{coach ? coach.name : <span className="muted">Captain registered</span>}</dd>
              {room && (<><dt>Zoom</dt><dd>{room.name}</dd></>)}
              <dt>Join code</dt><dd className="mono">{t.joinCode}</dd>
              <dt>Donation</dt><dd>{t.pledge ? `$${t.pledge} pledged` : <span className="muted">None</span>}</dd>
            </dl>
          </section>
          <section key={`${t.id}-a`}>
            <h3>Activity</h3>
            <ul className="log">
              {log.map((a) => <li key={a.id}><time>{stamp(a.at)}</time><span>{a.text}</span></li>)}
            </ul>
          </section>
        </>
      )}
    </Drawer>
  );
}
