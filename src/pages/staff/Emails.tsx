import { useMemo, useRef, useState } from 'react';
import { queueSends, saveTemplate } from '../../lib/actions';
import { ordinal, useContest, useStandings } from '../../lib/hooks';
import type { DB, EmailTemplate } from '../../lib/model';
import type { Standings } from '../../lib/scoring/engine';
import { useDB } from '../../lib/store';
import { missingVars, render, type Ctx } from '../../lib/templates';
import { Modal, Status, toast } from '../../components/ui';

type Recipient = { to: string; label: string; ctx: Ctx };

const first = (name: string) => name.split(/\s+/)[0];

export function recipientsFor(t: EmailTemplate, db: DB, standings: Standings): Recipient[] {
  const contest = db.contests[0];
  const contestCtx = { name: contest.short, date: contest.dateLabel };
  const liveTeams = db.teams.filter((x) => x.status !== 'withdrawn');
  const divisionName = (id: string) => contest.divisions.find((d) => d.id === id)?.name ?? id;
  if (t.audience === 'contacts') {
    return liveTeams.map((team) => ({
      to: team.contactEmail,
      label: `${team.code} ${team.name}`,
      ctx: {
        contest: contestCtx,
        team: { name: team.name, code: team.code },
        contact: { name: team.contactName, first_name: first(team.contactName) },
        division: team.divisionId,
        members: db.competitors.filter((c) => c.teamId === team.id).map((c) => ({ id: c.publicId, name: c.name })),
      },
    }));
  }
  const comps = db.competitors.filter((c) => liveTeams.some((x) => x.id === c.teamId));
  if (t.audience === 'guardians') {
    return comps
      .filter((c) => t.trigger !== 'waiver_missing' || !c.waiverSignedAt)
      .map((c) => ({
        to: c.guardianEmail,
        label: `${c.publicId} ${c.guardianName}`,
        ctx: { contest: contestCtx, guardian: { name: c.guardianName }, competitor: { name: c.name, id: c.publicId, first_name: first(c.name) }, waiver_link: `https://mathcloud.app/w/${c.publicId.toLowerCase()}` },
      }));
  }
  return comps
    .filter((c) => t.trigger !== 'before_contest' || liveTeams.find((x) => x.id === c.teamId)?.divisionId === 'online')
    .map((c) => {
      const team = liveTeams.find((x) => x.id === c.teamId)!;
      const room = contest.rooms.find((r) => r.teamIds.includes(team.id));
      const user = db.users.find((u) => u.competitorId === c.id);
      const row = standings.individuals[team.divisionId]?.find((r) => r.competitor.id === c.id);
      return {
        to: user && !user.managed ? user.email : c.guardianEmail,
        label: `${c.publicId} ${c.name}`,
        ctx: {
          contest: contestCtx,
          competitor: { name: c.name, first_name: first(c.name), id: c.publicId, login: user?.email ?? `sfmo-${c.publicId.toLowerCase()}` },
          zoom: { room: room?.name ?? 'your room', link: room?.url ?? '' },
          portal_link: 'https://mathcloud.app/sfmo-2027',
          division: { name: divisionName(team.divisionId) },
          score: { individual: row ? `${row.score} of ${row.max}` : '—' },
          place: { individual: row ? ordinal(row.place) : '—' },
          award: row?.award ?? '',
          report_link: `https://mathcloud.app/r/${c.publicId.toLowerCase()}`,
        },
      };
    });
}

const VARS: Record<EmailTemplate['audience'], string[]> = {
  contacts: ['contest.name', 'contest.date', 'team.name', 'team.code', 'contact.first_name', 'division'],
  guardians: ['contest.name', 'guardian.name', 'competitor.name', 'competitor.id', 'waiver_link'],
  students: ['contest.name', 'competitor.first_name', 'competitor.id', 'competitor.login', 'zoom.room', 'zoom.link', 'score.individual', 'place.individual', 'award', 'report_link'],
};

