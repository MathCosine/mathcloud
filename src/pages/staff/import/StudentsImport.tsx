import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importStudents } from '../../../lib/actions';
import { parseCsv } from '../../../lib/csv';
import {
  defaultStudentAction, guessStudentImport, planStudents, SAMPLE_STUDENTS, STUDENT_IMPORT_FIELDS, type StudentAction, type StudentImportMap,
} from '../../../lib/importers';
import { useContest } from '../../../lib/hooks';
import { useUser } from '../../../lib/session';
import { useDB } from '../../../lib/store';
import { Icon } from '../../../components/icons';
import { toast } from '../../../components/ui';
import { ColumnSelect, Issues, sampleOf, Source, Steps, Tally } from './shared';

export function StudentsImport() {
  const contest = useContest();
  const db = useDB();
  const user = useUser()!;
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [map, setMap] = useState<StudentImportMap | null>(null);
  const [actions, setActions] = useState<Record<string, StudentAction>>({});
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const headers = rows[0] ?? [];
  const teams = useMemo(() => db.teams.filter((t) => t.status !== 'withdrawn'), [db.teams]);
  const plan = useMemo(
    () => (map && rows.length > 1 ? planStudents(rows, map, { teams, students: db.competitors, teamMax: contest.registration.teamMax }, actions) : []),
    [rows, map, teams, db.competitors, contest.registration.teamMax, actions],
  );
  const actionOf = (s: (typeof plan)[number]) => actions[s.key] ?? defaultStudentAction(s);
  const ready = plan.filter((s) => !s.errors.length && actionOf(s) === 'add');
  const dups = plan.filter((s) => s.dup);
  const full = plan.filter((s) => s.errors.some((e) => /is full/.test(e))).length;
  const unknown = plan.filter((s) => s.errors.some((e) => /No team/.test(e))).length;

  const load = (csv: string, name: string) => {
    const r = parseCsv(csv);
    if (r.length < 2) return toast('Nothing to import', 'The file needs a header row and at least one student.', 'r');
    setText(csv);
    setSource(name);
    setMap(guessStudentImport(r[0]));
    setActions({});
  };

  const go = async () => {
    setBusy(true);
    const r = await importStudents(ready.map((s) => ({ teamId: s.teamId!, name: s.name, grade: s.grade, guardianName: s.guardianName, guardianEmail: s.guardianEmail })), user.name);
    setBusy(false);
    if (r.error) return toast(`${r.count} added, then it stopped`, r.error, 'r');
    toast(`${r.count} ${r.count === 1 ? 'student' : 'students'} added`, 'Each has a competitor ID, and a waiver request goes to their guardian.', 'g');
    navigate('/staff/teams');
  };

  if (!map) {
    return (
      <>
        <Steps at={1} />
        <section className="card stack">
          <Source
            onLoad={load}
            hint="One row per student, with the team's code (07) or name. Students join the team's next free letter."
            pastePlaceholder={'Team,Student name,Grade,Parent name,Parent email\n07,Ada Lovelace,10,Anne Byron,anne@example.com'}
            samples={[{ label: 'Try a sample', text: SAMPLE_STUDENTS, name: 'sample students' }]}
          />
          <p className="muted small">Students already on a team, and students with the same name and guardian email on another team, are set to skip. You can still add them.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <Steps at={map.team === undefined || map.student === undefined ? 2 : 3} onRestart={() => { setMap(null); setText(''); }} />
      <section className="card flush">
        <div className="card-head">
          <h2>Match the columns</h2>
          <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows</span>
        </div>
        <div className="imp-pad">
          <div className="map-grid">
            {STUDENT_IMPORT_FIELDS.map((f) => (
              <ColumnSelect key={f.key} label={f.label} required={f.required} value={map[f.key]} headers={headers} sample={sampleOf(rows, map[f.key])} onChange={(v) => setMap((m) => m && { ...m, [f.key]: v })} />
            ))}
          </div>
        </div>
      </section>

      <section className="card flush">
        <div className="card-head wrap">
          <h2>Check before importing</h2>
          <span className="row wrap" style={{ gap: 10 }}>
            <Tally items={[
              { n: ready.length, label: 'to add', tone: 'g' },
              { n: plan.filter((s) => !s.errors.length && actionOf(s) === 'skip').length, label: 'skipped', tone: 'a' },
              { n: full, label: 'over the team size', tone: 'r' },
              { n: unknown, label: 'unknown team', tone: 'r' },
            ]} />
            {dups.some((s) => actionOf(s) !== 'skip') && (
              <button className="btn btn-sm" type="button" onClick={() => setActions((a) => ({ ...a, ...Object.fromEntries(dups.map((s) => [s.key, 'skip'])) }))}>Remove duplicates</button>
            )}
          </span>
        </div>
        <div className="table-scroll">
          <table className="t imp-table">
            <thead><tr><th>Row</th><th>Student</th><th className="num">Grade</th><th>Team</th><th>Guardian</th><th>What happens</th><th>Notes</th></tr></thead>
            <tbody>
              {plan.map((s) => {
                const a = actionOf(s);
                return (
                  <tr key={s.key} className={s.errors.length || a === 'skip' ? 'dim' : ''}>
                    <td className="mono soft">{s.row}</td>
                    <td className="name">{s.name || <span className="muted">No name</span>}</td>
                    <td className="num">{s.grade ?? <span className="muted">–</span>}</td>
                    <td>{s.teamId ? <span><span className="code">{s.teamLabel.slice(0, s.teamLabel.indexOf(' '))}</span>{s.teamLabel.slice(s.teamLabel.indexOf(' ') + 1)}</span> : <span className="bad-ink">{s.teamRaw || '–'}</span>}</td>
                    <td className="soft">{s.guardianName}<div className="muted tiny">{s.guardianEmail}</div></td>
                    <td>
                      {s.errors.length ? <span className="state bad">Left out</span> : s.dup ? (
                        <select className="select input-sm imp-act" aria-label={`What to do with ${s.name}`} value={a} onChange={(e) => setActions((x) => ({ ...x, [s.key]: e.target.value as StudentAction }))}>
                          <option value="skip">Skip</option>
                          <option value="add">Add anyway</option>
                        </select>
                      ) : <span className="state ok">Add</span>}
                    </td>
                    <td className="wrap imp-notes"><Issues errors={s.errors} warnings={s.warnings} notes={s.dup ? [s.dup] : []} ok="Ready" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-foot">
          <span className="muted small">Teams hold up to {contest.registration.teamMax} students.</span>
          <button className="btn btn-primary" type="button" disabled={!ready.length || busy} onClick={go}>
            {busy ? 'Adding…' : `Add ${ready.length} ${ready.length === 1 ? 'student' : 'students'}`}
          </button>
        </div>
      </section>
    </>
  );
}
