import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { queueSends } from '../../lib/actions';
import { useContest, useStandings } from '../../lib/hooks';
import { useDB } from '../../lib/store';
import { Segmented, toast } from '../../components/ui';

/** Short code printed on each certificate; anyone can check it at /verify. */
export function verifyCode(contestSlug: string, publicId: string) {
  let h = 2166136261;
  for (const ch of `${contestSlug}:${publicId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const s = (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

type Pos = { x: number; y: number };

export function Certificates() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const [div, setDiv] = useState(contest.divisions[0].id);
  const [bg, setBg] = useState<string | null>(null);
  const [pos, setPos] = useState<{ name: Pos; award: Pos }>({ name: { x: 50, y: 46 }, award: { x: 50, y: 60 } });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<keyof typeof pos | null>(null);

  const people = useMemo(() => {
    const rows = standings.individuals[div] ?? [];
    return rows.map((r) => ({ id: r.competitor.publicId, name: r.competitor.name, award: r.award ?? 'Participation', place: r.place, email: r.competitor.guardianEmail }));
  }, [standings, div]);
  const [sel, setSel] = useState(0);
  const p = people[Math.min(sel, people.length - 1)];
  const byAward = people.reduce<Record<string, number>>((m, x) => ({ ...m, [x.award]: (m[x.award] ?? 0) + 1 }), {});

  const onMove = (e: RPE<HTMLDivElement>) => {
    if (!drag.current || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(8, Math.min(92, ((e.clientY - r.top) / r.height) * 100));
    setPos((s) => ({ ...s, [drag.current!]: { x: Math.round(x), y: Math.round(y) } }));
  };

  const grab = (k: keyof typeof pos) => (e: RPE<HTMLDivElement>) => {
    drag.current = k;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Certificates</span></div>
      <div className="page-head">
        <div>
          <h1>Certificates</h1>
          <div className="meta">One per competitor, with their award. Each carries a code anyone can check.</div>
        </div>
        <div className="actions">
          <Segmented label="Division" value={div} onChange={(d) => { setDiv(d); setSel(0); }} items={contest.divisions.map((d) => ({ key: d.id, label: d.name, count: (standings.individuals[d.id] ?? []).length }))} />
        </div>
      </div>

      {!p ? (
        <div className="callout amber">No scores yet, so no awards to print. Use the demo switch, bottom right, to jump to after the contest.</div>
      ) : (
        <div className="grid-main-side" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
          <div className="stack">
            <div
              ref={frame}
              className="cert"
              style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              onPointerMove={onMove}
              onPointerUp={() => (drag.current = null)}
            >
              {!bg && (
                <div style={{ position: 'absolute', top: '15%', left: 0, right: 0 }}>
                  <div className="c-eyebrow">{db.orgs[0].name} presents</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{contest.name}</div>
                </div>
              )}
              <div onPointerDown={grab('name')} style={{ position: 'absolute', left: `${pos.name.x}%`, top: `${pos.name.y}%`, transform: 'translate(-50%, -50%)', cursor: 'grab', touchAction: 'none', whiteSpace: 'nowrap' }} title="Drag to place">
                <div className="c-name" style={{ margin: 0 }}>{p.name}</div>
              </div>
              <div onPointerDown={grab('award')} style={{ position: 'absolute', left: `${pos.award.x}%`, top: `${pos.award.y}%`, transform: 'translate(-50%, -50%)', cursor: 'grab', touchAction: 'none', whiteSpace: 'nowrap' }} title="Drag to place">
                <div className="c-award">{p.award}</div>
                <div className="sub" style={{ fontSize: 12 }}>{contest.divisions.find((d) => d.id === div)?.name} division · {contest.dateLabel.replace('Saturday ', '')}</div>
              </div>
              <div className="c-foot">
                <span>{p.id}</span>
                <span>Verify at mathcloud.app/v · {verifyCode(contest.slug, p.id)}</span>
              </div>
            </div>
            <p className="sub" style={{ fontSize: 12.5 }}>Drag the name and the award to where your design wants them. Long names shrink to fit; names your font cannot set are held back for you to check rather than printed as boxes.</p>
          </div>

          <div className="stack">
            <div className="panel panel-pad stack">
              <h3>Design</h3>
              <label className="btn" style={{ position: 'relative', overflow: 'hidden' }}>
                Upload your own (PNG or JPG, landscape)
                <input type="file" accept="image/*" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setBg(String(reader.result));
                  reader.readAsDataURL(f);
                }} />
              </label>
              {bg && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setBg(null)}>Use the plain design</button>}
              <p className="sub" style={{ fontSize: 12 }}>Export from Canva as a PNG. PDF templates are stamped with real vector text, as in your certificate script.</p>
            </div>
            <div className="panel">
              <div className="panel-head"><h3>Preview as</h3></div>
              <div className="panel-body stack" style={{ gap: 8 }}>
                <select className="select" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                  {people.map((x, i) => <option key={x.id} value={i}>{x.id} {x.name}, {x.award}</option>)}
                </select>
                {Object.entries(byAward).map(([award, n]) => (
                  <div key={award} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span>{award}</span><span className="mono sub">{n}</span></div>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => {
              const [now, later] = queueSends('tpl-results', people.map((x) => x.email));
              toast(`Certificates going to ${people.length}`, `${now} sent now${later ? `, ${later} tomorrow (daily limit)` : ''}. Each email carries that person’s own PDF.`, 'g');
            }}>Email all {people.length} certificates</button>
          </div>
        </div>
      )}
    </>
  );
}
