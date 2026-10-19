import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useContest, useStandings, ordinal } from '../../lib/hooks';
import { useDB, REMOTE } from '../../lib/store';
import {
  addressesFor, buildReports, capacityToday, countMessages, orgOf, reportState, sendReports,
  type Bar, type Report, type SendState, type StudentReport, type TeamReport, type Who,
} from '../../lib/reports';
import { Histogram } from '../../components/charts';
import { ArtEmpty } from '../../components/art';
import { Icon } from '../../components/icons';
import { Checkbox, ModeChip, Modal, SearchBox, Segmented, State, Tabs, toast, type Tone } from '../../components/ui';
import { CertificatesPanel } from './Certificates';
import { usePrint } from './print';
import '../../styles/reports.css';

type Tab = 'students' | 'teams' | 'certificates';

export function Reports() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('students');
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const { students, teams } = useMemo(() => buildReports(contest, standings, db), [contest, standings, db]);
  const computed = students.some((s) => s.place !== null) || teams.length > 0;
  const toRule = Object.values(standings.unreviewed).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            {!computed ? 'A one-page score report for every student and team, and certificates, once papers are graded.'
              : contest.resultsPublished ? <>{students.length} student and {teams.length} team reports, ready to email or print.</>
              : <>{students.length} student and {teams.length} team reports to preview and print. Publish results to email them.</>}
          </p>
        </div>
        <div className="actions" ref={setSlot} />
      </div>

      {!computed ? (
        <div className="card rp-empty">
          <ArtEmpty kind="results" />
          <div className="grow">
            <h2>No scores yet</h2>
            <p className="soft">Reports fill in once papers are keyed in and graded. Each student gets their place, round scores and every problem; each team its rounds and members.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/staff/grading')}>Open Grading</button>
        </div>
      ) : (
        <>
          {(!contest.resultsPublished || toRule > 0) && (
            <div className="note amber rp-note">
              <b>Before you email reports</b>
              <ul className="rp-todo">
                {toRule > 0 && <li>{toRule} {toRule === 1 ? 'answer needs' : 'answers need'} a ruling in <Link to="/staff/grading">Grading</Link>. Until then {toRule === 1 ? 'it counts' : 'they count'} as wrong here.</li>}
                {!contest.resultsPublished && <li>Results are not published. <Link to="/staff/results">Publish them on Results</Link> when the scores are final; until then reports can be previewed and printed only.</li>}
              </ul>
            </div>
          )}
          <Tabs value={tab} onChange={setTab} items={[
            { key: 'students', label: 'Students', count: students.length },
            { key: 'teams', label: 'Teams', count: teams.length },
            { key: 'certificates', label: 'Certificates' },
          ]} />
          {tab === 'students' && <ReportList key="s" reports={students} kind="student" slot={slot} />}
          {tab === 'teams' && <ReportList key="t" reports={teams} kind="team" slot={slot} />}
          {tab === 'certificates' && <CertificatesPanel slot={slot} />}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ the list

const STATE: Record<SendState, [Tone, string]> = {
  none: ['off', 'Not sent'],
  sent: ['ok', 'Sent'],
  queued: ['wait', 'Waiting'],
  failed: ['bad', 'Failed'],
  partial: ['wait', 'Partly sent'],
};
const WHO_LABEL: Record<Who, string> = { guardians: 'Guardians', students: 'Students', coaches: 'Coaches' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmt = (n: number) => String(Math.round(n * 100) / 100);

function ReportList({ reports, kind, slot }: { reports: Report[]; kind: 'student' | 'team'; slot: HTMLElement | null }) {
  const db = useDB();
  const contest = useContest();
  const [q, setQ] = useState('');
  const [div, setDiv] = useState('all');
  const [who, setWho] = useState<Record<Who, boolean>>(kind === 'student' ? { guardians: true, students: true, coaches: false } : { guardians: false, students: false, coaches: true });
  const [selId, setSelId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [resend, setResend] = useState(false);
  const [busy, setBusy] = useState(false);
  const { print, portal } = usePrint();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return reports.filter((r) => (div === 'all' || r.divisionId === div) && (!s || `${r.name} ${r.key} ${r.kind === 'student' ? r.team?.name ?? '' : r.school}`.toLowerCase().includes(s)));
  }, [reports, q, div]);
  const sel = shown.find((r) => r.id === selId) ?? shown[0];
  const counts = countMessages(db, shown, who, resend);
  const canSend = contest.resultsPublished && shown.length > 0;
  const whoOn = (Object.keys(who) as Who[]).filter((k) => who[k]);
  const filtered = shown.length !== reports.length;

  const send = async () => {
    setBusy(true);
    const r = await sendReports(db, shown, who, resend);
    setBusy(false);
    setAsking(false);
    setResend(false);
    if (r.error) return toast('Some reports did not go out', r.error, 'r');
    if (!r.count) return toast('Nothing to send', 'Everyone on this list already has their report.');
    toast(`${r.sent} sent${r.waiting ? `, ${r.waiting} waiting` : ''}`, r.waiting ? 'The rest go out tomorrow, when the daily limit resets.' : undefined, r.waiting ? 'a' : 'g');
  };

  return (
    <>
      {slot && createPortal(
        <>
          <button className="btn" type="button" disabled={!shown.length} onClick={() => print(shown.map((r) => <ReportSheet key={r.id} r={r} />))} title="One page per report; save as PDF from the print dialog">
            <Icon name="file" />Print {filtered ? '' : 'all '}{shown.length}
          </button>
          <button className="btn btn-primary" type="button" disabled={!canSend} title={!contest.resultsPublished ? 'Publish results first' : undefined} onClick={() => setAsking(true)}>
            <Icon name="mail" />Send {shown.length} {kind === 'student' ? 'student' : 'team'} reports
          </button>
        </>,
        slot,
      )}
      <div className="toolbar rp-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={kind === 'student' ? 'Name, ID or team' : 'Team, code or school'} />
        {contest.divisions.length > 1 && (
          <Segmented label="Division" value={div} onChange={setDiv} items={[{ key: 'all', label: 'All' }, ...contest.divisions.map((d) => ({ key: d.id, label: d.name }))]} />
        )}
        <span className="grow" />
        <span className="muted small">{counts.again > 0 ? <>{counts.again} sent, {counts.fresh} to go</> : contest.resultsPublished ? <>None emailed yet</> : null}</span>
      </div>

      <div className="rp-grid">
        <div className="card flush rp-list">
          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr><th className="num" style={{ width: 52 }}>Place</th><th>{kind === 'student' ? 'Student' : 'Team'}</th><th className="num">{kind === 'student' ? 'Score' : 'Total'}</th><th>Last sent</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr className="empty"><td colSpan={4}>Nobody matches.</td></tr>}
                {shown.map((r) => {
                  const addrs = addressesFor(r, who);
                  const st = reportState(db.sends, r, addrs);
                  const [tone, word] = STATE[st.state];
                  return (
                    <tr key={r.id} className={`click ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => setSelId(r.id)}>
                      <td className="num strong">{r.place ? ordinal(r.place) : '–'}</td>
                      <td>
                        <div className="name">{r.name}</div>
                        <div className="muted tiny"><span className="mono">{r.key}</span> · {r.kind === 'student' ? r.team?.name : r.school}</div>
                      </td>
                      <td className="num">{r.kind === 'student' ? (r.place ? `${fmt(r.score)}/${fmt(r.max)}` : '–') : fmt(r.total)}</td>
                      <td title={st.error ?? addrs.map((a) => a.to).join(', ')}>
                        {addrs.length ? <State tone={tone}>{word}{st.at && st.state !== 'none' ? ` ${shortDate(st.at)}` : ''}</State> : <span className="muted small">No address</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack rp-preview">
          {sel && (
            <>
              <div className="row wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">
                  {addressesFor(sel, who).length ? <>Goes to {addressesFor(sel, who).map((a) => a.to).join(', ')}</> : 'Nobody ticked has an address for this report.'}
                </span>
                <button className="btn btn-sm" type="button" onClick={() => print(<ReportSheet r={sel} />)} title="Save as PDF from the print dialog"><Icon name="file" />Print this one</button>
              </div>
              <ReportSheet r={sel} />
            </>
          )}
        </div>
      </div>

      {asking && (
        <Modal
          title={`Email ${shown.length} ${kind} reports`}
          onClose={() => !busy && setAsking(false)}
          actions={
            <>
              <button className="btn" type="button" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={busy || counts.total === 0 || !whoOn.length} onClick={() => void send()}>{busy ? 'Sending…' : `Send ${counts.total} email${counts.total === 1 ? '' : 's'}`}</button>
            </>
          }
        >
          <div className="stack">
            <div className="field">
              <span>Send each report to</span>
              <div className="rp-who" role="group" aria-label="Who receives">
                {(['guardians', 'students', 'coaches'] as Who[]).map((k) => (
                  <label key={k} className="rp-check">
                    <Checkbox checked={who[k]} onChange={() => setWho((w) => ({ ...w, [k]: !w[k] }))} label={WHO_LABEL[k]} />
                    <span onClick={() => setWho((w) => ({ ...w, [k]: !w[k] }))}>{WHO_LABEL[k]}</span>
                  </label>
                ))}
              </div>
              <small>
                {whoOn.length
                  ? <>Each of the {shown.length} {kind} reports goes as its own email to {whoOn.map((k) => WHO_LABEL[k].toLowerCase()).join(', ')}{kind === 'team' && (who.guardians || who.students) ? ' of every member' : ''}.</>
                  : 'Tick at least one.'}
              </small>
            </div>
            {counts.again > 0 && (
              <label className="rp-check">
                <Checkbox checked={resend} onChange={() => setResend(!resend)} label="Send again" />
                <span onClick={() => setResend(!resend)}>Also send again to the {counts.again} who already have theirs</span>
              </label>
            )}
            <CapacityNote total={counts.total} />
          </div>
        </Modal>
      )}
      {portal}
    </>
  );
}

export function CapacityNote({ total }: { total: number }) {
  const db = useDB();
  const cap = capacityToday(db);
  if (cap.noKeys && REMOTE) {
    return <div className="note red">No sending key yet, so nothing can go out. These wait in the queue until you <Link to="/staff/email?tab=keys">add a key in Email, Sending keys</Link>.</div>;
  }
  const now = Math.min(total, cap.left);
  return (
    <div className={`note ${total > cap.left ? 'amber' : ''}`}>
      Your keys can send <b>{cap.left}</b> more today ({cap.used} of {cap.capacity} used).
      {total > cap.left
        ? <> {now} go out now. The other {total - now} wait in the queue and go out tomorrow when the limit resets, or when you press Send again. <Link to="/staff/email?tab=keys">Add a key</Link> to send more per day.</>
        : <> All {total} go out now.</>}
      {cap.noKeys && <div className="muted small" style={{ marginTop: 6 }}>Sandbox: nothing leaves the browser, sends are only counted. <Link to="/staff/email?tab=keys">Sending keys</Link></div>}
    </div>
  );
}

// ----------------------------------------------------------------- the sheet

function Bars({ bars, team }: { bars: (Bar & { weight?: number; weighted?: number })[]; team?: boolean }) {
  return (
    <div className="rp-bars">
      {bars.map((b) => {
        const pct = b.max ? Math.max(0, Math.min(100, (b.score / b.max) * 100)) : 0;
        return (
          <div key={b.name} className="rp-bar">
            <div className="rp-bar-name">{b.name}{b.note && <span>{b.note}</span>}</div>
            <div className="rp-bar-track"><i style={{ width: `${pct}%` }} /></div>
            <div className="rp-bar-num"><b>{fmt(b.score)}</b> / {fmt(b.max)}{team && b.weight !== undefined && b.weight !== 1 && <span className="muted"> ×{b.weight} = {fmt(b.weighted ?? 0)}</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Team totals are not whole numbers on a small scale, so they are grouped into bins. */
function FieldChart({ scores, max, mark }: { scores: number[]; max: number; mark: number }) {
  const n = 20;
  const top = Math.max(max, ...scores, 1);
  const bin = (s: number) => Math.min(n - 1, Math.floor((s / top) * n));
  const bins = Array.from({ length: n }, (_, i) => scores.filter((s) => bin(s) === i).length);
  const peak = Math.max(1, ...bins);
  const w = 100 / n;
  return (
    <figure className="chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Team totals in the division" style={{ height: 120, width: '100%' }}>
        {bins.map((c, i) => {
          const h = (c / peak) * 38;
          return <rect key={i} x={i * w + w * 0.12} y={40 - h} width={w * 0.76} height={h} rx={0.6} fill={bin(mark) === i ? 'var(--blue)' : 'var(--bg-3)'} />;
        })}
      </svg>
      <figcaption className="chart-axis"><span>0</span><span>{Math.round(top / 2)}</span><span>{Math.round(top)}</span></figcaption>
    </figure>
  );
}

function SheetHead({ r }: { r: Report }) {
  const db = useDB();
  const contest = useContest();
  return (
    <header className="rp-head">
      <div>
        <div className="rp-org">{orgOf(db)?.name} · {contest.dateLabel}</div>
        <div className="rp-contest">{contest.name}</div>
      </div>
      <div className="rp-doc">
        {r.kind === 'student' ? 'Score report' : 'Team score report'}
        <span className="mono">{r.key}</span>
      </div>
    </header>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rp-stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function ReportSheet({ r }: { r: Report }) {
  return r.kind === 'student' ? <StudentSheet r={r} /> : <TeamSheet r={r} />;
}

function StudentSheet({ r }: { r: StudentReport }) {
  const solved = r.problems.filter((p) => p.status === 'correct').length;
  return (
    <article className="rp-sheet">
      <SheetHead r={r} />
      <div className="rp-name">
        <h2>{r.name}</h2>
        <p>{r.team?.name} <span className="muted">({r.team?.code})</span> · <ModeChip mode={r.mode}>{r.division}</ModeChip></p>
      </div>
      <div className="rp-stats">
        <Stat label="Place" value={r.place ? ordinal(r.place) : '–'} sub={r.place ? `of ${r.of} in the division` : 'No Individual score'} />
        <Stat label="Individual score" value={r.place ? `${fmt(r.score)} / ${fmt(r.max)}` : '–'} sub={`Division median ${fmt(r.median)}`} />
        <Stat label="Award" value={r.award ?? 'None'} />
        <Stat label="Team" value={r.team?.place ? ordinal(r.team.place) : '–'} sub={r.team ? `of ${r.team.of} · ${fmt(r.team.total)} points` : undefined} />
      </div>

      <section className="rp-sec">
        <h3>Rounds</h3>
        <Bars bars={r.rounds} />
      </section>

      <div className="rp-two">
        <section className="rp-sec">
          <h3>How the division scored</h3>
          {r.field.length > 0 ? (
            <>
              <Histogram scores={r.field} max={r.max} mark={r.place ? Math.round(r.score) : undefined} height={110} label={`Individual scores in the ${r.division} division`} />
              <p className="rp-cap">Students per Individual score, {r.field.length} in all. {r.place ? <>Yours, {fmt(r.score)}, is in blue.</> : null}</p>
            </>
          ) : <p className="rp-cap">No Individual scores in this division.</p>}
        </section>
        <section className="rp-sec">
          <h3>Problem by problem</h3>
          {r.problems.length > 0 ? (
            <>
              <div className="rp-probs">
                {r.problems.map((p) => (
                  <div key={p.number} className={`rp-p ${p.status}`} title={`Problem ${p.number}: ${p.status}. ${Math.round(p.rate * 100)}% of the division solved it.`}>
                    <b>{p.number}</b>
                    <span>{Math.round(p.rate * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="rp-cap">{solved} of {r.problems.length} correct. <i className="k correct" />correct <i className="k incorrect" />incorrect <i className="k blank" />blank. Under each: the share of the division who solved it.</p>
            </>
          ) : <p className="rp-cap">Did not sit the Individual round.</p>}
        </section>
      </div>

      {r.team && (
        <section className="rp-sec">
          <h3>Team</h3>
          <p>{r.team.name} placed <b>{r.team.place ? `${ordinal(r.team.place)} of ${r.team.of}` : 'unplaced'}</b> in the {r.division} division with {fmt(r.team.total)} points.{r.team.award ? ` Team award: ${r.team.award}.` : ''}</p>
        </section>
      )}
      <footer className="rp-foot">Scores as of {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Questions about a score: reply to the email this came with.</footer>
    </article>
  );
}

function TeamSheet({ r }: { r: TeamReport }) {
  return (
    <article className="rp-sheet">
      <SheetHead r={r} />
      <div className="rp-name">
        <h2>{r.name}</h2>
        <p>{r.school} · <ModeChip mode={r.mode}>{r.division}</ModeChip></p>
      </div>
      <div className="rp-stats">
        <Stat label="Place" value={r.place ? ordinal(r.place) : '–'} sub={`of ${r.of} teams`} />
        <Stat label="Total" value={fmt(r.total)} sub={`Division median ${fmt(r.median)}`} />
        <Stat label="Award" value={r.award ?? 'None'} />
        <Stat label="Members" value={String(r.members.length)} sub={`${r.members.filter((m) => m.award).length} with an award`} />
      </div>
      <section className="rp-sec">
        <h3>Rounds</h3>
        <Bars bars={r.rounds} team />
      </section>
      <div className="rp-two">
        <section className="rp-sec">
          <h3>How the division scored</h3>
          <FieldChart scores={r.field} max={r.maxTotal} mark={r.total} />
          <p className="rp-cap">Teams per total, {r.field.length} in all. Yours, {fmt(r.total)}, is in blue.</p>
        </section>
        <section className="rp-sec">
          <h3>Members</h3>
          <table className="rp-members">
            <tbody>
              {r.members.map((m) => (
                <tr key={m.publicId}>
                  <td>{m.name} <span className="mono muted">{m.publicId}</span></td>
                  <td className="num">{m.score === null ? '–' : `${fmt(m.score)} / ${fmt(m.max)}`}</td>
                  <td className="num muted">{m.place ? ordinal(m.place) : ''}{m.award && (!m.place || m.award !== ordinal(m.place)) ? ` · ${m.award}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <footer className="rp-foot">Scores as of {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Round scores are multiplied by their weight to make the total.</footer>
    </article>
  );
}
