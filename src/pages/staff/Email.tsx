import { useMemo, useRef, useState } from 'react';
import { queueSends, saveTemplate } from '../../lib/actions';
import { ordinal, useStandings } from '../../lib/hooks';
import type { DB, EmailTemplate } from '../../lib/model';
import type { Standings } from '../../lib/scoring/engine';
import { useDB } from '../../lib/store';
import { missingVars, render, type Ctx } from '../../lib/templates';
import { Modal, State, toast } from '../../components/ui';

type Recipient = { to: string; label: string; ctx: Ctx };
const first = (name: string) => name.split(/\s+/)[0];

const WHEN: Record<EmailTemplate['trigger'], string> = {
  registered: 'When a team registers',
  waiver_missing: 'A week before, to missing waivers',
  before_contest: 'Three days before, online only',
  results: 'When results are published',
  manual: 'Sent by hand',
};

export function recipientsFor(t: EmailTemplate, db: DB, standings: Standings): Recipient[] {
  const contest = db.contests[0];
  const c0 = { name: contest.short, date: contest.dateLabel };
  const teams = db.teams.filter((x) => x.status !== 'withdrawn');
  if (t.audience === 'contacts') {
    return teams.map((team) => ({
      to: team.contactEmail,
      label: `${team.code} ${team.name}`,
      ctx: {
        contest: c0,
        team: { name: team.name, code: team.code },
        contact: { name: team.contactName, first_name: first(team.contactName) },
        division: team.divisionId,
        members: db.competitors.filter((c) => c.teamId === team.id).map((c) => ({ id: c.publicId, name: c.name })),
      },
    }));
  }
  const comps = db.competitors.filter((c) => teams.some((x) => x.id === c.teamId));
  if (t.audience === 'guardians') {
    return comps
      .filter((c) => t.trigger !== 'waiver_missing' || !c.waiverSignedAt)
      .map((c) => ({
        to: c.guardianEmail,
        label: `${c.publicId} ${c.guardianName}`,
        ctx: { contest: c0, guardian: { name: c.guardianName }, competitor: { name: c.name, id: c.publicId, first_name: first(c.name) }, waiver_link: `https://mathcloud.app/w/${c.publicId.toLowerCase()}` },
      }));
  }
  return comps
    .filter((c) => t.trigger !== 'before_contest' || teams.find((x) => x.id === c.teamId)?.divisionId === 'online')
    .map((c) => {
      const team = teams.find((x) => x.id === c.teamId)!;
      const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
      const user = db.users.find((u) => u.competitorId === c.id);
      const row = standings.individuals[team.divisionId]?.find((r) => r.competitor.id === c.id);
      return {
        to: user && !user.managed ? user.email : c.guardianEmail,
        label: `${c.publicId} ${c.name}`,
        ctx: {
          contest: c0,
          competitor: { name: c.name, first_name: first(c.name), id: c.publicId, login: user?.email ?? `sfmo-${c.publicId.toLowerCase()}` },
          zoom: { room: room?.name ?? 'your room', link: room?.url ?? '' },
          portal_link: 'https://mathcloud.app/sfmo-2027',
          division: { name: contest.divisions.find((d) => d.id === team.divisionId)?.name },
          score: { individual: row ? `${row.score} of ${row.max}` : '–' },
          place: { individual: row ? ordinal(row.place) : '–' },
          award: row?.award ?? '',
          report_link: `https://mathcloud.app/r/${c.publicId.toLowerCase()}`,
        },
      };
    });
}

const FIELDS: Record<EmailTemplate['audience'], string[]> = {
  contacts: ['contest.name', 'contest.date', 'team.name', 'team.code', 'contact.first_name'],
  guardians: ['contest.name', 'guardian.name', 'competitor.name', 'competitor.id', 'waiver_link'],
  students: ['contest.name', 'competitor.first_name', 'competitor.id', 'competitor.login', 'zoom.room', 'zoom.link', 'score.individual', 'place.individual', 'award', 'report_link'],
};

