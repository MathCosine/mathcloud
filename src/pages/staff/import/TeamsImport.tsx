import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importStudents, importTeams, offers, saveTeam, type NewTeam } from '../../../lib/actions';
import { buildPlan, guessMapping, parseCsv, SAMPLE_CSV, STUDENT_FIELDS, TEAM_FIELDS, type Mapping, type StudentField, type TeamField } from '../../../lib/csv';
import { dedupeTeams, defaultTeamAction, isDuplicate, summarizeTeams, type TeamAction, type TeamRow } from '../../../lib/importers';
import { useContest } from '../../../lib/hooks';
import type { DivisionMode, TeamStatus } from '../../../lib/model';
import { useUser } from '../../../lib/session';
import { useDB } from '../../../lib/store';
import { Icon } from '../../../components/icons';
import { ModeChip, Segmented, toast } from '../../../components/ui';
import { ColumnSelect, Issues, sampleOf, Source, Steps, Tally } from './shared';

const FIELD_WORD: Record<string, string> = { school: 'school', city: 'city', contactName: 'contact', contactEmail: 'contact email' };

export function TeamsImport() {
  const contest = useContest();
  const db = useDB();
  const user = useUser()!;
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const offered = contest.divisions.map((d) => d.mode);
  const [defaultMode, setDefaultMode] = useState<DivisionMode | null>(offered.length === 1 ? offered[0] : null);
  const [status, setStatus] = useState<TeamStatus>('confirmed');
  const [actions, setActions] = useState<Record<string, TeamAction>>({});
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const headers = rows[0] ?? [];
  const teamMax = contest.registration.teamMax;
  const plan = useMemo(
    () => (mapping && rows.length > 1 ? buildPlan(rows, mapping, { defaultMode, offered, teamMax }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mapping, defaultMode, offered.join(), teamMax],
  );
  const live = useMemo(() => db.teams.filter((t) => t.status !== 'withdrawn'), [db.teams]);
  const dd = useMemo(() => dedupeTeams(plan, live, db.competitors, teamMax), [plan, live, db.competitors, teamMax]);
  const sum = summarizeTeams(dd.rows, actions);
  const dups = dd.rows.filter((r) => isDuplicate(r) && !r.errors.length);
  const actionOf = (r: TeamRow) => actions[r.key] ?? defaultTeamAction(r);

  const load = (csv: string, name: string) => {
    const r = parseCsv(csv);
    if (r.length < 2) return toast('Nothing to import', 'The file needs a header row and at least one team.', 'r');
    setText(csv);
    setSource(name);
    setMapping(guessMapping(r[0]));
    setActions({});
  };
  const setTeamCol = (k: TeamField, v: number | undefined) => setMapping((m) => m && { ...m, team: { ...m.team, [k]: v } });
  const setStudentCol = (k: StudentField, v: number | undefined) => setMapping((m) => m && { ...m, students: [{ ...m.students[0], [k]: v }] });

  const go = async () => {
    setBusy(true);
    const asNew = (t: TeamRow): NewTeam => ({ mode: t.mode, name: t.name, school: t.school, city: t.city, contactName: t.contactName, contactEmail: t.contactEmail, students: t.students });
    let made = 0;
    if (sum.create.length) {
      const r = await importTeams(sum.create.map(asNew), status, user.name);
      made = r.count;
      if (r.error) {
        setBusy(false);
        return toast('Import stopped', r.error, 'r');
      }
    }
    let added = 0;
    const adds: Parameters<typeof importStudents>[0] = [];
    for (const r of sum.update) {
      const team = db.teams.find((t) => t.id === r.existing!.id);
      if (!team) continue;
      if (r.changes.length) saveTeam({ ...team, ...Object.fromEntries(r.changes.map((c) => [c.field, c.to])) }, user.name);
      for (const s of r.newStudents) adds.push({ teamId: team.id, ...s });
    }
    if (adds.length) {
      const res = await importStudents(adds, user.name);
      added = res.count;
      if (res.error) toast('Some students were not added', res.error, 'a');
    }
    setBusy(false);
    const parts = [
      made && `${made} new ${made === 1 ? 'team' : 'teams'}`,
      sum.update.length && `${sum.update.length} updated${added ? ` (${added} students added)` : ''}`,
    ].filter(Boolean);
    toast(parts.length ? `Imported: ${parts.join(', ')}` : 'Nothing imported', sum.skipped + sum.blocked ? `${sum.skipped + sum.blocked} rows left out.` : 'Every student has a competitor ID.', 'g');
    navigate('/staff/teams');
  };

  if (!mapping) {
    return (
      <>
        <Steps at={1} />
        <section className="card stack">
          <Source
            onLoad={load}
            hint="Any columns, in any order. One row per team, or one row per student."
            pastePlaceholder="Team name,School,In person or online,Contact email,Student 1 name,..."
            samples={[{ label: 'Try a sample', text: SAMPLE_CSV, name: 'Google Form sample' }]}
          />
          <p className="muted small">From Google Sheets or Excel: File, Download, Comma-separated values. Teams already registered are found by name, or by contact email and school, and you choose what happens to each.</p>
        </section>
      </>
    );
  }

  const nothing = sum.create.length + sum.update.length === 0;
  return (
    <>
      <Steps at={mapping.team.team === undefined || mapping.team.contactEmail === undefined || !mapping.students.some((x) => x.student !== undefined) ? 2 : 3} onRestart={() => { setMapping(null); setText(''); }} />
      <section className="card flush">
        <div className="card-head">
          <h2>Match the columns</h2>
          <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows · {mapping.shape === 'wide' ? `${mapping.students.length} students per row` : 'one row per student'}</span>
        </div>
        <div className="imp-pad stack">
          <div className="map-grid">
            {TEAM_FIELDS.filter((f) => f.key !== 'mode' || offered.length > 1).map((f) => (
              <ColumnSelect key={f.key} label={f.label} required={f.required} value={mapping.team[f.key]} headers={headers} sample={sampleOf(rows, mapping.team[f.key])} onChange={(v) => setTeamCol(f.key, v)} />
            ))}
            {mapping.shape === 'long' && STUDENT_FIELDS.map((f) => (
              <ColumnSelect key={f.key} label={f.label} required={f.required} value={mapping.students[0][f.key]} headers={headers} sample={sampleOf(rows, mapping.students[0][f.key])} onChange={(v) => setStudentCol(f.key, v)} />
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
        <div className="card-head wrap">
          <h2>Check before importing</h2>
          <span className="row wrap" style={{ gap: 10 }}>
            <Tally items={[
              { n: sum.create.length, label: 'new', tone: 'g' },
              { n: sum.update.length, label: sum.update.length === 1 ? 'update' : 'updates', tone: 'b' },
              { n: sum.skipped + sum.blocked, label: 'skipped', tone: 'a' },
              { n: dd.merged + dd.studentDups, label: 'duplicates removed', tone: '' },
            ]} />
            {dups.some((r) => actionOf(r) !== 'skip') && (
              <button className="btn btn-sm" type="button" onClick={() => setActions((a) => ({ ...a, ...Object.fromEntries(dups.map((r) => [r.key, 'skip'])) }))}>Remove duplicates</button>
            )}
          </span>
        </div>
        {(offers(contest, 'in_person') && offers(contest, 'online')) && (
          <div className="imp-modes small soft">
            <span><b>{sum.create.filter((t) => t.mode === 'in_person').length}</b> new in person</span>
            <span><b>{sum.create.filter((t) => t.mode === 'online').length}</b> new online</span>
          </div>
        )}
        <div className="table-scroll">
          <table className="t imp-table">
            <thead><tr><th>Row</th><th>Team</th><th>Takes part</th><th className="num">Students</th><th>Contact</th><th>What happens</th><th>Notes</th></tr></thead>
            <tbody>
              {dd.rows.map((t) => {
                const a = actionOf(t);
                const out = t.errors.length > 0 || a === 'skip';
                return (
                  <tr key={t.key} className={out ? 'dim' : ''}>
                    <td className="mono soft">{t.rows.length > 1 ? t.rows.join(', ') : t.rows[0]}</td>
                    <td className="name">{t.name || <span className="muted">No name</span>}<div className="muted tiny" style={{ fontWeight: 400 }}>{[t.school, t.city].filter(Boolean).join(', ')}</div></td>
                    <td>{t.errors.length && /in person or online|Cannot tell/.test(t.errors.join()) ? <span className="muted">–</span> : <ModeChip mode={t.mode} />}</td>
                    <td className="num">{a === 'update' ? <span title="Students not on the team yet">+{t.newStudents.length}</span> : t.students.length}</td>
                    <td className="soft">{t.contactName}<div className="muted tiny">{t.contactEmail}</div></td>
                    <td>
                      {t.errors.length ? <span className="state bad">Left out</span> : t.existing ? (
                        <div className="stack" style={{ gap: 4 }}>
                          <select className="select input-sm imp-act" aria-label={`What to do with ${t.name}`} value={a} onChange={(e) => setActions((x) => ({ ...x, [t.key]: e.target.value as TeamAction }))}>
                            <option value="skip">Skip</option>
                            <option value="update">Update {t.existing.code} {t.existing.name}</option>
                            <option value="add">Add anyway, as a new team</option>
                          </select>
                          <span className="tiny amber-ink">Matches {t.existing.code} {t.existing.name} ({t.existing.why})</span>
                        </div>
                      ) : t.fileDupOf ? (
                        <div className="stack" style={{ gap: 4 }}>
                          <select className="select input-sm imp-act" aria-label={`What to do with ${t.name}`} value={a} onChange={(e) => setActions((x) => ({ ...x, [t.key]: e.target.value as TeamAction }))}>
                            <option value="new">Add as a second team</option>
                            <option value="skip">Skip</option>
                          </select>
                          <span className="tiny amber-ink">Same contact and school as row {t.fileDupOf.row}, {t.fileDupOf.name}</span>
                        </div>
                      ) : <span className="state ok">New team</span>}
                    </td>
                    <td className="wrap imp-notes">
                      <Issues
                        errors={t.errors}
                        warnings={t.warnings}
                        notes={[
                          ...t.info,
                          ...(a === 'update' && t.existing
                            ? [
                              t.changes.length ? `Changes ${t.changes.map((c) => `${FIELD_WORD[c.field]} to “${c.to}”`).join(', ')}` : 'Details already match',
                              t.newStudents.length ? `Adds ${t.newStudents.map((s) => s.name).join(', ')}` : 'No new students',
                            ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-foot wrap">
          <label className="row small soft" style={{ gap: 8 }}>
            Add new teams as
            <select className="select input-sm" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as TeamStatus)}>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending, to check</option>
            </select>
          </label>
          <button className="btn btn-primary" type="button" disabled={nothing || busy} onClick={go}>
            {busy ? 'Importing…' : nothing ? 'Nothing to import' : [sum.create.length && `Import ${sum.create.length} ${sum.create.length === 1 ? 'team' : 'teams'}`, sum.update.length && `update ${sum.update.length}`].filter(Boolean).join(', ').replace(/^u/, 'U')}
          </button>
        </div>
      </section>
    </>
  );
}
