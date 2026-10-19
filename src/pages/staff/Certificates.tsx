import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { createPortal } from 'react-dom';
import { useContest, useStandings } from '../../lib/hooks';
import { useDB } from '../../lib/store';
import { Segmented } from '../../components/ui';
import { Icon } from '../../components/icons';
import { usePrint } from './print';

/** A short code printed on each certificate that anyone can check. */
export function verifyCode(contestSlug: string, publicId: string) {
  let h = 2166136261;
  for (const ch of `${contestSlug}:${publicId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const s = (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

type Pos = { x: number; y: number };
type Person = { id: string; name: string; award: string };
type Layout = { name: Pos; award: Pos };

/** One certificate. Sizes are in container units, so it prints the same as it looks. */
function Cert({ p, bg, pos, org, contest, division, date, slug, frameRef, onMove, onUp, grab }: {
  p: Person; bg: string | null; pos: Layout; org: string; contest: string; division: string; date: string; slug: string;
  frameRef?: React.RefObject<HTMLDivElement | null>; onMove?: (e: RPE<HTMLDivElement>) => void; onUp?: () => void; grab?: (k: 'name' | 'award') => (e: RPE<HTMLDivElement>) => void;
}) {
  return (
    <div ref={frameRef} className="cert cert-cq" style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} onPointerMove={onMove} onPointerUp={onUp}>
      {!bg && (
        <>
          <div className="cert-frame" />
          <div className="cert-top">
            <div className="cert-org">{org} awards</div>
            <div className="cert-contest">{contest}</div>
          </div>
        </>
      )}
      <div className="cert-field" style={{ left: `${pos.name.x}%`, top: `${pos.name.y}%` }} onPointerDown={grab?.('name')} title={grab ? 'Drag to move' : undefined}>
        <div className="cert-name" style={p.name.length > 22 ? { fontSize: `${Math.max(3.2, 5.6 * (22 / p.name.length))}cqw` } : undefined}>{p.name}</div>
      </div>
      <div className="cert-field" style={{ left: `${pos.award.x}%`, top: `${pos.award.y}%` }} onPointerDown={grab?.('award')} title={grab ? 'Drag to move' : undefined}>
        <div className="cert-award">{p.award}</div>
        <div className="cert-sub">{division} division · {date}</div>
      </div>
      <div className="cert-foot">
        <span>{p.id}</span>
        <span>Check at mathcloud.app/v · {verifyCode(slug, p.id)}</span>
      </div>
    </div>
  );
}

/** Certificates: one per competitor, with their award and a code anyone can check. */
export function CertificatesPanel({ slot }: { slot?: HTMLElement | null }) {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const [div, setDiv] = useState(contest.divisions[0]?.id ?? '');
  const [bg, setBg] = useState<string | null>(null);
  const [pos, setPos] = useState<Layout>({ name: { x: 50, y: 48 }, award: { x: 50, y: 62 } });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<'name' | 'award' | null>(null);
  const { print, portal } = usePrint();
  const people = useMemo<Person[]>(
    () => (standings.individuals[div] ?? []).map((r) => ({ id: r.competitor.publicId, name: r.competitor.name, award: r.award ?? 'Participation' })),
    [standings, div],
  );
  const [sel, setSel] = useState(0);
  const p = people[Math.min(sel, people.length - 1)];
  const counts = people.reduce<Record<string, number>>((m, x) => ({ ...m, [x.award]: (m[x.award] ?? 0) + 1 }), {});
  const divName = contest.divisions.find((d) => d.id === div)?.name ?? '';
  const common = { bg, pos, org: db.orgs[0]?.name ?? '', contest: contest.name, division: divName, date: contest.dateLabel, slug: contest.slug };

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
  const printList = (list: Person[]) => print(list.map((x) => <div key={x.id} className="print-cert"><Cert p={x} {...common} /></div>));

  return (
    <>
      {(() => {
        const buttons = p && (
          <>
            <button className="btn" type="button" onClick={() => printList([p])}>Print {p.name.split(' ')[0]}’s</button>
            <button className="btn btn-primary" type="button" onClick={() => printList(people)}><Icon name="certificate" />Print {people.length} certificates</button>
          </>
        );
        return slot ? buttons && createPortal(buttons, slot) : buttons && <div className="toolbar" style={{ marginBottom: 16 }}><span className="grow" />{buttons}</div>;
      })()}
      {contest.divisions.length > 1 && (
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Segmented label="Division" value={div} onChange={(d) => { setDiv(d); setSel(0); }} items={contest.divisions.map((d) => ({ key: d.id, label: d.name, count: standings.individuals[d.id]?.length ?? 0 }))} />
        </div>
      )}

      {!p ? (
        <div className="note">No Individual scores in this division yet, so no awards. Certificates appear once papers are graded.</div>
      ) : (
        <div className="split">
          <div className="stack">
            <Cert p={p} {...common} frameRef={frame} onMove={move} onUp={() => (drag.current = null)} grab={grab} />
            <p className="muted small">Drag the name and the award into place. Long names shrink to fit. Prints landscape, one per page.</p>
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
          </aside>
        </div>
      )}
      {portal}
    </>
  );
}