export function Email() {
  const db = useDB();
  const standings = useStandings();
  const [id, setId] = useState(db.templates[0].id);
  const t = db.templates.find((x) => x.id === id)!;
  const recipients = useMemo(() => recipientsFor(t, db, standings), [t, db, standings]);
  const [who, setWho] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const r = recipients[Math.min(who, recipients.length - 1)];
  const org = db.orgs[0];
  const today = new Date().toDateString();
  const sentToday = db.sends.filter((s) => new Date(s.at).toDateString() === today).length;
  const already = db.sends.filter((s) => s.templateId === t.id).length;
  const missing = r ? missingVars(t.subject + t.body, r.ctx) : [];

  const insert = (v: string) => {
    const el = body.current;
    if (!el) return;
    const at = el.selectionStart ?? t.body.length;
    saveTemplate({ ...t, body: `${t.body.slice(0, at)}{{${v}}}${t.body.slice(el.selectionEnd ?? at)}` });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = at + v.length + 4;
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Email</h1>
          <p className="page-sub">From <span className="mono small">{org.emailProvider.from}</span> through your Resend account · {sentToday} of {org.emailProvider.dailyLimit} sent today</p>
        </div>
        <button className="btn" type="button" onClick={() => toast('Sending settings', 'Resend key and domain, your own email login, or the Gmail relay. Keys are stored encrypted.')}>Sending settings</button>
      </div>

      <div className="split" style={{ gridTemplateColumns: '220px minmax(0, 1fr)' }}>
        <aside className="stack" style={{ gap: 2 }}>
          {db.templates.map((x) => (
            <button key={x.id} type="button" className={`list-btn ${x.id === id ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }} onClick={() => { setId(x.id); setWho(0); }}>
              <span>{x.name}</span>
              <span className="muted tiny" style={{ fontWeight: 400 }}>{WHEN[x.trigger]}</span>
            </button>
          ))}
        </aside>

        <div className="stack-lg" style={{ gap: 28 }}>
          <div className="split-wide">
            <div className="stack">
              <label className="field"><span>Subject</span><input className="input" value={t.subject} onChange={(e) => saveTemplate({ ...t, subject: e.target.value })} /></label>
              <label className="field"><span>Message</span><textarea ref={body} className="textarea" style={{ minHeight: 300, fontSize: 13.5 }} value={t.body} onChange={(e) => saveTemplate({ ...t, body: e.target.value })} /></label>
              <div className="row wrap" style={{ gap: 6 }}>
                {FIELDS[t.audience].map((v) => <button key={v} type="button" className="chip-var" onClick={() => insert(v)}>{v}</button>)}
              </div>
            </div>
            <div className="stack">
              <label className="field">
                <span>Preview for</span>
                <select className="select" value={who} onChange={(e) => setWho(Number(e.target.value))}>
                  {recipients.map((x, i) => <option key={x.to + i} value={i}>{x.label}</option>)}
                </select>
              </label>
              {r ? (
                <div className="note" style={{ background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line)', padding: '18px 20px' }}>
                  <div className="muted tiny">To {r.to}</div>
                  <div className="strong" style={{ fontSize: 15, margin: '6px 0 12px' }}>{render(t.subject, r.ctx)}</div>
                  <div className="email">{render(t.body, r.ctx)}</div>
                </div>
              ) : <p className="muted">Nobody gets this one right now.</p>}
              {missing.length > 0 && <div className="note amber small">No value for {missing.join(', ')}.</div>}
            </div>
          </div>
          <div className="row wrap section" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{recipients.length}</b> people get this.{already > 0 && <span className="muted"> {already} already have, and won’t get it twice.</span>}
            </span>
            <div className="actions">
              <button className="btn" type="button" onClick={() => toast('Test sent to you', r ? render(t.subject, r.ctx) : t.subject, 'g')}>Send me a test</button>
              <button className="btn btn-primary" type="button" disabled={!recipients.length} onClick={() => setConfirm(true)}>Send to {recipients.length}</button>
            </div>
          </div>
          {db.sends.length > 0 && (
            <div className="table-scroll">
              <table className="t">
                <thead><tr><th>To</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                  {db.sends.slice(-6).reverse().map((s) => (
                    <tr key={s.id}><td className="soft">{s.to}</td><td>{db.templates.find((x) => x.id === s.templateId)?.name}</td><td>{s.status === 'sent' ? <State tone="ok">Sent</State> : <State tone="wait">Tomorrow</State>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <Modal
          title={`Send to ${recipients.length}?`}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => {
                const [now, later] = queueSends(t.id, recipients.map((x) => x.to));
                setConfirm(false);
                toast(`${now} sent${later ? `, ${later} tomorrow` : ''}`, later ? `Resend allows ${org.emailProvider.dailyLimit} a day on your plan.` : undefined, later ? 'a' : 'g');
              }}>Send</button>
            </>
          }
        >
          <p>Everyone gets their own copy with their details filled in. {Math.max(0, org.emailProvider.dailyLimit - sentToday)} more can go today; the rest go tomorrow.</p>
        </Modal>
      )}
    </>
  );
}
