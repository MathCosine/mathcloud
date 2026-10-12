import { useEffect, useMemo, useRef, useState } from 'react';
import { remindWaiver, setTeamStatus } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Competitor, Team } from '../../lib/model';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { ago, day, stamp } from '../../lib/time';
import { Checkbox, CloseIcon, downloadCsv, Roll, SearchBox, Segmented, Status, Tabs, Tick, toast, type Tone } from '../../components/ui';

type View = 'teams' | 'competitors' | 'guardians';
type Div = 'all' | 'in_person' | 'online';
type SortKey = 'team' | 'members' | 'status' | 'reg';

const STATUS_TONE: Record<Team['status'], Tone> = { confirmed: 'green', pending: 'amber', withdrawn: 'grey' };
const STATUS_LABEL: Record<Team['status'], string> = { confirmed: 'Confirmed', pending: 'Pending', withdrawn: 'Withdrawn' };

export function Roster() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [view, setView] = useState<View>('teams');
  const [div, setDiv] = useState<Div>('all');
  const [q, setQ] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'team', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [focus, setFocus] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const members = (t: Team) => db.competitors.filter((c) => c.teamId === t.id);
  const missing = (t: Team) => members(t).filter((c) => !c.waiverSignedAt).length;
  const live = (t: Team) => t.status !== 'withdrawn';
  const divOk = (t: Team) => div === 'all' || t.divisionId === div;
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  const teamRows = useMemo(() => {
    let rows = db.teams.filter((t) => divOk(t) && match([t.code, t.name, t.school, t.city, t.contactName, ...members(t).map((m) => `${m.publicId} ${m.name}`)].join(' ')));
    if (missingOnly) rows = rows.filter((t) => live(t) && missing(t) > 0);
    if (pendingOnly) rows = rows.filter((t) => t.status === 'pending');
    const key: Record<SortKey, (t: Team) => number | string> = {
      team: (t) => t.code,
      members: (t) => -missing(t) * 10 + members(t).length,
      status: (t) => ({ pending: 0, confirmed: 1, withdrawn: 2 })[t.status],
      reg: (t) => t.registeredAt,
    };
    const k = key[sort.key];
    return rows.slice().sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, div, q, missingOnly, pendingOnly, sort]);

  const compRows = useMemo(() => {
    const teams = new Map(db.teams.map((t) => [t.id, t]));
    let rows = db.competitors
      .map((c) => ({ c, t: teams.get(c.teamId)! }))
      .filter(({ c, t }) => t && divOk(t) && match([c.publicId, c.name, c.guardianName, t.name, t.school].join(' ')));
    if (missingOnly) rows = rows.filter(({ c, t }) => live(t) && !c.waiverSignedAt);
    if (pendingOnly) rows = rows.filter(({ t }) => t.status === 'pending');
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, div, q, missingOnly, pendingOnly]);

  const rowCount = view === 'teams' ? teamRows.length : compRows.length;
  const total = view === 'teams' ? db.teams.length : db.competitors.length;
  const liveTeams = db.teams.filter(live);
  const comps = db.competitors.filter((c) => liveTeams.some((t) => t.id === c.teamId));
  const signed = comps.filter((c) => c.waiverSignedAt).length;
  const confirmed = liveTeams.filter((t) => t.status === 'confirmed').length;
  const divCount = (d: Div) => (view === 'teams' ? db.teams.filter((t) => d === 'all' || t.divisionId === d).length : db.competitors.filter((c) => { const t = db.teams.find((x) => x.id === c.teamId)!; return d === 'all' || t.divisionId === d; }).length);

  // Keyboard: / search, j k move, x select, Enter open, Esc back out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, textarea, select')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = view === 'teams' ? teamRows.map((t) => t.id) : compRows.map((r) => r.t.id);
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'j' || e.key === 'k') {
        const n = Math.max(0, Math.min(ids.length - 1, focus + (e.key === 'j' ? 1 : -1)));
        setFocus(n);
        if (openTeam) setOpenTeam(ids[n]);
      } else if (e.key === 'x' && view === 'teams' && teamRows[focus]) toggle(teamRows[focus].id);
      else if (e.key === 'Enter' && ids[focus]) setOpenTeam(ids[focus]);
      else if (e.key === 'Escape') {
        if (openTeam) setOpenTeam(null);
        else setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.body.classList.toggle('has-bulk', selected.size > 0 && view === 'teams');
    return () => document.body.classList.remove('has-bulk');
  }, [selected, view]);

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

  const visibleLive = teamRows.filter(live);
  const selVisible = visibleLive.filter((t) => selected.has(t.id)).length;
  const allState: boolean | 'mixed' = selVisible === 0 ? false : selVisible === visibleLive.length ? true : 'mixed';
  const rowsKey = `${view}|${div}|${q}|${missingOnly}|${pendingOnly}|${sort.key}${sort.dir}`;

  const exportCsv = (teamIds?: Set<string>) => {
    const rows = db.competitors
      .filter((c) => !teamIds || teamIds.has(c.teamId))
      .map((c) => {
        const t = db.teams.find((x) => x.id === c.teamId)!;
        return [c.publicId, c.name, c.grade, t.code, t.name, t.divisionId, t.status, c.waiverSignedAt ? 'signed' : 'missing', c.guardianName, c.guardianEmail];
      });
    downloadCsv(teamIds ? 'sfmo-2027-selected.csv' : 'sfmo-2027-roster.csv', ['competitor_id', 'name', 'grade', 'team_code', 'team_name', 'division', 'status', 'waiver', 'guardian', 'guardian_email'], rows);
  };

  const SortH = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" className={`sort ${sort.key === k ? 'on' : ''} ${sort.key === k && sort.dir < 0 ? 'desc' : ''}`} onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'reg' ? -1 : 1 }))}>
      {children}
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 6.2L5 3.7l2.5 2.5" /></svg>
    </button>
  );

  const lastReg = db.teams.reduce((m, t) => (t.registeredAt > m ? t.registeredAt : m), '');

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Roster</span></div>
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <div className="meta">
            <span className="live"><i />Live</span>
            <span className="dot-sep" />
            <span>Registration {contest.registration.open ? 'open' : 'closed'}, closed {contest.registration.closesLabel}</span>
            <span className="dot-sep" />
            <span>Last registration {ago(lastReg)}</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => exportCsv()}>
            <svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" /></svg>Export CSV
          </button>
          <button className="btn btn-primary" type="button" onClick={() => toast('Add a team', 'Opens the registration form with every field, for teams registering by phone or email.')}>
            <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>Add team
          </button>
        </div>
      </div>

      <section className="stats panel">
        <div className="stat">
          <div className="stat-label">Teams</div>
          <div className="stat-value"><Roll value={liveTeams.length} /></div>
          <div className="stat-sub">{liveTeams.filter((t) => t.divisionId === 'in_person').length} in person · {liveTeams.filter((t) => t.divisionId === 'online').length} online · {db.teams.length - liveTeams.length} withdrawn</div>
        </div>
        <div className="stat">
          <div className="stat-label">Competitors</div>
          <div className="stat-value"><Roll value={comps.length} /></div>
          <div className="stat-sub">{(comps.length / Math.max(1, liveTeams.length)).toFixed(1)} per team, withdrawn excluded</div>
        </div>
        <div className="stat">
          <div className="stat-label">Waivers signed</div>
          <div className="stat-value"><Roll value={signed} /><span className="of">/ {comps.length}</span></div>
          <div className="bar"><i style={{ width: `${(signed / Math.max(1, comps.length)) * 100}%` }} /></div>
          <div className="stat-sub"><span className="warn-text">{comps.length - signed ? `${comps.length - signed} missing` : ''}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">Confirmed</div>
          <div className="stat-value"><Roll value={confirmed} /><span className="of">/ {liveTeams.length}</span></div>
          <div className="bar"><i style={{ width: `${(confirmed / Math.max(1, liveTeams.length)) * 100}%` }} /></div>
          <div className="stat-sub">{liveTeams.length - confirmed} pending</div>
        </div>
      </section>

      <div style={{ marginTop: 22 }}>
        <Tabs
          value={view}
          onChange={(v) => { setView(v); setFocus(-1); setOpenTeam(null); }}
          items={[
            { key: 'teams', label: 'Teams', count: db.teams.length },
            { key: 'competitors', label: 'Competitors', count: db.competitors.length },
            { key: 'guardians', label: 'Guardians', count: db.competitors.length },
          ]}
        />
      </div>

      <div className="toolbar">
        <Segmented
          label="Division"
          value={div}
          onChange={(d) => { setDiv(d); setFocus(-1); }}
          items={[
            { key: 'all', label: 'All', count: divCount('all') },
            { key: 'in_person', label: 'In person', count: divCount('in_person') },
            { key: 'online', label: 'Online', count: divCount('online') },
          ]}
        />
        <SearchBox value={q} onChange={(v) => { setQ(v); setFocus(-1); }} placeholder="Search names, schools, IDs" inputRef={searchRef} />
        <button className="chip-toggle" type="button" aria-pressed={missingOnly} onClick={() => setMissingOnly((x) => !x)}>Waiver missing</button>
        <button className="chip-toggle" type="button" aria-pressed={pendingOnly} onClick={() => setPendingOnly((x) => !x)}>Pending</button>
        <span className="spacer" />
        <span className="showing">Showing <b>{rowCount}</b> of {total} {view}</span>
      </div>

      <div className="panel table-wrap">
        <table className="t">
          <thead>
            {view === 'teams' ? (
              <tr>
                <th className="c-sel"><Checkbox checked={allState} label="Select all shown" onChange={() => setSelected((s) => { const n = new Set(s); visibleLive.forEach((t) => (allState === true ? n.delete(t.id) : n.add(t.id))); return n; })} /></th>
                <th><SortH k="team">Team</SortH></th>
                <th>Division</th>
                <th><SortH k="members">Members · waivers</SortH></th>
                <th>School · location</th>
                <th>Contact</th>
                <th><SortH k="status">Status</SortH></th>
                <th><SortH k="reg">Registered</SortH></th>
              </tr>
            ) : view === 'competitors' ? (
              <tr><th>ID</th><th>Name</th><th>Grade</th><th>Team</th><th>Division</th><th>Account</th><th>Waiver</th></tr>
            ) : (
              <tr><th>Guardian</th><th>Email</th><th>Signs for</th><th>Division</th><th>Waiver</th><th>Last contact</th></tr>
            )}
          </thead>
          <tbody key={rowsKey}>
            {rowCount === 0 && (
              <tr className="empty-row"><td colSpan={8}>Nothing matches. <button className="linkish" type="button" onClick={() => { setQ(''); setMissingOnly(false); setPendingOnly(false); }}>Clear search and filters</button></td></tr>
            )}
            {view === 'teams' &&
              teamRows.map((t, i) => (
                <tr
                  key={t.id}
                  className={`click enter ${selected.has(t.id) ? 'selected' : ''} ${!live(t) ? 'muted' : ''} ${openTeam === t.id ? 'open' : ''} ${focus === i ? 'focused' : ''}`}
                  style={{ ['--i' as string]: Math.min(i, 14) }}
                  onClick={() => { setFocus(i); setOpenTeam(t.id); }}
                >
                  <td className="c-sel">{live(t) && <Checkbox checked={selected.has(t.id)} label={`Select team ${t.code}`} onChange={() => toggle(t.id)} />}</td>
                  <td><span className="tid">{t.code}</span><span className="tname">{t.name}</span>{t.wantsTeammates && <span className="tag">Wants teammates</span>}</td>
                  <td>{contest.divisions.find((d) => d.id === t.divisionId)?.name}</td>
                  <td><Pips team={t} members={members(t)} /></td>
                  <td><span className="ellip">{t.school} <span className="sub">· {t.city}</span></span></td>
                  <td>{t.contactName}</td>
                  <td><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status></td>
                  <td className="mono sub">{day(t.registeredAt)}</td>
                </tr>
              ))}
            {view === 'competitors' &&
              compRows.map(({ c, t }, i) => {
                const account = db.users.find((u) => u.competitorId === c.id);
                return (
                  <tr key={c.id} className={`click enter ${!live(t) ? 'muted' : ''} ${focus === i ? 'focused' : ''}`} style={{ ['--i' as string]: Math.min(i, 14) }} onClick={() => { setFocus(i); setOpenTeam(t.id); }}>
                    <td className="mono">{c.publicId}</td>
                    <td className="tname">{c.name}</td>
                    <td className="mono sub">{c.grade}</td>
                    <td><span className="ellip">{t.name}</span></td>
                    <td>{contest.divisions.find((d) => d.id === t.divisionId)?.name}</td>
                    <td className="sub">{account ? (account.managed ? `username ${account.email}` : account.email) : 'invite not accepted'}</td>
                    <td>{c.waiverSignedAt ? <Status tone="green">Signed</Status> : <Status tone="amber">Missing</Status>}</td>
                  </tr>
                );
              })}
            {view === 'guardians' &&
              compRows.map(({ c, t }, i) => (
                <tr key={c.id} className={`click enter ${!live(t) ? 'muted' : ''} ${focus === i ? 'focused' : ''}`} style={{ ['--i' as string]: Math.min(i, 14) }} onClick={() => { setFocus(i); setOpenTeam(t.id); }}>
                  <td className="tname">{c.guardianName}</td>
                  <td className="sub">{c.guardianEmail}</td>
                  <td><span className="mono">{c.publicId}</span> <span className="sub">{c.name}</span></td>
                  <td>{contest.divisions.find((d) => d.id === t.divisionId)?.name}</td>
                  <td>{c.waiverSignedAt ? <Status tone="green">Signed</Status> : <Status tone="amber">Missing</Status>}</td>
                  <td className="mono sub">{c.waiverSignedAt ? day(c.waiverSignedAt) : c.reminderSentAt ? day(c.reminderSentAt) : '25 Nov'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="row-wrap sub" style={{ marginTop: 10, fontSize: 12, gap: 14 }}>
        <span><span className="kbd">/</span> search</span>
        <span><span className="kbd">j</span> <span className="kbd">k</span> move</span>
        <span><span className="kbd">x</span> select</span>
        <span><span className="kbd">↵</span> open</span>
        <span><span className="kbd">esc</span> close</span>
      </div>

      <TeamDrawer teamId={openTeam} onClose={() => setOpenTeam(null)} />

      <div className={`bulkbar ${selected.size && view === 'teams' ? 'show' : ''}`} role="toolbar" aria-label="Selected teams">
        <span className="n"><Roll value={selected.size || 1} plain /> selected</span>
        <button className="bb" type="button" onClick={() => {
          const pending = [...selected].filter((id) => db.teams.find((t) => t.id === id)?.status === 'pending');
          if (!pending.length) return toast('Nothing to confirm', 'Every selected team is already confirmed.');
          setTeamStatus(pending, 'confirmed', me.name);
          toast(`Confirmed ${pending.length} team${pending.length === 1 ? '' : 's'}`, 'Their confirmation emails are queued.', 'g');
        }}>Confirm</button>
        <button className="bb" type="button" onClick={() => toast('Email composer', `Opens Emails with ${selected.size} team contacts selected.`)}>Email contacts</button>
        <button className="bb" type="button" onClick={() => exportCsv(selected)}>Export CSV</button>
        <span className="bb-sep" />
        <button className="bb" type="button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
    </>
  );
}

function Pips({ team, members }: { team: Team; members: Competitor[] }) {
  const prev = useRef<Map<string, boolean>>(new Map());
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const m = members[i];
    if (!m) {
      cells.push(<span key={i} className="pip empty" aria-hidden="true" />);
      continue;
    }
    const was = prev.current.get(m.id);
    const pop = was === false && !!m.waiverSignedAt;
    cells.push(
      <span key={m.id} className={`pip ${m.waiverSignedAt ? 'ok' : 'miss'} ${pop ? 'pop' : ''}`} title={`${m.publicId} · ${m.name} · waiver ${m.waiverSignedAt ? 'signed' : 'missing'}`}>
        {m.slot}
      </span>,
    );
  }
  useEffect(() => {
    prev.current = new Map(members.map((m) => [m.id, !!m.waiverSignedAt]));
  });
  const miss = team.status !== 'withdrawn' ? members.filter((m) => !m.waiverSignedAt).length : 0;
  return (
    <>
      <span className="pips">{cells}</span>
      {miss > 0 && <span className="pip-note">{miss} missing</span>}
    </>
  );
}

function TeamDrawer({ teamId, onClose }: { teamId: string | null; onClose: () => void }) {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [resent, setResent] = useState<string | null>(null);
  const t = db.teams.find((x) => x.id === teamId);
  const members = t ? db.competitors.filter((c) => c.teamId === t.id) : [];
  const log = t ? db.activity.filter((a) => a.teamId === t.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const coach = t?.coachId ? db.users.find((u) => u.id === t.coachId) : undefined;
  const room = t ? contest.rooms.find((r) => r.teamIds.includes(t.id)) : undefined;

  return (
    <aside className={`drawer ${t ? 'open' : ''}`} aria-hidden={!t} aria-label="Team detail">
      {t && (
        <>
          <div className="drawer-head">
            <div className="drawer-top">
              <span className="drawer-code">Team {t.code} · join code {t.joinCode}</span>
              <button className="x" type="button" onClick={onClose}><span className="kbd">esc</span><CloseIcon /></button>
            </div>
            <h2>{t.name}</h2>
            <div className="drawer-chips">
              <Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status>
              <span>{contest.divisions.find((d) => d.id === t.divisionId)?.name}</span>
              <span className="dot-sep" />
              <span>{members.length} of {contest.registration.teamMax}</span>
            </div>
          </div>
          <div className="drawer-body" key={t.id}>
            <section>
              <h3>Members</h3>
              {members.map((m) => (
                <div className="mem" key={m.id}>
                  <span className="id">{m.publicId}</span>
                  <span className="who">{m.name}<small>Grade {m.grade} · guardian {m.guardianName}</small></span>
                  <span>
                    {m.waiverSignedAt ? (
                      <span className="ok-text row" style={{ fontSize: 12.5, gap: 5 }}><Tick />Signed {day(m.waiverSignedAt)}</span>
                    ) : t.status === 'withdrawn' ? (
                      <span className="sub" style={{ fontSize: 12.5 }}>Not needed</span>
                    ) : m.reminderSentAt ? (
                      <button className="btn btn-sm done" type="button" disabled><Tick draw />Reminder sent</button>
                    ) : (
                      <button className="btn btn-sm" type="button" onClick={() => { remindWaiver(m.id, me.name); toast('Reminder sent', `${m.guardianName} will get the waiver link for ${m.publicId} again.`); }}>Send reminder</button>
                    )}
                  </span>
                </div>
              ))}
            </section>
            <section>
              <h3>Registration</h3>
              <dl className="details">
                <dt>School</dt><dd>{t.school}</dd>
                <dt>Location</dt><dd>{t.city}</dd>
                <dt>Contact</dt><dd>{t.contactName}<br /><span className="sub">{t.contactEmail}</span></dd>
                <dt>Coach account</dt><dd>{coach ? `${coach.name} (${coach.email})` : <span className="sub">None, captain registered</span>}</dd>
                {room && (<><dt>Zoom room</dt><dd>{room.name}</dd></>)}
                {t.divisionId === 'online' && (<><dt>Distance</dt><dd>More than 100 miles, attested</dd></>)}
                <dt>Donation</dt><dd>{t.pledge ? `$${t.pledge} pledged` : <span className="sub">None pledged</span>}</dd>
              </dl>
            </section>
            <section>
              <h3>Activity</h3>
              <ul className="timeline">
                {log.map((a) => (
                  <li key={a.id} className={a.tone}>{a.text}<time>{stamp(a.at)}</time></li>
                ))}
              </ul>
            </section>
          </div>
          <div className="drawer-foot">
            {resent === t.id ? (
              <button className="btn done" type="button" disabled><Tick draw />Sent</button>
            ) : (
              <button className="btn" type="button" disabled={t.status === 'withdrawn'} onClick={() => { setResent(t.id); toast('Confirmation re-sent', `To ${t.contactEmail}.`, 'g'); }}>Resend confirmation</button>
            )}
            {t.status === 'pending' && <button className="btn btn-primary" type="button" onClick={() => setTeamStatus([t.id], 'confirmed', me.name)}>Confirm team</button>}
          </div>
        </>
      )}
    </aside>
  );
}
