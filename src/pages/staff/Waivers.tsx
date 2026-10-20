import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { modeOf, usesWaivers } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import type { Competitor, Team } from '../../lib/model';
import { normEmail } from '../../lib/people';
import { markPaper, sendWaiverReminders, undoWaiver, waiverHow } from '../../lib/people-actions';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { day, stamp } from '../../lib/time';
import { ArtEmpty } from '../../components/art';
import { Ring } from '../../components/charts';
import { Icon } from '../../components/icons';
import { downloadCsv, ModeChip, Roll, SearchBox, toast } from '../../components/ui';
import { StudentDrawer, TeamDrawer, useConfirm } from './PeopleParts';
import '../../styles/people.css';
import '../../styles/dayof.css';

type Row = { c: Competitor; t: Team };

/** Where the organisers enter every team, they collected waivers themselves: MathCloud stays out of it. */
export function Waivers() {
  const contest = useContest();
  if (!usesWaivers(contest)) {
    return (
      <div className="stack-lg">
        <div className="page-head"><div><h1 className="page-title">Waivers</h1><p className="page-sub">Not used for {contest.short}.</p></div></div>
        <section className="card stack" style={{ maxWidth: 640 }}>
          <b>You collected waivers with your own sign-up</b>
          <p className="soft" style={{ margin: 0 }}>
            The organisers enter every team for this contest, so MathCloud sends no waiver links or reminders and checks nothing about waivers. To have
            guardians sign online instead, let coaches register: Settings, Teams.
          </p>
          <div><Link className="btn" to="/staff/settings"><Icon name="settings" />Settings</Link></div>
        </section>
      </div>
    );
  }
  return <WaiversPage />;
}

