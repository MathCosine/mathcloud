import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { addEmailKey, removeEmailKey, saveEmailKey, saveTemplate } from '../../lib/actions';
import { useContest, useStandings } from '../../lib/hooks';
import type { EmailKey, EmailSend, EmailTemplate } from '../../lib/model';
import { useDB, REMOTE } from '../../lib/store';
import { missingVars, render } from '../../lib/templates';
import { capacityToday, orgOf, sentToday, type Capacity } from '../../lib/reports';
import { alreadyHave, AUDIENCE_LABEL, FIELDS, flushQueue, recipients, sendComposed, type Audience, type Filter, type Recipient } from '../../lib/email';
import { ArtEmpty } from '../../components/art';
import { Icon } from '../../components/icons';
import { Checkbox, Modal, Segmented, State, Tabs, toast } from '../../components/ui';
import { CapacityNote } from './Reports';
import '../../styles/reports.css';

type Tab = 'compose' | 'templates' | 'keys' | 'log';
const TABS: Tab[] = ['compose', 'templates', 'keys', 'log'];

const WHEN: Record<EmailTemplate['trigger'], string> = {
  registered: 'When a team registers',
  waiver_missing: 'To guardians with no waiver',
  before_contest: 'Before the contest',
  results: 'When results are published',
  manual: 'Sent by hand',
};

export function Email() {
  const db = useDB();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'compose';
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setParams({ ...(t === 'compose' ? {} : { tab: t }), ...extra }, { replace: true });
  const cap = capacityToday(db);
  const queued = db.sends.filter((s) => s.status === 'queued').length;
  const failed = db.sends.filter((s) => s.status === 'failed').length;
  const keys = orgOf(db)?.emailKeys ?? [];
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const active = keys.filter((k) => k.active).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Email</h1>
          <p className="page-sub">
            {cap.noKeys && REMOTE
              ? <>No sending key yet, so nothing can go out. <Link to="/staff/email?tab=keys">Add a key</Link>.</>
              : <>{cap.used} of {cap.capacity} sent today{!cap.noKeys && <> across {active} key{active === 1 ? '' : 's'}</>}{queued > 0 && <> · <span className="wait">{queued} waiting</span></>}{failed > 0 && <> · <span className="bad">{failed} failed</span></>}{cap.noKeys && <span className="muted"> · Sandbox: sends are only counted</span>}</>}
          </p>
        </div>
        <div className="actions" ref={setSlot} />
      </div>
      <Tabs value={tab} onChange={(t) => setTab(t)} items={[
        { key: 'compose', label: 'Compose' },
        { key: 'templates', label: 'Templates', count: db.templates.length },
        { key: 'keys', label: 'Sending keys', count: keys.length },
        { key: 'log', label: 'Log', count: queued + failed || undefined },
      ]} />
      {tab === 'compose' && <Compose initial={params.get('template')} slot={slot} />}
      {tab === 'templates' && <Templates onUse={(id) => setTab('compose', { template: id })} slot={slot} />}
      {tab === 'keys' && <Keys cap={cap} />}
      {tab === 'log' && <Log slot={slot} />}
    </>
  );
}

// -------------------------------------------------------------------- compose

function filterItems(divisions: { id: string; name: string }[]): { key: Filter; label: string }[] {
  return [
    { key: 'all', label: 'Everyone' },
    { key: 'missing_waivers', label: 'Missing waivers' },
    { key: 'pending', label: 'Pending teams' },
    ...divisions.map((d) => ({ key: `div:${d.id}` as Filter, label: `${d.name} division` })),
  ];
}

