import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { importStudents, importTeams, linkedEdition, offers, saveTeam, undoImport, type NewTeam } from '../../../lib/actions';
import { buildPlan, guessMapping, parseCsv, SAMPLE_CSV, STUDENT_FIELDS, TEAM_FIELDS, type Mapping, type StudentField, type TeamField } from '../../../lib/csv';
import { dedupeTeams, defaultTeamAction, isDuplicate, summarizeTeams, type TeamAction, type TeamRow } from '../../../lib/importers';
import { useContest } from '../../../lib/hooks';
import type { DivisionMode, TeamStatus } from '../../../lib/model';
import { useUser } from '../../../lib/session';
import { useAllDB } from '../../../lib/store';
import { Icon } from '../../../components/icons';
import { ModeChip, Segmented, toast } from '../../../components/ui';
import { ColumnSelect, Done, Duplicates, Issues, missingNote, sampleOf, Source, StepFoot, Steps, Tally, type Step } from './shared';

const FIELD_WORD: Record<string, string> = { school: 'school', city: 'city', contactName: 'contact', contactEmail: 'contact email' };

export function TeamsImport() {
  const contest = useContest();
  const user = useUser()!;
  const [step, setStep] = useState<Step>(1);
  const [result, setResult] = useState<{ made: number; updated: number; added: number; skipped: number; blocked: number; teamIds: string[] } | null>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const all = useAllDB();
  const other = linkedEdition(all, contest);
  // Rows for the other way of taking part go to the linked edition.
  const offered = [...new Set([...contest.divisions, ...(other?.divisions ?? [])].map((d) => d.mode))];
  const [waivers, setWaivers] = useState<'none' | 'all' | 'file'>('none');
  const [waiverNote, setWaiverNote] = useState('Collected before MathCloud');
  const [numbering, setNumbering] = useState<'ours' | 'file'>('file');
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
  // Duplicates and team numbers are checked across both editions: a team may already be in the other one.
  const scope = useMemo(() => new Set([contest.id, other?.id].filter(Boolean) as string[]), [contest.id, other?.id]);
  const live = useMemo(() => all.teams.filter((t) => scope.has(t.contestId) && t.status !== 'withdrawn'), [all.teams, scope]);
  const takenCodes = useMemo(() => new Set(all.teams.filter((t) => scope.has(t.contestId)).map((t) => t.code.toUpperCase())), [all.teams, scope]);
  const dd = useMemo(() => dedupeTeams(plan, live, all.competitors, teamMax), [plan, live, all.competitors, teamMax]);
  const sum = summarizeTeams(dd.rows, actions);
  const dups = dd.rows.filter((r) => isDuplicate(r) && !r.errors.length);
  const actionOf = (r: TeamRow) => actions[r.key] ?? defaultTeamAction(r);

  const load = (csv: string, name: string) => {
    const r = parseCsv(csv);
    if (r.length < 2) return toast('Nothing to import', 'The file needs a header row and at least one team.', 'r');
    setText(csv);
    setSource(name);
    const m = guessMapping(r[0]);
    setMapping(m);
    setWaivers(m.students.some((x) => x.waiver !== undefined) ? 'file' : 'none');
    setActions({});
    setStep(2);
  };
  const restart = () => { setMapping(null); setText(''); setResult(null); setStep(1); };
  const setTeamCol = (k: TeamField, v: number | undefined) => setMapping((m) => m && { ...m, team: { ...m.team, [k]: v } });
  const setStudentCol = (k: StudentField, v: number | undefined) => setMapping((m) => m && { ...m, students: [{ ...m.students[0], [k]: v }] });

  const go = async () => {
    setBusy(true);
    const asNew = (t: TeamRow): NewTeam => ({
      mode: t.mode, name: t.name, school: t.school, city: t.city, contactName: t.contactName, contactEmail: t.contactEmail,
      code: numbering === 'file' && t.code && !takenCodes.has(t.code.toUpperCase()) ? t.code : undefined,
      externalId: t.externalId,
      allowDuplicate: !!(t.existing || t.fileDupOf),
      students: t.students.map(({ fileWaiver, ...s }) => ({ ...s, waiverSignedBy: waivers === 'all' || (waivers === 'file' && fileWaiver) ? waiverNote.trim() || 'Collected before MathCloud' : null })),
    });
    let made = 0;
    let teamIds: string[] = [];
    if (sum.create.length) {
      const r = await importTeams(sum.create.map(asNew), status, user.name);
      made = r.count;
      teamIds = r.teamIds;
      if (r.error) {
        setBusy(false);
        return toast('Import stopped', r.error, 'r');
      }
    }
    let added = 0;
    const adds: Parameters<typeof importStudents>[0] = [];
    for (const r of sum.update) {
      const team = all.teams.find((t) => t.id === r.existing!.id);
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
      sum.update.length && `${sum.update.length} updated${added ? ` (${added} ${added === 1 ? 'student' : 'students'} added)` : ''}`,
    ].filter(Boolean);
    toast(parts.length ? `Imported: ${parts.join(', ')}` : 'Nothing imported', undefined, 'g');
    setResult({ made, updated: sum.update.length, added, skipped: sum.skipped, blocked: sum.blocked, teamIds });
    setStep(4);
  };

  if (step === 4 && result) {
    return (
      <>
        <Steps at={4} />
        <Done
          title={[result.made && `${result.made} new ${result.made === 1 ? 'team' : 'teams'}`, result.updated && `${result.updated} updated`].filter(Boolean).join(', ') || 'Nothing imported'}
          body={<>{result.added ? `${result.added} ${result.added === 1 ? 'student' : 'students'} added to existing teams. ` : ''}Every student has a competitor ID.{[result.skipped && ` ${result.skipped} skipped as duplicates`, result.blocked && ` ${result.blocked} left out with problems`].filter(Boolean).join(',')}{result.skipped || result.blocked ? '.' : ''}</>}
        >
          <Link className="btn btn-primary" to="/staff/teams">Go to Teams</Link>
          {waivers === 'none' && result.made > 0 && <Link className="btn" to="/staff/waivers"><Icon name="send" />Ask guardians for waivers</Link>}
          <button className="btn" type="button" onClick={restart}>Import another file</button>
          {result.teamIds.length > 0 && (
            <button className="btn btn-quiet" type="button" onClick={() => {
              undoImport(result.teamIds, user.name);
              toast(`Removed the ${result.teamIds.length} imported ${result.teamIds.length === 1 ? 'team' : 'teams'}`, 'Updates to teams that were already here stay.', '');
              restart();
            }}><Icon name="undo" />Undo this import</button>
          )}
        </Done>
      </>
    );
  }

  if (!mapping || step === 1) {
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
          <p className="muted small">CSV or Excel (.xlsx) straight from your old sign-up, a Google Form or a coach's spreadsheet. Teams already registered are found by name, or by contact email and school, and you choose what happens to each.</p>
        </section>
      </>
    );
  }

  const nothing = sum.create.length + sum.update.length === 0;
  const missing = [
    ...(mapping.team.team === undefined ? ['Team name'] : []),
    ...(mapping.team.contactEmail === undefined ? ['Contact email'] : []),
    ...(!mapping.students.some((x) => x.student !== undefined) ? ['Student name'] : []),
  ];
  const fileLabel = <span className="label"><Icon name="file" size={13} /> {source} · {rows.length - 1} rows · {mapping.shape === 'wide' ? `${mapping.students.length} students per row` : 'one row per student'}</span>;

  if (step === 2) {
    return (
      <>
        <Steps at={2} onGo={setStep} onRestart={restart} />
        <section className="card flush">
          <div className="card-head wrap">
            <h2>Which column holds what?</h2>
            {fileLabel}
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
          <StepFoot back={restart} backLabel="Choose another file" note={missingNote(missing)}>
            <button className="btn btn-primary" type="button" disabled={missing.length > 0} onClick={() => setStep(3)}>Check {dd.rows.length} {dd.rows.length === 1 ? 'team' : 'teams'}<Icon name="arrow" /></button>
          </StepFoot>
        </section>
      </>
    );
  }

  const hasCodes = mapping.team.code !== undefined;
  const hasWaiverCol = mapping.students.some((x) => x.waiver !== undefined);
  const fileSigned = dd.rows.reduce((n, t) => n + t.students.filter((x) => x.fileWaiver).length, 0);
  const newStudents = sum.create.reduce((n, t) => n + t.students.length, 0);

  const dupItems = dups.map((t) => t.existing
    ? {
      key: t.key,
      what: <><b>{t.name}</b> <span className="soft small">row {t.rows.join(' + ')}</span></>,
      why: <>Looks like <b>{t.existing.code} {t.existing.name}</b>, already registered ({t.existing.why})</>,
      value: actionOf(t) as TeamAction,
      options: [{ key: 'skip', label: 'Skip' }, { key: 'update', label: `Update ${t.existing.code}` }, { key: 'add', label: 'Add as new' }] as { key: TeamAction; label: string }[],
    }
    : {
      key: t.key,
      what: <><b>{t.name}</b> <span className="soft small">row {t.rows.join(' + ')}</span></>,
      why: <>Same contact and school as row {t.fileDupOf!.row}, {t.fileDupOf!.name}</>,
      value: actionOf(t) as TeamAction,
      options: [{ key: 'skip', label: 'Skip' }, { key: 'new', label: 'Add as second team' }] as { key: TeamAction; label: string }[],
    });

  return (
    <>
      <Steps at={3} onGo={setStep} onRestart={restart} />
      <section className="card imp-options">
        <div className="imp-opt">
          <div className="imp-opt-label"><Icon name="waivers" /><span><b>Waivers</b><small>{newStudents} students in new teams</small></span></div>
          <div className="stack" style={{ gap: 8 }}>
            <Segmented label="Waivers" value={waivers} onChange={setWaivers}
              items={[
                { key: 'none', label: 'Not signed yet' },
                { key: 'all', label: 'All already signed' },
                ...(hasWaiverCol ? [{ key: 'file' as const, label: `From the file (${fileSigned} signed)` }] : []),
              ]} />
            {waivers === 'none' && <small className="muted">Guardians can sign online, or you mark paper copies. Send the requests from Waivers whenever you are ready.</small>}
            {waivers !== 'none' && (
              <label className="row small" style={{ gap: 8 }}>
                <span className="soft">Recorded as</span>
                <input className="input input-sm" style={{ maxWidth: 280 }} value={waiverNote} onChange={(e) => setWaiverNote(e.target.value)} />
              </label>
            )}
          </div>
        </div>
        {hasCodes && (
          <div className="imp-opt">
            <div className="imp-opt-label"><Icon name="ticket" /><span><b>Team numbers</b><small>Student IDs follow them: 07A, 07B…</small></span></div>
            <Segmented label="Team numbers" value={numbering} onChange={setNumbering}
              items={[{ key: 'file', label: 'Keep the file’s numbers' }, { key: 'ours', label: 'Number them in MathCloud' }]} />
          </div>
        )}
        {other && (
          <div className="imp-opt">
            <div className="imp-opt-label"><Icon name="both" /><span><b>Two editions</b><small>{contest.short} runs in person and online as linked contests</small></span></div>
            <p className="soft small" style={{ margin: 0 }}>
              <b>{sum.create.filter((t) => offers(contest, t.mode)).length}</b> new teams go to this contest and <b>{sum.create.filter((t) => !offers(contest, t.mode)).length}</b> to the {other.divisions[0]?.mode === 'online' ? 'online' : 'in-person'} edition, by the file’s in person or online column.
            </p>
          </div>
        )}
      </section>
      <Duplicates<TeamAction>
        title={dups.length === 1 ? 'row looks like a team you already have' : 'rows look like teams you already have'}
        note="Nothing is merged without you. Skip a row, update the team that is there, or add it anyway."
        items={dupItems}
        options={[{ key: 'skip', label: 'Skip' }, { key: 'update', label: 'Update' }]}
        onChange={(k, v) => setActions((x) => ({ ...x, [k]: v }))}
        onAll={(v) => setActions((a) => ({ ...a, ...Object.fromEntries(dups.filter((r) => v !== 'update' || r.existing).map((r) => [r.key, v])) }))}
      />
      <section className="card flush">
        <div className="card-head wrap">
          <h2>What will happen</h2>
          <span className="row wrap" style={{ gap: 10 }}>
            <Tally items={[
              { n: sum.create.length, label: 'new', tone: 'g' },
              { n: sum.update.length, label: sum.update.length === 1 ? 'update' : 'updates', tone: 'b' },
              { n: sum.skipped, label: 'skipped', tone: 'a' },
              { n: sum.blocked, label: 'left out', tone: 'r' },
              { n: dd.merged + dd.studentDups, label: 'duplicates removed', tone: '' },
            ]} />
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
                    <td className="mono soft">{t.rows.join(' + ')}</td>
                    <td className="name">{t.name || <span className="muted">No name</span>}<div className="muted tiny" style={{ fontWeight: 400 }}>{[t.school, t.city].filter(Boolean).join(', ')}</div></td>
                    <td>{t.errors.length && /in person or online|Cannot tell/.test(t.errors.join()) ? <span className="muted">–</span> : <ModeChip mode={t.mode} />}</td>
                    <td className="num">{a === 'update' ? <span title="Students not on the team yet">+{t.newStudents.length}</span> : t.students.length}</td>
                    <td className="soft">{t.contactName}<div className="muted tiny">{t.contactEmail}</div></td>
                    <td>
                      {t.errors.length ? <span className="state bad">Left out</span>
                        : a === 'skip' ? <span className="state wait">Skipped</span>
                          : a === 'update' ? <span className="state go">Updates {t.existing?.code}</span>
                            : <span className="state ok">{t.existing || t.fileDupOf ? 'Added as new' : 'New team'}</span>}
                    </td>
                    <td className="wrap imp-notes">
                      <Issues
                        ok=''
                        errors={t.errors}
                        warnings={t.warnings}
                        notes={[
                          ...t.info,
                          ...(numbering === 'file' && hasCodes && t.code && !t.existing
                            ? [takenCodes.has(t.code.toUpperCase()) ? `Number ${t.code} is taken; gets the next free one` : `Keeps number ${t.code.toUpperCase()}`]
                            : []),
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
        <StepFoot back={() => setStep(2)} backLabel="Back to columns">
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
        </StepFoot>
      </section>
    </>
  );
}