function WaiversPage() {
  const db = useDB();
  const contest = useContest();
  const me = useUser()!;
  const [ask, confirmNode] = useConfirm();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [sendingAll, setSendingAll] = useState(false);
  const [allSigned, setAllSigned] = useState(false);
  const [student, setStudent] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);

  const liveTeams = useMemo(() => db.teams.filter((t) => t.status !== 'withdrawn').sort((a, b) => a.code.localeCompare(b.code)), [db]);
  const rows: Row[] = useMemo(() => {
    const byId = new Map(liveTeams.map((t) => [t.id, t]));
    return db.competitors.filter((c) => byId.has(c.teamId)).map((c) => ({ c, t: byId.get(c.teamId)! })).sort((a, b) => a.c.publicId.localeCompare(b.c.publicId));
  }, [db, liveTeams]);
  const signed = rows.filter(({ c }) => c.waiverSignedAt);
  const missing = rows.filter(({ c }) => !c.waiverSignedAt);
  const reachable = missing.filter(({ c }) => normEmail(c.guardianEmail));
  const teamsMissing = new Set(missing.map(({ t }) => t.id)).size;
  const reminded = missing.filter(({ c }) => c.reminderSentAt).length;

  const needle = q.trim().toLowerCase();
  const match = ({ c, t }: Row) => !needle || [c.publicId, c.name, c.guardianName, c.guardianEmail, t.code, t.name].join(' ').toLowerCase().includes(needle);

  const remind = async (ids: string[]) => {
    const r = await sendWaiverReminders(ids, me.name);
    if (r.error) return toast('Reminders not sent', r.error, 'r');
    const parts = [r.sent ? `${r.sent} sent` : '', r.waiting ? `${r.waiting} wait for tomorrow’s sending limit` : '', r.skipped ? `${r.skipped} skipped, no guardian email` : ''].filter(Boolean);
    toast(ids.length === 1 ? 'Reminder sent' : `${ids.length - r.skipped} reminders`, parts.join(' · ') || 'Already sent today.', 'g');
  };
  const remindOne = async (id: string) => {
    setBusy((s) => new Set(s).add(id));
    await remind([id]);
    setBusy((s) => { const n = new Set(s); n.delete(id); return n; });
  };
  const remindAll = () => ask({
    title: `Email ${reachable.length} ${reachable.length === 1 ? 'guardian' : 'guardians'}?`, label: `Send ${reachable.length} reminders`,
    body: (
      <p>
        Each guardian gets their own link to sign for their child. {missing.length - reachable.length > 0 && <><b>{missing.length - reachable.length}</b> {missing.length - reachable.length === 1 ? 'student has' : 'students have'} no guardian email and {missing.length - reachable.length === 1 ? 'is' : 'are'} skipped. </>}
        Guardians already reminded today are not emailed twice.
      </p>
    ),
    run: async () => { setSendingAll(true); await remind(reachable.map(({ c }) => c.id)); setSendingAll(false); },
  });

  const exportCsv = () => downloadCsv(`${contest.slug}-waivers.csv`,
    ['competitor_id', 'name', 'team_code', 'team', 'mode', 'guardian', 'guardian_email', 'status', 'signed_at', 'signed_by', 'how', 'last_reminder'],
    rows.map(({ c, t }) => {
      const h = c.waiverSignedAt ? waiverHow(c) : null;
      return [c.publicId, c.name, t.code, t.name, modeOf(contest, t), c.guardianName, c.guardianEmail, c.waiverSignedAt ? 'signed' : 'missing', c.waiverSignedAt ?? '', h?.who ?? '', h?.how ?? '', c.reminderSentAt ?? ''];
    }));

  const perTeam = liveTeams
    .map((t) => ({ t, list: rows.filter((r) => r.t.id === t.id).map((r) => r.c) }))
    .filter((x) => x.list.length)
    .sort((a, b) => b.list.filter((c) => !c.waiverSignedAt).length - a.list.filter((c) => !c.waiverSignedAt).length || a.t.code.localeCompare(b.t.code));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Waivers</h1>
          <p className="page-sub">{missing.length ? `${missing.length} missing on ${teamsMissing} ${teamsMissing === 1 ? 'team' : 'teams'}. Every student needs one signed by a parent or guardian before the contest.` : rows.length ? `All ${rows.length} signed. Nothing to chase.` : 'Every student needs one signed by a parent or guardian before the contest.'}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" disabled={!rows.length} onClick={exportCsv} title="Download every waiver as a CSV"><Icon name="download" />Export</button>
          {missing.length > 0 && <button className="btn btn-primary" type="button" disabled={!reachable.length || sendingAll} onClick={remindAll} title={reachable.length ? undefined : 'No guardian email for anyone missing'}><Icon name="mail" />{sendingAll ? 'Sending' : `Email ${reachable.length} ${reachable.length === 1 ? 'guardian' : 'guardians'}`}</button>}
        </div>
      </div>

      {!rows.length ? (
        <section className="card pp-empty">
          <ArtEmpty kind="waivers" className="pp-art" />
          <div className="stack" style={{ gap: 6 }}><h2>No students yet</h2><p>Each student’s guardian gets a waiver link when the team registers. Their progress shows here.</p></div>
          <div className="row"><Link className="btn btn-primary" to="/staff/teams">Go to Teams</Link></div>
        </section>
      ) : (
        <div className="stack-lg">
          <div className="pp-wv-top">
            <section className="card pp-wv-ring">
              <Ring value={signed.length} total={rows.length} size={104} tone={missing.length ? 'amber' : 'green'} label={`${signed.length} of ${rows.length} waivers signed`} />
              <div className="stack" style={{ gap: 4 }}>
                <span className="label">Signed</span>
                <b className="pp-big"><Roll value={signed.length} /> <span className="muted">of {rows.length}</span></b>
                <span className="soft small">{missing.length ? `${missing.length} missing · ${reminded} reminded` : 'All in. Nothing to chase.'}</span>
                {missing.length - reachable.length > 0 && <span className="wait small">{missing.length - reachable.length} with no guardian email</span>}
              </div>
            </section>
            <section className="card stack">
              <span className="label">By division</span>
              {contest.divisions.map((d) => {
                const list = rows.filter((r) => r.t.divisionId === d.id);
                const s = list.filter((r) => r.c.waiverSignedAt).length;
                return (
                  <div key={d.id} className="pp-div">
                    <div className="row"><ModeChip mode={d.mode}>{d.name}</ModeChip><span className="grow" /><span className="small"><b>{s}</b> <span className="muted">of {list.length}</span></span></div>
                    <Bar signed={s} total={list.length} label={`${d.name}: ${s} of ${list.length} signed`} />
                  </div>
                );
              })}
              <div className="row tiny muted pp-legend"><i className="sw ok" />Signed<i className="sw wait" />Missing</div>
            </section>
          </div>

          <section className="card">
            <div className="section-head">
              <h2 className="row" style={{ gap: 8 }}><Icon name="roster" size={16} className="muted" />By team</h2>
              <span className="muted small hide-sm">One mark per student, most missing first. Click a team to open it.</span>
            </div>
            <div className="pp-teams">
              {perTeam.map(({ t, list }) => {
                const miss = list.filter((c) => !c.waiverSignedAt).length;
                return (
                  <button key={t.id} type="button" className="pp-teamrow" onClick={() => setTeam(t.id)} title={`${t.name}: ${list.length - miss} of ${list.length} signed`}>
                    <span className="mono muted">{t.code}</span>
                    <span className="pp-teamname">{t.name}</span>
                    <span className="pp-pips" aria-hidden="true">
                      {list.map((c) => <i key={c.id} className={c.waiverSignedAt ? 'ok' : 'wait'} title={`${c.publicId} ${c.name}: ${c.waiverSignedAt ? 'signed' : 'missing'}`} />)}
                    </span>
                    {miss ? <span className="small wait">{miss} missing</span> : <span className="small pp-done"><Icon name="check" size={13} />Done</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {missing.length > 0 && <section className="card flush">
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}><Icon name="alert" size={16} className="wait" />Missing <span className="muted">{missing.length}</span></h2>
              <SearchBox value={q} onChange={setQ} placeholder="Student, team, guardian" />
            </div>
            <div className="table-scroll">
              <table className="t">
                <thead><tr><th>Student</th><th>Team</th><th>Guardian</th><th>Guardian email</th><th>Last reminder</th><th /></tr></thead>
                <tbody>
                  {!missing.filter(match).length && <tr className="empty"><td colSpan={6}>Nobody matches.</td></tr>}
                  {missing.filter(match).map(({ c, t }) => (
                    <tr key={c.id}>
                      <td><button type="button" className="linkbtn pp-plain" onClick={() => setStudent(c.id)}><span className="mono muted">{c.publicId}</span> <b style={{ fontWeight: 550 }}>{c.name}</b></button></td>
                      <td className="soft"><span className="ellipsis">{t.name}</span></td>
                      <td className="soft">{c.guardianName || <span className="muted">–</span>}</td>
                      <td>{c.guardianEmail ? <span className="soft">{c.guardianEmail}</span> : <button type="button" className="linkbtn" onClick={() => setStudent(c.id)}>Add email</button>}</td>
                      <td className="muted">{c.reminderSentAt ? stamp(c.reminderSentAt) : 'Never'}</td>
                      <td className="num">
                        <span className="pp-acts" style={{ gap: 6 }}>
                          <span className="pp-acts pp-fade"><button className="icon-btn" type="button" aria-label={`Record a paper waiver for ${c.name}`} title="Record a signed paper copy" onClick={() => { markPaper(c.id, me.name); toast(`Paper waiver recorded for ${c.publicId}`, undefined, 'g'); }}><Icon name="file" size={15} /></button></span>
                          <button className="btn btn-sm" type="button" disabled={!c.guardianEmail || busy.has(c.id)} onClick={() => void remindOne(c.id)}><Icon name="send" size={13} />{busy.has(c.id) ? 'Sending' : 'Remind'}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>}

          <section className="card flush wv-signed">
            <div className="card-head"><h2 className="row" style={{ gap: 8 }}><Icon name="check-circle" size={16} className="ok" />Signed <span className="muted">{signed.length}</span></h2>{!missing.length && <SearchBox value={q} onChange={setQ} placeholder="Student, team, guardian" />}</div>
            <div className="table-scroll">
              <table className="t">
                <thead><tr><th>Student</th><th>Team</th><th>Signed by</th><th>When</th><th>How</th><th /></tr></thead>
                <tbody>
                  {!signed.length && <tr className="empty"><td colSpan={6}>None yet.</td></tr>}
                  {signed.filter(match).slice(0, allSigned || needle ? undefined : 12).map(({ c, t }, i) => {
                    const h = waiverHow(c);
                    return (
                      <tr key={c.id} className={i >= 12 && !needle ? 'pp-more' : ''}>
                        <td><button type="button" className="linkbtn pp-plain" onClick={() => setStudent(c.id)}><span className="mono muted">{c.publicId}</span> <b style={{ fontWeight: 550 }}>{c.name}</b></button></td>
                        <td className="soft"><span className="ellipsis">{t.name}</span></td>
                        <td>{h.who}</td>
                        <td className="muted">{day(c.waiverSignedAt!)}</td>
                        <td className="soft">{h.how}</td>
                        <td className="num"><span className="pp-acts pp-fade"><button className="icon-btn" type="button" aria-label={`Take back the waiver for ${c.name}`} title="Take the waiver back" onClick={() => ask({
                          title: `Take back the waiver for ${c.name}?`, label: 'Take it back', danger: true,
                          body: <p>The record that {h.who} signed on {day(c.waiverSignedAt!)} is cleared and {c.name} shows as missing again. Their guardian would need to sign again.</p>,
                          run: () => { undoWaiver(c.id, me.name); toast(`Waiver for ${c.publicId} taken back`, 'It shows as missing again.'); },
                        })}><Icon name="undo" size={15} /></button></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!needle && signed.length > 12 && (
              <div className="card-foot"><span className="muted small">{allSigned ? `All ${signed.length}` : `First 12 of ${signed.length}; search finds anyone`}</span><button className="btn btn-sm" type="button" onClick={() => setAllSigned((x) => !x)}><Icon name="chevron" size={14} className={allSigned ? 'pp-chev open' : 'pp-chev'} />{allSigned ? 'Show fewer' : `Show all ${signed.length}`}</button></div>
            )}
          </section>
        </div>
      )}
      {confirmNode}
      <StudentDrawer id={student} onClose={() => setStudent(null)} onOpenTeam={(id) => { setStudent(null); setTeam(id); }} />
      <TeamDrawer id={team} onClose={() => setTeam(null)} />
    </>
  );
}

/** Signed and missing as one bar, with a 2px gap between the parts. */
function Bar({ signed, total, label }: { signed: number; total: number; label: string }) {
  const share = total ? signed / total : 0;
  return (
    <span className="pp-bar" role="img" aria-label={label} title={label}>
      {signed > 0 && <i className="ok" style={{ flexGrow: share }} />}
      {total - signed > 0 && <i className="wait" style={{ flexGrow: 1 - share }} />}
      {!total && <i className="none" style={{ flexGrow: 1 }} />}
    </span>
  );
}