function Preview({ list, subject, body, who, setWho }: { list: Recipient[]; subject: string; body: string; who: number; setWho: (n: number) => void }) {
  const r = list[Math.min(who, list.length - 1)];
  const missing = r ? missingVars(subject + body, r.ctx) : [];
  const from = orgOf(useDB())?.emailKeys?.find((k) => k.active)?.from ?? orgOf(useDB())?.emailProvider.from ?? '';
  return (
    <div className="stack">
      <label className="field">
        <span>Preview for</span>
        <select className="select" value={Math.min(who, Math.max(0, list.length - 1))} onChange={(e) => setWho(Number(e.target.value))} disabled={!list.length}>
          {list.map((x, i) => <option key={x.to + x.key} value={i}>{x.label}</option>)}
        </select>
      </label>
      {r ? (
        <div className="ml-mail">
          <div className="ml-mail-head">
            <span>From</span><b>{from || 'Your sending key'}</b>
            <span>To</span><b>{r.to}</b>
            <span>Subject</span><b className="ml-mail-subj">{render(subject, r.ctx) || <span className="muted">No subject</span>}</b>
          </div>
          <div className="email">{render(body, r.ctx)}</div>
        </div>
      ) : (
        <div className="ml-mail row" style={{ gap: 16 }}>
          <ArtEmpty kind="mail" className="ml-art" />
          <p className="muted">Nobody matches this audience and filter.</p>
        </div>
      )}
      {missing.length > 0 && <div className="note amber small">No value for {missing.map((m) => `{{${m}}}`).join(', ')} for this person. It is sent as typed.</div>}
    </div>
  );
}

function VarChips({ audience, target, value, onChange }: { audience: Audience; target: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void }) {
  const insert = (v: string) => {
    const el = target.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(`${value.slice(0, at)}{{${v}}}${value.slice(end)}`);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + v.length + 4;
    });
  };
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="muted tiny">Insert</span>
      {FIELDS[audience].map((v) => <button key={v} type="button" className="chip-var" onClick={() => insert(v)}>{v}</button>)}
    </div>
  );
}