export function Emails() {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const [id, setId] = useState(db.templates[0].id);
  const t = db.templates.find((x) => x.id === id)!;
  const recipients = useMemo(() => recipientsFor(t, db, standings), [t, db, standings]);
  const [who, setWho] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const r = recipients[Math.min(who, recipients.length - 1)];
  const org = db.orgs[0];
  const sentToday = db.sends.filter((s) => new Date(s.at).toDateString() === new Date().toDateString()).length;
  const already = db.sends.filter((s) => s.templateId === t.id).length;
  const missing = r ? missingVars(t.subject + t.body, r.ctx) : [];

  const insert = (v: string) => {
    const el = body.current;
    if (!el) return;
    const at = el.selectionStart ?? t.body.length;
    const next = `${t.body.slice(0, at)}{{${v}}}${t.body.slice(el.selectionEnd ?? at)}`;
    saveTemplate({ ...t, body: next });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = at + v.length + 4; });
  };

  return (
    <>
      <div className="crumbs"><span>{contest.short}</span><span>/</span><span>Emails</span></div>
      <div className="page-head">
        <div>
          <h1>Emails</h1>
          <div className="meta">
            Sent from <b className="mono" style={{ fontWeight: 500 }}>{org.emailProvider.from}</b> through your Resend account
            <span className="dot-sep" />
            {sentToday} of {org.emailProvider.dailyLimit} sent today
          </div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => toast('Email settings', 'Choose Resend (API key and domain), your own SMTP login, or the Gmail relay. Keys are stored encrypted and never shown again.')}>Sending settings</button>
        </div>
      </div>

      <div className="grid-main-side" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>
        <div className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-head"><h3>Templates</h3></div>
          <div style={{ padding: 6 }}>
            {db.templates.map((x) => (
              <button key={x.id} type="button" className={`pop-item ${x.id === id ? 'on' : ''}`} onClick={() => { setId(x.id); setWho(0); }}>
                <span>{x.name}</span>
              </button>
            ))}
          </div>
          <div className="panel-body sub" style={{ fontSize: 12.5, borderTop: '1px solid var(--line)' }}>
            Templates send themselves when their moment comes (a registration, a missing waiver a week out, results published), or by hand.
          </div>
        </div>

        <div className="stack">
          <div className="grid-2">
            <div className="panel panel-pad stack">
              <label className="field"><span>Subject</span><input className="input" value={t.subject} onChange={(e) => saveTemplate({ ...t, subject: e.target.value })} /></label>
              <label className="field"><span>Message</span><textarea ref={body} className="textarea mono" style={{ minHeight: 300 }} value={t.body} onChange={(e) => saveTemplate({ ...t, body: e.target.value })} /></label>
              <div className="field">
                <span>Insert a field</span>
                <div className="row-wrap" style={{ gap: 4 }}>
                  {VARS[t.audience].map((v) => <button key={v} type="button" className="var" onClick={() => insert(v)}>{v}</button>)}
                </div>
                <small>Paste your own HTML here if you prefer; the same fields work inside it.</small>
              </div>
            </div>
            <div className="panel" style={{ alignSelf: 'start' }}>
              <div className="panel-head">
                <h3>Preview</h3>
                <select className="select input-sm" style={{ width: 'auto', maxWidth: 220, height: 28 }} value={who} onChange={(e) => setWho(Number(e.target.value))}>
                  {recipients.map((x, i) => <option key={x.to + i} value={i}>{x.label}</option>)}
                </select>
              </div>
              {r ? (
                <div className="email-preview">
                  <div className="sub" style={{ fontSize: 12, marginBottom: 6, whiteSpace: 'normal' }}>To {r.to}</div>
                  <div className="subj">{render(t.subject, r.ctx)}</div>
                  {render(t.body, r.ctx)}
                </div>
              ) : (
                <p className="panel-body sub">Nobody matches this template right now.</p>
              )}
              {missing.length > 0 && <div className="callout amber" style={{ margin: 12 }}>These fields have no value for this person: {missing.join(', ')}</div>}
            </div>
          </div>

          <div className="panel panel-pad row-wrap" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{recipients.length}</b> {t.audience} would get this.
              {already > 0 && <span className="sub"> {already} already have; they will not get it twice.</span>}
            </span>
            <div className="row">
              <button className="btn" type="button" onClick={() => toast('Test sent to you', `“${r ? render(t.subject, r.ctx) : t.subject}”`, 'g')}>Send a test to me</button>
              <button className="btn btn-primary" type="button" disabled={!recipients.length} onClick={() => setConfirm(true)}>Send to {recipients.length}</button>
            </div>
          </div>

          {db.sends.length > 0 && (
            <div className="panel table-wrap">
              <table className="t">
                <thead><tr><th>To</th><th>Template</th><th>Status</th></tr></thead>
                <tbody>
                  {db.sends.slice(-8).reverse().map((s) => (
                    <tr key={s.id}><td className="mono" style={{ fontSize: 12.5 }}>{s.to}</td><td>{db.templates.find((x) => x.id === s.templateId)?.name}</td><td>{s.status === 'sent' ? <Status tone="green">Sent</Status> : <Status tone="amber">Queued for tomorrow</Status>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <Modal
          title={`Send “${t.name}” to ${recipients.length}?`}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => {
                const [now, later] = queueSends(t.id, recipients.map((x) => x.to));
                setConfirm(false);
                toast(`${now} sent${later ? `, ${later} queued` : ''}`, later ? `Your provider allows ${org.emailProvider.dailyLimit} a day. The rest go tomorrow at 00:00 UTC, or raise the limit in Resend to send them now.` : 'Each person gets their own copy.', later ? 'a' : 'g');
              }}>Send</button>
            </>
          }
        >
          <p>
            Each person gets their own email with their own details filled in. Your Resend plan sends {Math.max(0, org.emailProvider.dailyLimit - sentToday)} more today
            {recipients.length > org.emailProvider.dailyLimit - sentToday ? '; the rest wait for tomorrow.' : '.'} Anyone who already got this template is skipped.
          </p>
        </Modal>
      )}
    </>
  );
}
