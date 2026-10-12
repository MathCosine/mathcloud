import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { queueSends } from '../../lib/actions';
import { useContest, useStandings } from '../../lib/hooks';
import { useDB } from '../../lib/store';
import { Segmented, toast } from '../../components/ui';

/** A short code printed on each certificate that anyone can check. */
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
  const [pos, setPos] = useState<{ name: Pos; award: Pos }>({ name: { x: 50, y: 48 }, award: { x: 50, y: 62 } });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<'name' | 'award' | null>(null);
  const people = useMemo(
    () => (standings.individuals[div] ?? []).map((r) => ({ id: r.competitor.publicId, name: r.competitor.name, award: r.award ?? 'Participation', email: r.competitor.guardianEmail })),
    [standings, div],
  );
  const [sel, setSel] = useState(0);
  const p = people[Math.min(sel, people.length - 1)];
  const counts = people.reduce<Record<string, number>>((m, x) => ({ ...m, [x.award]: (m[x.award] ?? 0) + 1 }), {});

  const move = (e: RPE<HTMLDivElement>) => {
    if (!drag.current || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    const x = Math.round(Math.max(8, Math.min(92, ((e.clientX - r.left) / r.width) * 100)));
    const y = Math.round(Math.max(10, Math.min(90, ((e.clientY - r.top) / r.height) * 100)));
    setPos((s) => ({ ...s, [drag.current!]: { x, y } }));
  };
  const grab = (k: 'name' | 'award') => (e: RPE<HTMLDivElement>) => {
    drag.current = k;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Certificates</h1>
          <p className="page-sub">One for every competitor, with their award and a code anyone can check.</p>
        </div>
        <Segmented label="Division" value={div} onChange={(d) => { setDiv(d); setSel(0); }} items={contest.divisions.map((d) => ({ key: d.id, label: d.name }))} />
      </div>

      {!p ? (
        <div className="note">No scores yet, so no awards. Open the Demo menu and choose After the contest.</div>
      ) : (
        <div className="split">
          <div className="stack">
            <div ref={frame} className="cert" style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
              {!bg && (
                <>
                  <div className="cert-frame" />
                  <div style={{ position: 'absolute', top: '17%', left: 0, right: 0, textAlign: 'center' }}>
                    <div style={{ fontSize: 'clamp(10px, 1.2vw, 13px)', color: '#4A5160' }}>{db.orgs[0].name} awards</div>
                    <div style={{ fontWeight: 700, fontSize: 'clamp(13px, 1.6vw, 18px)', marginTop: 4 }}>{contest.name}</div>
                  </div>
                </>
              )}
              <div className="cert-field" style={{ left: `${pos.name.x}%`, top: `${pos.name.y}%` }} onPointerDown={grab('name')} title="Drag to move">
                <div style={{ fontSize: 'clamp(20px, 3.4vw, 40px)', fontWeight: 700, letterSpacing: '-.02em' }}>{p.name}</div>
              </div>
              <div className="cert-field" style={{ left: `${pos.award.x}%`, top: `${pos.award.y}%` }} onPointerDown={grab('award')} title="Drag to move">
                <div style={{ fontSize: 'clamp(13px, 1.7vw, 19px)', fontWeight: 700, color: '#2346C8' }}>{p.award}</div>
                <div style={{ fontSize: 'clamp(10px, 1.1vw, 12px)', color: '#4A5160' }}>{contest.divisions.find((d) => d.id === div)?.name} division · 23 January 2027</div>
              </div>
              <div style={{ position: 'absolute', bottom: '8%', left: '9%', right: '9%', display: 'flex', justifyContent: 'space-between', font: '500 clamp(9px, 1vw, 11px) var(--mono)', color: '#868C98' }}>
                <span>{p.id}</span>
                <span>Check at mathcloud.app/v · {verifyCode(contest.slug, p.id)}</span>
              </div>
            </div>
            <p className="muted small">Drag the name and the award into place. Long names shrink to fit.</p>
          </div>

          <aside className="stack-lg" style={{ gap: 24 }}>
            <label className="field">
              <span>Preview</span>
              <select className="select" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                {people.map((x, i) => <option key={x.id} value={i}>{x.id} {x.name}</option>)}
              </select>
            </label>
            <div>
              {Object.entries(counts).map(([award, n]) => (
                <div key={award} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                  <span>{award}</span><span className="soft">{n}</span>
                </div>
              ))}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <label className="btn" style={{ position: 'relative', overflow: 'hidden' }}>
                Use your own design
                <input type="file" accept="image/*" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setBg(String(reader.result));
                  reader.readAsDataURL(f);
                }} />
              </label>
              {bg && <button className="btn btn-quiet" type="button" onClick={() => setBg(null)}>Back to the plain design</button>}
              <span className="muted tiny">A PNG or JPG exported from Canva, landscape.</span>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => {
              const [now, later] = queueSends('tpl-results', people.map((x) => x.email));
              toast(`Sending ${people.length} certificates`, later ? `${now} today, ${later} tomorrow (daily limit).` : `${now} sent.`, 'g');
            }}>Email {people.length} certificates</button>
          </aside>
        </div>
      )}
    </>
  );
}