function Compose({ initial, slot }: { initial: string | null; slot: HTMLElement | null }) {
  const db = useDB();
  const contest = useContest();
  const standings = useStandings();
  const start = db.templates.find((t) => t.id === initial) ?? null;
  const [tplId, setTplId] = useState<string>(start?.id ?? '');
  const [audience, setAudience] = useState<Audience>(start?.audience ?? 'contacts');
  const [filter, setFilter] = useState<Filter>(start?.trigger === 'waiver_missing' ? 'missing_waivers' : 'all');
  const [subject, setSubject] = useState(start?.subject ?? '');
  const [body, setBody] = useState(start?.body ?? '');
  const [who, setWho] = useState(0);
  const [asking, setAsking] = useState(false);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const tpl = db.templates.find((t) => t.id === tplId) ?? null;
  const edited = !!tpl && (tpl.subject !== subject || tpl.body !== body);

  const list = useMemo(() => recipients(db, standings, audience, filter), [db, standings, audience, filter]);
  const have = useMemo(() => (tpl && !edited ? alreadyHave(db, tpl.id, list, subject) : new Set<string>()), [db, tpl, edited, list, subject]);
  const targets = again ? list : list.filter((r) => !have.has(`${r.to}|${r.key}`));

  const pick = (id: string) => {
    setTplId(id);
    const t = db.templates.find((x) => x.id === id);
    if (!t) return;
    setAudience(t.audience);
    setSubject(t.subject);
    setBody(t.body);
    setFilter(t.trigger === 'waiver_missing' ? 'missing_waivers' : 'all');
    setWho(0);
  };

  const send = async () => {
    setBusy(true);
    const r = await sendComposed(targets, subject, body, tpl && !edited ? tpl.id : null, again);
    setBusy(false);
    setAsking(false);
    setAgain(false);
    if (r.error) return toast('Not everything went out', r.error, 'r');
    toast(`${r.sent} sent${r.waiting ? `, ${r.waiting} waiting` : ''}`, r.waiting ? 'The rest go out tomorrow, when the daily limit resets.' : undefined, r.waiting ? 'a' : 'g');
  };

  return (
    <div className="ml-compose">
      {slot && createPortal(
        <button className="btn btn-primary" type="button" disabled={!targets.length || !subject.trim() || !body.trim()} title={!subject.trim() || !body.trim() ? 'Write a subject and a message first' : !targets.length ? 'Nobody to send to' : undefined} onClick={() => setAsking(true)}>
          <Icon name="mail" />Send to {targets.length}
        </button>,
        slot,
      )}
      <div className="stack">
        <label className="field">
          <span>Start from</span>
          <select className="select" value={tplId} onChange={(e) => (e.target.value ? pick(e.target.value) : setTplId(''))}>
            <option value="">A blank message</option>
            {db.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({AUDIENCE_LABEL[t.audience].toLowerCase()})</option>)}
          </select>
          {tpl && tpl.audience !== audience && <small>This template is written for {AUDIENCE_LABEL[tpl.audience].toLowerCase()}; check the preview for missing values.</small>}
          {edited && <small>Edited for this send only. The template itself stays as it is.</small>}
        </label>
        <div className="field">
          <span>To</span>
          <div className="row wrap" style={{ gap: 12 }}>
            <Segmented label="Audience" value={audience} onChange={(a) => { setAudience(a); setWho(0); }} items={(['contacts', 'guardians', 'students'] as Audience[]).map((a) => ({ key: a, label: AUDIENCE_LABEL[a] }))} />
            <select className="select" style={{ width: 'auto' }} aria-label="Filter" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setWho(0); }}>
              {filterItems(contest.divisions).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <small><b>{targets.length}</b> of {list.length} {AUDIENCE_LABEL[audience].toLowerCase()} get this.{have.size > 0 && !again ? ` ${have.size} already have it and are skipped.` : ''}</small>
        </div>
        <label className="field"><span>Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="{{contest.name}}: ..." /></label>
        <label className="field"><span>Message</span><textarea ref={ref} className="textarea" style={{ minHeight: 260, fontSize: 13.5 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {{contact.first_name}}, ..." /></label>
        <VarChips audience={audience} target={ref} value={body} onChange={setBody} />
      </div>

      <div className="stack">
        <Preview list={list} subject={subject} body={body} who={who} setWho={setWho} />
      </div>

      {asking && (
        <Modal
          title={`Send to ${targets.length}?`}
          onClose={() => !busy && setAsking(false)}
          actions={
            <>
              <button className="btn" type="button" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={busy || !targets.length} onClick={() => void send()}>{busy ? 'Sending…' : `Send ${targets.length}`}</button>
            </>
          }
        >
          <div className="stack">
            <p>Everyone gets their own copy, with their details filled in. Subject for the first: <b>{targets[0] ? render(subject, targets[0].ctx) : ''}</b></p>
            {have.size > 0 && (
              <label className="rp-check">
                <Checkbox checked={again} onChange={() => setAgain(!again)} label="Send again" />
                <span onClick={() => setAgain(!again)}>Also send again to the {have.size} who already have it</span>
              </label>
            )}
            <CapacityNote total={targets.length} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ templates

function Templates({ onUse, slot }: { onUse: (id: string) => void; slot: HTMLElement | null }) {
  const db = useDB();
  const standings = useStandings();
  const [id, setId] = useState(db.templates[0]?.id ?? '');
  const t = db.templates.find((x) => x.id === id) ?? db.templates[0];
  const [who, setWho] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const filter: Filter = t?.trigger === 'waiver_missing' ? 'missing_waivers' : 'all';
  const list = useMemo(() => (t ? recipients(db, standings, t.audience, filter) : []), [db, standings, t, filter]);
  const sent = t ? db.sends.filter((s) => s.templateId === t.id && s.status === 'sent').length : 0;

  const create = () => {
    const nt: EmailTemplate = { id: REMOTE ? crypto.randomUUID() : `tpl-${Math.random().toString(36).slice(2, 8)}`, name: 'New message', trigger: 'manual', audience: 'contacts', subject: '{{contest.name}}: ', body: 'Hi {{contact.first_name}},\n\n\n\nSF Math Initiative' };
    saveTemplate(nt);
    setId(nt.id);
    setWho(0);
  };

  return (
    <div className="ml-tpl">
      {slot && createPortal(
        <>
          <button className="btn" type="button" onClick={create}><Icon name="plus" />New template</button>
          {t && <button className="btn btn-primary" type="button" onClick={() => onUse(t.id)}><Icon name="mail" />Send this template</button>}
        </>,
        slot,
      )}
      <aside className="stack" style={{ gap: 2 }}>
        {db.templates.map((x) => (
          <button key={x.id} type="button" className={`list-btn ${x.id === t?.id ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }} onClick={() => { setId(x.id); setWho(0); }}>
            <span>{x.name}</span>
            <span className="muted tiny" style={{ fontWeight: 400 }}>{AUDIENCE_LABEL[x.audience]} · {WHEN[x.trigger]}</span>
          </button>
        ))}
      </aside>

      {t ? (
        <div className="split-wide">
          <div className="stack">
            <label className="field"><span>Name</span><input className="input" value={t.name} onChange={(e) => saveTemplate({ ...t, name: e.target.value })} /></label>
            <div className="form-grid">
              <label className="field">
                <span>Goes to</span>
                <select className="select" value={t.audience} onChange={(e) => { saveTemplate({ ...t, audience: e.target.value as Audience }); setWho(0); }}>
                  {(['contacts', 'guardians', 'students'] as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>When</span>
                <select className="select" value={t.trigger} onChange={(e) => saveTemplate({ ...t, trigger: e.target.value as EmailTemplate['trigger'] })}>
                  {(Object.keys(WHEN) as EmailTemplate['trigger'][]).map((k) => <option key={k} value={k}>{WHEN[k]}</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span>Subject</span><input className="input" value={t.subject} onChange={(e) => saveTemplate({ ...t, subject: e.target.value })} /></label>
            <label className="field"><span>Message</span><textarea ref={ref} className="textarea" style={{ minHeight: 300, fontSize: 13.5 }} value={t.body} onChange={(e) => saveTemplate({ ...t, body: e.target.value })} /></label>
            <VarChips audience={t.audience} target={ref} value={t.body} onChange={(body) => saveTemplate({ ...t, body })} />
            <p className="muted tiny">
              {'{{#if award}}…{{/if}}'} shows a part only when there is a value; {'{{#each members}}{{name}}{{/each}}'} repeats a line for each member. Changes save as you type.
            </p>
          </div>
          <div className="stack">
            <Preview list={list} subject={t.subject} body={t.body} who={who} setWho={setWho} />
            <span className="muted small">{list.length} {AUDIENCE_LABEL[t.audience].toLowerCase()} would get this{sent ? `; sent ${sent} times so far` : ''}. Send opens it in Compose to check before it goes.</span>
          </div>
        </div>
      ) : <p className="muted">No templates yet.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- sending keys

function CapacityBar({ cap }: { cap: Capacity }) {
  const total = Math.max(cap.capacity, 1);
  const colours = ['var(--blue)', '#5B78E0', '#8EA2EA', '#B9C6F2'];
  return (
    <div className="ml-cap">
      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div><span className="ml-cap-big">{cap.left}</span> <span className="soft">of {cap.capacity} emails left today</span></div>
        <span className="muted small">{cap.used} sent today · resets at midnight</span>
      </div>
      <div className="ml-cap-bar" role="img" aria-label={`${cap.used} of ${cap.capacity} used today`}>
        {cap.keys.length
          ? cap.keys.filter((k) => k.key.active).map((k, i) => (
              <div key={k.key.id} className="ml-cap-key" style={{ width: `${(k.key.dailyLimit / total) * 100}%` }} title={`${k.key.label}: ${k.used} of ${k.key.dailyLimit}`}>
                <div style={{ width: `${Math.min(100, (k.used / Math.max(1, k.key.dailyLimit)) * 100)}%`, background: colours[i % colours.length] }} />
                <div className="grow" style={{ background: 'var(--blue-soft)' }} />
              </div>
            ))
          : <div className="seg-used" style={{ width: `${Math.min(100, (cap.used / total) * 100)}%` }} />}
      </div>
      {cap.keys.length > 0 && (
        <div className="ml-cap-legend">
          {cap.keys.filter((k) => k.key.active).map((k, i) => <span key={k.key.id}><i style={{ background: colours[i % colours.length] }} />{k.key.label}: {k.used} of {k.key.dailyLimit}</span>)}
          <span><i style={{ background: 'var(--blue-soft)', boxShadow: 'inset 0 0 0 1px #D9E1FA' }} />Left today</span>
        </div>
      )}
      <p className="muted small">Resend's free plan sends 100 a day per key; add a second key to send 200. Each email goes through the first key with room left; what does not fit waits for tomorrow.</p>
    </div>
  );
}

function KeyRow({ k }: { k: EmailKey }) {
  const db = useDB();
  const used = sentToday(db, k.id);
  const [limit, setLimit] = useState(String(k.dailyLimit));
  const [asking, setAsking] = useState(false);
  useEffect(() => setLimit(String(k.dailyLimit)), [k.dailyLimit]);
  const commit = () => {
    const n = Math.round(Number(limit));
    if (!Number.isFinite(n) || n < 1) return setLimit(String(k.dailyLimit));
    if (n !== k.dailyLimit) saveEmailKey(k.id, { dailyLimit: n });
  };
  return (
    <tr className={k.active ? '' : 'dim'}>
      <td className="name">{k.label}</td>
      <td className="mono small">{k.from}</td>
      <td className="num"><input className="input ml-limit" type="number" min={1} value={limit} aria-label={`Daily limit for ${k.label}`} onChange={(e) => setLimit(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></td>
      <td>
        <span className="ml-use">
          <span className="track"><i className={used >= k.dailyLimit ? 'full' : ''} style={{ width: `${Math.min(100, (used / Math.max(1, k.dailyLimit)) * 100)}%` }} /></span>
          <span className="small">{used} / {k.dailyLimit}</span>
        </span>
      </td>
      <td><button type="button" role="switch" className="ml-switch" aria-checked={k.active} aria-label={`${k.label} active`} onClick={() => saveEmailKey(k.id, { active: !k.active })} /></td>
      <td className="wrap">{k.lastError ? <span className="ml-err">{k.lastError}</span> : <span className="muted small">None</span>}</td>
      <td className="num">
        <button className="btn btn-sm btn-quiet btn-danger" type="button" onClick={() => setAsking(true)}>Remove</button>
        {asking && (
          <Modal title={`Remove ${k.label}?`} onClose={() => setAsking(false)} actions={
            <>
              <button className="btn" type="button" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn btn-danger" type="button" onClick={() => { removeEmailKey(k.id); setAsking(false); toast('Key removed', k.label); }}>Remove</button>
            </>
          }>
            <p style={{ whiteSpace: 'normal' }}>The key is deleted here; it still exists in your Resend account until you revoke it there. Emails waiting in the queue go through your other keys.</p>
          </Modal>
        )}
      </td>
    </tr>
  );
}

function Keys({ cap }: { cap: Capacity }) {
  const db = useDB();
  const keys = orgOf(db)?.emailKeys ?? [];
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState(orgOf(db)?.emailProvider.from || '');
  const [limit, setLimit] = useState('100');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(limit));
    if (!label.trim() || !from.includes('@') || !secret.trim() || !(n > 0)) return toast('Fill in every field', 'A name, a from address with an @, a daily limit and the API key.', 'a');
    setBusy(true);
    const err = await addEmailKey(label.trim(), from.trim(), n, secret.trim());
    setBusy(false);
    setSecret('');
    if (err) return toast('Key not added', err, 'r');
    setLabel('');
    toast('Key added', `${label.trim()} can send ${n} a day.`, 'g');
  };

  return (
    <div className="stack-lg">
      <div className="card"><CapacityBar cap={cap} /></div>

      <div className="card flush">
        <div className="card-head"><h2>Keys</h2><span className="muted small">Used in this order</span></div>
        {keys.length ? (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Name</th><th>From</th><th className="num">Daily limit</th><th>Used today</th><th>Active</th><th>Last error</th><th /></tr></thead>
              <tbody>{keys.map((k) => <KeyRow key={k.id} k={k} />)}</tbody>
            </table>
          </div>
        ) : (
          <div className="row" style={{ padding: '18px 20px', gap: 18 }}>
            <ArtEmpty kind="mail" className="ml-art" />
            <p className="soft">{REMOTE ? 'No keys yet, so nothing can be sent. Add your first one below.' : 'No keys yet. In the sandbox, sending is only counted against a demo limit of 100 a day.'}</p>
          </div>
        )}
      </div>

      <form className="card stack" onSubmit={(e) => void add(e)}>
        <div>
          <h2 style={{ fontSize: 15 }}>Add a key</h2>
          <p className="muted small">Get one at resend.com: verify your domain under Domains, then API Keys, Create API key, with sending access.</p>
        </div>
        <div className="form-grid">
          <label className="field"><span>Name</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Resend, main account" /></label>
          <label className="field"><span>From address</span><input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="SFMO <hello@yourdomain.org>" /></label>
          <label className="field"><span>Daily limit</span><input className="input" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
          <label className="field">
            <span>API key</span>
            <input className="input mono" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="re_..." />
          </label>
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <span className="muted tiny">The key is stored encrypted on the server and never shown again.</span>
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="plus" />{busy ? 'Adding…' : 'Add key'}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------------ log

type LogFilter = 'all' | EmailSend['status'];
const STATUS: Record<EmailSend['status'], [Parameters<typeof State>[0]['tone'], string]> = { sent: ['ok', 'Sent'], queued: ['wait', 'Waiting'], failed: ['bad', 'Failed'] };
const KIND: Record<string, string> = { score_report: 'Score report', template: 'Template', message: 'Message', waiver_reminder: 'Waiver reminder', certificate: 'Certificate' };

function Log({ slot }: { slot: HTMLElement | null }) {
  const db = useDB();
  const [f, setF] = useState<LogFilter>('all');
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const keys = new Map((orgOf(db)?.emailKeys ?? []).map((k) => [k.id, k.label]));
  const tpls = new Map(db.templates.map((t) => [t.id, t.name]));
  const count = (s: EmailSend['status']) => db.sends.filter((x) => x.status === s).length;
  const rows = useMemo(() => db.sends.filter((s) => f === 'all' || s.status === f).sort((a, b) => b.at.localeCompare(a.at)), [db.sends, f]);
  const queued = count('queued');

  const flush = async () => {
    setBusy(true);
    const r = await flushQueue(db);
    setBusy(false);
    if (r.error) return toast('Queue not sent', r.error, 'r');
    toast(r.sent ? `${r.sent} sent` : 'Nothing went out', r.waiting ? `${r.waiting} still waiting: today's limit is used up.` : undefined, r.waiting ? 'a' : 'g');
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented label="Status" value={f} onChange={setF} items={[
          { key: 'all', label: 'All', count: db.sends.length },
          { key: 'sent', label: 'Sent', count: count('sent') },
          { key: 'queued', label: 'Waiting', count: queued },
          { key: 'failed', label: 'Failed', count: count('failed') },
        ]} />
      </div>
      {slot && createPortal(
        <button className={`btn ${queued ? 'btn-primary' : ''}`} type="button" disabled={busy || !queued} title={queued ? 'Uses what is left of today’s limit' : 'Nothing is waiting'} onClick={() => void flush()}>{busy ? 'Sending…' : queued ? `Send ${queued} waiting now` : 'Nothing waiting'}</button>,
        slot,
      )}
      <div className="card flush ml-log">
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Time</th><th>To</th><th>Subject</th><th>Kind</th><th>Status</th><th>Key</th><th>Error</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr className="empty"><td colSpan={7}>{db.sends.length ? 'Nothing with this status.' : 'Nothing sent yet. Emails you send from Compose or Score reports show up here.'}</td></tr>}
              {rows.slice(0, limit).map((s) => {
                const [tone, word] = STATUS[s.status];
                return (
                  <tr key={s.id}>
                    <td className="small soft">{new Date(s.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="small">{s.to}</td>
                    <td className="small">{s.subject || <span className="muted">{s.templateId ? tpls.get(s.templateId) : ''}</span>}</td>
                    <td className="small soft">{s.templateId ? tpls.get(s.templateId) ?? 'Template' : KIND[s.kind ?? ''] ?? s.kind ?? ''}</td>
                    <td><State tone={tone}>{word}</State></td>
                    <td className="small soft">{s.keyId ? keys.get(s.keyId) ?? 'Removed key' : '–'}</td>
                    <td className="wrap">{s.error ? <span className="ml-err">{s.error}</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > limit && <div className="card-foot"><span className="muted small">Showing {limit} of {rows.length}</span><button className="btn btn-sm" type="button" onClick={() => setLimit(limit + 200)}>Show more</button></div>}
      </div>
      {!REMOTE && <p className="muted tiny">Sandbox: nothing leaves the browser. <Link to="/staff/reports">Score reports</Link> and Compose add to this log.</p>}
    </div>
  );
}
