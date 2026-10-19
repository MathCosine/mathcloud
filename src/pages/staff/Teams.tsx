import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteTeam, modeOf, setTeamStatus } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Team } from '../../lib/model';
import { rosterHealth } from '../../lib/people';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { day } from '../../lib/time';
import { ArtEmpty } from '../../components/art';
import { Icon } from '../../components/icons';
import { Checkbox, downloadCsv, ModeChip, SearchBox, Segmented, State, toast } from '../../components/ui';
import { STATUS, TeamDrawer, useConfirm } from './PeopleParts';
import '../../styles/people.css';
import '../../styles/dayof.css';

type SortKey = 'team' | 'size' | 'waivers' | 'status' | 'reg';

export function Teams() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const navigate = useNavigate();
  const [ask, confirmNode] = useConfirm();
  const [div, setDiv] = useState<string>('all');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [hideWithdrawn, setHideWithdrawn] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'team', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState(-1);
  const search = useRef<HTMLInputElement>(null);

  const byTeam = useMemo(() => {
    const m = new Map<string, typeof db.competitors>();
    for (const c of db.competitors) m.set(c.teamId, [...(m.get(c.teamId) ?? []), c]);
    return m;
  }, [db]);
  const members = (t: Team) => byTeam.get(t.id) ?? [];
  const missing = (t: Team) => members(t).filter((c) => !c.waiverSignedAt).length;
  const live = (t: Team) => t.status !== 'withdrawn';
  const health = useMemo(() => rosterHealth(db.teams, db.competitors, contest.registration), [db, contest.registration]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = db.teams.filter((t) => (div === 'all' || t.divisionId === div)
      && (!needle || [t.code, t.name, t.school, t.city, t.contactName, t.contactEmail, ...members(t).map((m) => `${m.publicId} ${m.name}`)].join(' ').toLowerCase().includes(needle)));
    if (onlyMissing) list = list.filter((t) => live(t) && missing(t) > 0);
    if (onlyPending) list = list.filter((t) => t.status === 'pending');
    if (hideWithdrawn) list = list.filter(live);
    const key: Record<SortKey, (t: Team) => string | number> = {
      team: (t) => t.code,
      size: (t) => members(t).length,
      waivers: (t) => -missing(t),
      status: (t) => ({ pending: 0, confirmed: 1, withdrawn: 2 })[t.status],
      reg: (t) => t.registeredAt,
    };
    const k = key[sort.key];
    return list.slice().sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, div, q, onlyMissing, onlyPending, hideWithdrawn, sort]);

  const liveTeams = db.teams.filter(live);
  const liveIds = new Set(liveTeams.map((t) => t.id));
  const comps = db.competitors.filter((c) => liveIds.has(c.teamId));
  const pendingCount = liveTeams.filter((t) => t.status === 'pending').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim')) return;
      if (e.key === '/') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'j' || e.key === 'k') {
        const n = Math.max(0, Math.min(rows.length - 1, focus + (e.key === 'j' ? 1 : -1)));
        setFocus(n);
        if (open && rows[n]) setOpen(rows[n].id);
      } else if (e.key === 'x' && rows[focus]) toggle(rows[focus].id);
      else if (e.key === 'Enter' && rows[focus]) setOpen(rows[focus].id);
      else if (e.key === 'Escape' && !open) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.body.classList.toggle('has-bulk', selected.size > 0);
    return () => document.body.classList.remove('has-bulk');
  }, [selected]);

  // Teams deleted elsewhere drop out of the selection.
  useEffect(() => {
    if ([...selected].some((id) => !db.teams.some((t) => t.id === id))) setSelected((s) => new Set([...s].filter((id) => db.teams.some((t) => t.id === id))));
  }, [db, selected]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const picked = rows.filter((t) => selected.has(t.id)).length;
  const allState: boolean | 'mixed' = picked === 0 ? false : picked === rows.length ? true : 'mixed';

  const exportCsv = (only?: Set<string>) =>
    downloadCsv(
      `${contest.slug}-roster.csv`,
      ['competitor_id', 'name', 'grade', 'team_code', 'team', 'division', 'mode', 'status', 'school', 'city', 'contact', 'contact_email', 'waiver', 'guardian', 'guardian_email'],
      db.competitors
        .filter((c) => !only || only.has(c.teamId))
        .map((c) => {
          const t = db.teams.find((x) => x.id === c.teamId)!;
          return [c.publicId, c.name, c.grade || '', t.code, t.name, contest.divisions.find((d) => d.id === t.divisionId)?.name, modeOf(contest, t), t.status, t.school, t.city, t.contactName, t.contactEmail, c.waiverSignedAt ? 'signed' : 'missing', c.guardianName, c.guardianEmail];
        }),
    );

  const bulkStatus = (status: Team['status'], verb: string) => {
    const ids = [...selected].filter((id) => db.teams.find((t) => t.id === id)?.status !== status);
    if (!ids.length) return toast(`Already ${verb}`, `Every selected team is ${verb}.`);
    setTeamStatus(ids, status, me.name);
    toast(`${verb[0].toUpperCase()}${verb.slice(1)} ${ids.length} ${ids.length === 1 ? 'team' : 'teams'}`, undefined, status === 'confirmed' ? 'g' : '');
  };

  const bulkDelete = () => {
    const ids = [...selected];
    const n = db.competitors.filter((c) => ids.includes(c.teamId)).length;
    ask({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'team' : 'teams'}?`, label: 'Delete', danger: true,
      body: <p>This removes {ids.length === 1 ? 'the team' : 'the teams'} and {n} {n === 1 ? 'student' : 'students'}, with their answers. It cannot be undone. Withdrawing keeps the record.</p>,
      run: () => {
        ids.forEach((id) => deleteTeam(id, me.name));
        setSelected(new Set());
        setOpen(null);
        toast(`Deleted ${ids.length} ${ids.length === 1 ? 'team' : 'teams'}`);
      },
    });
  };

  const Sort = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" className={`sort ${sort.key === k ? 'on' : ''} ${sort.key === k && sort.dir < 0 ? 'desc' : ''}`} onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'reg' ? -1 : 1 }))}>
      {children}
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 6.2L5 3.7l2.5 2.5" /></svg>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-sub">
            {liveTeams.length} teams · {comps.length} students{pendingCount ? ` · ${pendingCount} pending` : ''} · registration {contest.registration.open ? `open, closes ${contest.registration.closesLabel}` : `closed ${contest.registration.closesLabel}`}
            {health.total > 0 && <> · <Link to="/staff/people?tab=check">{health.total} roster {health.total === 1 ? 'issue' : 'issues'}</Link></>}
          </p>
        </div>
        <div className="actions">
          <button className="btn" type="button" disabled={!db.teams.length} onClick={() => exportCsv()}>Export CSV</button>
          <button className="btn" type="button" onClick={() => navigate('/staff/import')}><Icon name="upload" />Import</button>
          <button className="btn btn-primary" type="button" onClick={() => navigate(`/register/${contest.slug}`)}><Icon name="plus" />Add team</button>
        </div>
      </div>

      {db.teams.length === 0 ? (
        <section className="card pp-empty">
          <ArtEmpty kind="teams" className="pp-art" />
          <div className="stack" style={{ gap: 8 }}>
            <h2>No teams yet</h2>
            <p className="soft">Teams arrive two ways and both land here: coaches fill in your registration form, or you import the people who signed up somewhere else.</p>
            <div className="row wrap" style={{ marginTop: 6 }}>
              <button className="btn btn-primary" type="button" onClick={() => navigate(`/register/${contest.slug}`)}><Icon name="link" />Open the registration form</button>
              <button className="btn" type="button" onClick={() => navigate('/staff/import')}><Icon name="upload" />Import a spreadsheet</button>
            </div>
          </div>
        </section>
      ) : (
        <section className="card flush">
          <div className="toolbar pp-toolbar">
            {contest.divisions.length > 1 && (
              <Segmented label="Division" value={div} onChange={(d) => { setDiv(d); setFocus(-1); }} items={[{ key: 'all', label: 'All' }, ...contest.divisions.map((d) => ({ key: d.id, label: d.name }))]} />
            )}
            <SearchBox value={q} onChange={(v) => { setQ(v); setFocus(-1); }} placeholder="Search teams, students, IDs" inputRef={search} />
            <button type="button" className="filter" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((x) => !x)}>Waiver missing</button>
            <button type="button" className="filter" aria-pressed={onlyPending} onClick={() => setOnlyPending((x) => !x)}>Pending</button>
            <button type="button" className="filter" aria-pressed={hideWithdrawn} onClick={() => setHideWithdrawn((x) => !x)}>Hide withdrawn</button>
            <span className="grow" />
            <span className="muted small hide-sm" title="Keyboard: / search, j and k move, x selects, Enter opens">{rows.length} shown</span>
          </div>
          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th className="w-check"><Checkbox checked={allState} label="Select all shown" onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((t) => (allState === true ? n.delete(t.id) : n.add(t.id))); return n; })} /></th>
                  <th><Sort k="team">Team</Sort></th>
                  {contest.divisions.length > 1 && <th>Takes part</th>}
                  <th className="num"><Sort k="size">Students</Sort></th>
                  <th><Sort k="waivers">Waivers</Sort></th>
                  <th>Contact</th>
                  <th><Sort k="status">Status</Sort></th>
                  <th className="num"><Sort k="reg">Registered</Sort></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr className="empty"><td colSpan={8}>Nothing matches. <button className="linkbtn" type="button" onClick={() => { setQ(''); setOnlyMissing(false); setOnlyPending(false); setHideWithdrawn(false); setDiv('all'); }}>Clear filters</button></td></tr>
                )}
                {rows.map((t, i) => {
                  const miss = missing(t);
                  const n = members(t).length;
                  const off = n > contest.registration.teamMax || n < contest.registration.teamMin;
                  return (
                    <tr key={t.id} className={`click ${selected.has(t.id) ? 'selected' : ''} ${!live(t) ? 'dim' : ''} ${open === t.id || focus === i ? 'current' : ''}`} onClick={() => { setFocus(i); setOpen(t.id); }}>
                      <td className="w-check"><Checkbox checked={selected.has(t.id)} label={`Select ${t.name}`} onChange={() => toggle(t.id)} /></td>
                      <td><span className="code">{t.code}</span><span className="name">{t.name}</span><div className="muted tiny pp-sub">{t.school}{t.city ? `, ${t.city}` : ''}</div></td>
                      {contest.divisions.length > 1 && <td><ModeChip mode={modeOf(contest, t)} /></td>}
                      <td className={`num ${off && live(t) ? 'wait' : 'soft'}`}>{n}</td>
                      <td>{!live(t) || !n ? <span className="muted">–</span> : <WaiverMark list={members(t)} miss={miss} />}</td>
                      <td className="soft"><span className="ellipsis">{t.contactName}</span></td>
                      <td><State tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</State></td>
                      <td className="num muted">{day(t.registeredAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TeamDrawer id={open} onClose={() => setOpen(null)} />
      {confirmNode}

      <div className={`bulk ${selected.size ? 'show' : ''}`} role="toolbar" aria-label="Selected teams">
        <span className="n">{selected.size || 1} selected</span>
        <button type="button" onClick={() => bulkStatus('confirmed', 'confirmed')}>Confirm</button>
        <button type="button" onClick={() => bulkStatus('pending', 'pending')}>Mark pending</button>
        <button type="button" onClick={() => bulkStatus('withdrawn', 'withdrawn')}>Withdraw</button>
        <button type="button" onClick={() => exportCsv(selected)}>Export</button>
        <button type="button" className="pp-bulk-danger" onClick={bulkDelete}>Delete</button>
        <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
    </>
  );
}

/** One dot per student: filled when their waiver is in, hollow amber when not. */
function WaiverMark({ list, miss }: { list: { id: string; waiverSignedAt: string | null }[]; miss: number }) {
  return (
    <span className="tm-wv" title={miss ? `${miss} of ${list.length} waivers missing` : `All ${list.length} waivers signed`}>
      <span className="pp-pips" aria-hidden="true">{list.map((c) => <i key={c.id} className={c.waiverSignedAt ? 'ok' : 'wait'} />)}</span>
      {miss ? <span className="wait">{miss} missing</span> : <span className="tm-wv-n">{list.length}/{list.length}</span>}
    </span>
  );
}
