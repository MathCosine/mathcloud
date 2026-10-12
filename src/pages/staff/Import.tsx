import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importTeams, offers } from '../../lib/actions';
import { buildPlan, guessMapping, parseCsv, SAMPLE_CSV, STUDENT_FIELDS, TEAM_FIELDS, type Mapping, type StudentField, type TeamField } from '../../lib/csv';
import { useContest } from '../../lib/hooks';
import type { DivisionMode, TeamStatus } from '../../lib/model';
import { useUser } from '../../lib/session';
import { useDB } from '../../lib/store';
import { Icon } from '../../components/icons';
import { ModeChip, Roll, Segmented, toast } from '../../components/ui';

export function Import() {
  const contest = useContest();
  const db = useDB();
  const user = useUser()!;
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState(false);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const offered = contest.divisions.map((d) => d.mode);
  const [defaultMode, setDefaultMode] = useState<DivisionMode | null>(offered.length === 1 ? offered[0] : null);
  const [status, setStatus] = useState<TeamStatus>('confirmed');

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const headers = rows[0] ?? [];
  const plan = useMemo(
    () => (mapping && rows.length > 1 ? buildPlan(rows, mapping, { defaultMode, offered, existingNames: db.teams.map((t) => t.name), teamMax: contest.registration.teamMax }) : []),
    [rows, mapping, defaultMode, offered.join(), db.teams, contest.registration.teamMax],
  );
  const ready = plan.filter((t) => !t.errors.length);
  const skipped = plan.length - ready.length;

  const load = (csv: string, name: string) => {
    const r = parseCsv(csv);
    if (r.length < 2) return toast('Nothing to import', 'The file needs a header row and at least one team.', 'r');
    setText(csv);
    setSource(name);
    setMapping(guessMapping(r[0]));
    setPaste(false);
  };
  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) return toast('That is not a CSV', 'In Google Sheets or Excel: File, Download, Comma-separated values.', 'r');
    f.text().then((t) => load(t, f.name));
  };
  const setTeamCol = (k: TeamField, v: string) => setMapping((m) => m && { ...m, team: { ...m.team, [k]: v === '' ? undefined : Number(v) } });
  const setStudentCol = (k: StudentField, v: string) => setMapping((m) => m && { ...m, students: [{ ...m.students[0], [k]: v === '' ? undefined : Number(v) }] });
  const sample = (i: number | undefined) => (i === undefined ? '' : rows.slice(1).map((r) => r[i]).find((x) => x) ?? '');

  const go = () => {
    const n = importTeams(ready, status, user.name);
    toast(`${n} teams imported`, `${ready.reduce((a, t) => a + t.students.length, 0)} students, each with a competitor ID.${skipped ? ` ${skipped} rows left out.` : ''}`, 'g');
    navigate('/staff/roster');
  };

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Import teams</h1>
          <p className="page-sub">For teams who signed up somewhere else: a Google Form, your own site, a coach's spreadsheet.</p>
        </div>
        {mapping && <button className="btn" type="button" onClick={() => { setText(''); setMapping(null); setSource(''); }}>Start again</button>}
      </div>

      {!mapping ? (
        <section className="card stack">
          {paste ? (
            <>
              <label className="field">
                <span>Paste the rows, header first</span>
                <textarea className="textarea mono" style={{ minHeight: 200, fontSize: 13 }} autoFocus placeholder={'Team name,School,In person or online,Contact email,Student 1 name,...'} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="row"><button className="btn btn-primary" type="button" onClick={() => load(text, 'pasted rows')}>Continue</button><button className="btn btn-quiet" type="button" onClick={() => setPaste(false)}>Back</button></div>
            </>
          ) : (
            <div
              className={`drop ${over ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}
            >
              <span className="ic"><Icon name="upload" size={22} /></span>
              <b>Drop a CSV here</b>
              <span className="soft small">Any columns, in any order. One row per team, or one row per student.</span>
              <div className="row wrap" style={{ justifyContent: 'center', marginTop: 6 }}>
                <button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()}>Choose a file</button>
                <button className="btn" type="button" onClick={() => setPaste(true)}>Paste instead</button>
                <button className="btn btn-quiet" type="button" onClick={() => load(SAMPLE_CSV, 'Google Form sample')}>Try a sample</button>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => readFile(e.target.files?.[0])} />
            </div>
          )}
          <p className="muted small">From Google Sheets or Excel: File, Download, Comma-separated values. Nothing is created until you press Import.</p>
        </section>
      ) : (
        <>
          <section className="card flush">
            <div className="card-head">
              <h2>Match the columns</h2>
              <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows · {mapping.shape === 'wide' ? `${mapping.students.length} students per row` : 'one row per student'}</span>
            </div>
            <div style={{ padding: 18 }} className="stack">
              <div className="map-grid">
                {TEAM_FIELDS.filter((f) => f.key !== 'mode' || offered.length > 1).map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}{f.required && <em className="muted" style={{ fontStyle: 'normal', fontWeight: 500 }}>needed</em>}</span>
                    <select className="select" value={mapping.team[f.key] ?? ''} onChange={(e) => setTeamCol(f.key, e.target.value)}>
                      <option value="">Not in the file</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                    <small className="sample-col">{sample(mapping.team[f.key]) ? `e.g. ${sample(mapping.team[f.key])}` : ' '}</small>
                  </label>
                ))}
                {mapping.shape === 'long' && STUDENT_FIELDS.map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}{f.required && <em className="muted" style={{ fontStyle: 'normal', fontWeight: 500 }}>needed</em>}</span>
                    <select className="select" value={mapping.students[0][f.key] ?? ''} onChange={(e) => setStudentCol(f.key, e.target.value)}>
                      <option value="">Not in the file</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                    <small className="sample-col">{sample(mapping.students[0][f.key]) ? `e.g. ${sample(mapping.students[0][f.key])}` : ' '}</small>
                  </label>
                ))}
              </div>
              {mapping.shape === 'wide' && (
                <p className="soft small">
                  Students: {mapping.students.map((s, i) => `${headers[s.student!] ?? `student ${i + 1}`}`).join(', ')}, each with {[...new Set(mapping.students.flatMap((s) => Object.keys(s)))].filter((k) => k !== 'student').map((k) => STUDENT_FIELDS.find((f) => f.key === k)!.label.toLowerCase()).join(' and ') || 'just a name'}.
                </p>
              )}
              {offered.length > 1 ? (
                <div className="row wrap" style={{ gap: 12 }}>
                  <span className="soft small">When a row doesn't say in person or online:</span>
                  <Segmented label="When a row doesn't say" value={defaultMode ?? 'none'} onChange={(k) => setDefaultMode(k === 'none' ? null : k)}
                    items={[{ key: 'none', label: 'Leave it out' }, { key: 'in_person', label: 'In person' }, { key: 'online', label: 'Online' }] as { key: DivisionMode | 'none'; label: string }[]} />
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}><ModeChip mode={offered[0]} /><span className="soft small">{contest.short} is {offered[0] === 'online' ? 'online only' : 'in person only'}, so every team comes in that way.</span></div>
              )}
            </div>
          </section>

          <section className="card flush">
            <div className="card-head">
              <h2>Check before importing</h2>
              <span className="row" style={{ gap: 14 }}>
                {offers(contest, 'in_person') && <span className="small soft"><b><Roll value={ready.filter((t) => t.mode === 'in_person').length} /></b> in person</span>}
                {offers(contest, 'online') && <span className="small soft"><b><Roll value={ready.filter((t) => t.mode === 'online').length} /></b> online</span>}
                {skipped > 0 && <span className="small bad"><b><Roll value={skipped} /></b> left out</span>}
              </span>
            </div>
            <div className="table-scroll">
              <table className="t">
                <thead><tr><th>Row</th><th>Team</th><th>Takes part</th><th className="num">Students</th><th>Contact</th><th>Notes</th></tr></thead>
                <tbody>
                  {plan.map((t) => (
                    <tr key={t.rows.join()} className={t.errors.length ? 'dim' : ''}>
                      <td className="mono soft">{t.rows.length > 1 ? `${t.rows[0]}–${t.rows[t.rows.length - 1]}` : t.rows[0]}</td>
                      <td className="name">{t.name || <span className="muted">No name</span>}<div className="muted tiny" style={{ fontWeight: 400 }}>{[t.school, t.city].filter(Boolean).join(', ')}</div></td>
                      <td>{t.errors.length && /in person or online|Cannot tell/.test(t.errors.join()) ? <span className="muted">–</span> : <ModeChip mode={t.mode} />}</td>
                      <td className="num">{t.students.length}</td>
                      <td className="soft">{t.contactName}<div className="muted tiny">{t.contactEmail}</div></td>
                      <td className="wrap" style={{ minWidth: 220 }}>
                        {t.errors.length === 0 && t.warnings.length === 0 && <span className="state ok">Ready</span>}
                        <ul className="issues">
                          {t.errors.map((e) => <li key={e} className="e">{e}</li>)}
                          {t.warnings.map((w) => <li key={w} className="w">{w}</li>)}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot">
              <label className="row small soft" style={{ gap: 8 }}>
                Add them as
                <select className="select input-sm" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as TeamStatus)}>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending, to check</option>
                </select>
              </label>
              <button className="btn btn-primary" type="button" disabled={!ready.length} onClick={go}>
                Import {ready.length} {ready.length === 1 ? 'team' : 'teams'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
