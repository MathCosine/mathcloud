import { useMemo, useState } from 'react';
import { sendMessages, type Message } from '../../lib/actions';
import { useContest } from '../../lib/hooks';
import { loginEmail, makeLoginsForTeams, type TeamLogins } from '../../lib/people-actions';
import { useDB } from '../../lib/store';
import { Icon } from '../../components/icons';
import { Modal, Roll, toast } from '../../components/ui';

/**
 * Every student's sign-in, made by the organisers in one go. Coaches never
 * need an account: the organisers print the slips or email them to each
 * team's contact (or each student's guardian).
 */
export function SignIns() {
  const db = useDB();
  const contest = useContest();
  const live = useMemo(() => db.teams.filter((t) => t.status !== 'withdrawn').sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [db]);
  // Depends on db, not db.users: the sandbox adds users in place.
  const hasLogin = useMemo(() => new Set(db.users.filter((u) => u.competitorId).map((u) => u.competitorId!)), [db]);
  const students = db.competitors.filter((c) => live.some((t) => t.id === c.teamId));
  const without = students.filter((c) => !hasLogin.has(c.id));
  const teamsWithout = live.filter((t) => without.some((c) => c.teamId === t.id));
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [made, setMade] = useState<TeamLogins[] | null>(null);
  const [sending, setSending] = useState<'contacts' | 'guardians' | null>(null);
  const origin = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '');
  const accounts = made?.flatMap((m) => m.accounts.map((a) => ({ ...a, teamId: m.teamId }))) ?? [];

  const make = async (teams = teamsWithout) => {
    if (!teams.length) return;
    setProgress({ done: 0, of: teams.length });
    const r = await makeLoginsForTeams(teams.map((t) => t.id), (done) => setProgress({ done, of: teams.length }));
    setProgress(null);
    setMade(r);
    const failed = r.filter((x) => x.error);
    const n = r.reduce((k, x) => k + x.accounts.length, 0);
    if (failed.length) toast(`${failed.length} ${failed.length === 1 ? 'team' : 'teams'} not done`, failed[0].error ?? undefined, 'r');
    else toast(`${n} sign-ins made`, 'Print or email them now: the passwords are shown only once.', 'g');
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=820,height=700');
    if (!w) return toast('Allow pop-ups to print', undefined, 'a');
    const e = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
    const blocks = (made ?? []).filter((m) => m.accounts.length).map((m) => {
      const t = live.find((x) => x.id === m.teamId);
      return `<section><h2>${e(t?.code ?? '')} ${e(t?.name ?? '')}</h2>${m.accounts
        .map((a) => `<div class="slip"><b>${e(a.name)}</b><div>Username <span class="m">${e(a.username)}</span></div><div>Password <span class="m">${e(a.password)}</span></div><small>${e(contest.short)} · sign in at ${e(origin)}</small></div>`)
        .join('')}</section>`;
    });
    w.document.write(`<!doctype html><title>Sign-ins: ${e(contest.short)}</title><style>body{font:14px system-ui;margin:28px;color:#111}h2{font-size:15px;margin:22px 0 10px}section{break-inside:avoid-page}.slip{display:inline-block;width:46%;margin:0 2% 12px 0;padding:12px 16px;border:1px dashed #999;border-radius:8px;vertical-align:top;break-inside:avoid}.m{font-family:ui-monospace,Menlo,monospace;font-size:15px}small{color:#666}</style><h1 style="font-size:18px">${e(contest.short)}: student sign-ins</h1>${blocks.join('')}`);
    w.document.close();
    w.focus();
    w.print();
  };

  const csv = () => {
    const lines = [['team', 'student', 'username', 'password'], ...accounts.map((a) => [live.find((t) => t.id === a.teamId)?.code ?? '', a.name, a.username, a.password])];
    const blob = new Blob([lines.map((l) => l.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${contest.slug}-sign-ins.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const send = async (to: 'contacts' | 'guardians') => {
    const messages: Message[] = [];
    for (const m of made ?? []) {
      const t = live.find((x) => x.id === m.teamId);
      if (!t || !m.accounts.length) continue;
      if (to === 'contacts') {
        const { subject, html } = loginEmail(contest.name, t.name, m.accounts, origin);
        messages.push({ to: t.contactEmail, subject, html, tag: `logins-${t.id}` });
      } else {
        for (const a of m.accounts) {
          const c = db.competitors.find((x) => x.teamId === t.id && x.name === a.name);
          if (!c?.guardianEmail) continue;
          const { subject, html } = loginEmail(contest.name, `${a.name} (${t.name})`, [a], origin);
          messages.push({ to: c.guardianEmail, subject, html, tag: `login-${c.id}` });
        }
      }
    }
    setSending(null);
    if (!messages.length) return toast('Nobody to email', 'No email addresses for these students.', 'a');
    const r = await sendMessages('sign_ins', null, messages);
    if (r.error) return toast('Not sent', r.error, 'r');
    toast(`${r.sent} emails sent`, r.waiting ? `${r.waiting} more go out when the sending keys have room (Email, Log).` : undefined, 'g');
  };

  return (
    <div className="stack-lg">
      <section className="card stack si-head">
        <div className="row wrap" style={{ gap: 20, justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 14 }}>
            <span className="ic-sq"><Icon name="key" /></span>
            <div>
              <b className="si-big"><Roll value={students.length - without.length} /> <span className="muted">of {students.length}</span></b>
              <div className="soft small">students can sign in. Students sign in only to take their tests; coaches need no account.</div>
            </div>
          </div>
          <div className="actions">
            {without.length > 0 ? (
              <button className="btn btn-primary" type="button" disabled={!!progress} onClick={() => void make()}>
                <Icon name="key" />{progress ? `Making… ${progress.done} of ${progress.of} teams` : `Make ${without.length} sign-ins`}
              </button>
            ) : (
              <span className="state ok">Everyone has a sign-in</span>
            )}
          </div>
        </div>
        {progress && <div className="progress"><i style={{ width: `${(progress.done / progress.of) * 100}%`, transition: 'width .3s var(--out)' }} /></div>}
      </section>

      {made && accounts.length > 0 && (
        <section className="card flush reveal">
          <div className="card-head wrap">
            <h2>{accounts.length} new sign-ins</h2>
            <div className="actions">
              <button className="btn btn-sm" type="button" onClick={print}><Icon name="print" />Print slips</button>
              <button className="btn btn-sm" type="button" onClick={csv}><Icon name="download" />CSV</button>
              <button className="btn btn-sm" type="button" onClick={() => setSending('contacts')}><Icon name="send" />Email team contacts</button>
              <button className="btn btn-sm" type="button" onClick={() => setSending('guardians')}><Icon name="send" />Email guardians</button>
            </div>
          </div>
          <div className="note amber" style={{ margin: '12px 20px 0' }}>Passwords are shown only now. Print, download or email them before you leave this page; making a student&apos;s sign-in again gives a new password.</div>
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Team</th><th>Student</th><th>Username</th><th>Password</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={`${a.teamId}-${a.username}`}>
                    <td className="soft">{live.find((t) => t.id === a.teamId)?.code}</td>
                    <td className="name">{a.name}</td>
                    <td className="mono">{a.username}</td>
                    <td className="mono">{a.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card flush">
        <div className="card-head"><h2>By team</h2><span className="label">{teamsWithout.length ? `${teamsWithout.length} teams still to do` : 'All done'}</span></div>
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Team</th><th className="num">Students</th><th className="num">With a sign-in</th><th /></tr></thead>
            <tbody>
              {live.map((t) => {
                const kids = students.filter((c) => c.teamId === t.id);
                const ok = kids.filter((c) => hasLogin.has(c.id)).length;
                return (
                  <tr key={t.id}>
                    <td><span className="code">{t.code}</span><span className="name">{t.name}</span></td>
                    <td className="num">{kids.length}</td>
                    <td className="num">{ok === kids.length ? <span className="ok">All {ok}</span> : <span className="wait">{ok} of {kids.length}</span>}</td>
                    <td className="num">
                      {ok < kids.length && <button className="btn btn-sm" type="button" disabled={!!progress} onClick={() => void make([t])}>Make {kids.length - ok}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {sending && (
        <Modal title={sending === 'contacts' ? 'Email each team contact their students’ sign-ins?' : 'Email each guardian their student’s sign-in?'} onClose={() => setSending(null)} actions={
          <>
            <button className="btn" type="button" onClick={() => setSending(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => void send(sending)}><Icon name="send" />Send</button>
          </>
        }>
          <p>{sending === 'contacts' ? 'One email per team, to the contact you imported, listing each student’s username and password.' : 'One email per student, to their guardian’s address, with that student’s username and password.'} It goes out through your sending keys (Email, Sending keys).</p>
        </Modal>
      )}
    </div>
  );
}
