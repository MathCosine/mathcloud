import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import '../styles/public.css';
import { changePassword, saveDisplayName } from '../lib/public';
import { ROLE_LABEL, homeFor, initials, useUser } from '../lib/session';
import { REMOTE } from '../lib/store';
import { TopBar } from '../layouts/StaffLayout';
import { toast } from '../components/ui';

/** Your name and password. Reached from the user menu, and from a password-reset email. */
export function Account() {
  const user = useUser();
  const [name, setName] = useState(user?.name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [pw, setPw] = useState({ next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);

  if (!user) return <Navigate to="/sign-in" replace />;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setNameBusy(true);
    const err = await saveDisplayName(user.id, name);
    setNameBusy(false);
    setNameError(err ?? '');
    if (!err) toast('Name saved', 'Organisers and coaches see the new name from now on.', 'g');
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.again) return setPwError('The two passwords are different.');
    setPwBusy(true);
    const err = await changePassword(pw.next);
    setPwBusy(false);
    setPwError(err ?? '');
    if (!err) {
      setPw({ next: '', again: '' });
      setPwDone(true);
    }
  };

  const managed = !!user.managed;

  return (
    <div className="app">
      <TopBar />
      <main className="page narrow acct">
        <div className="page-head">
          <div>
            <h1 className="page-title">Account</h1>
            <p className="page-sub">Your name and how you sign in.</p>
          </div>
          <div className="actions"><Link className="btn" to={homeFor(user)}>Back to your page</Link></div>
        </div>

        <section className="card acct-who">
          <span className="avatar acct-avatar">{initials(user.name)}</span>
          <dl className="acct-dl">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>{managed ? 'Username' : 'Email'}</dt><dd className={managed ? 'mono' : ''}>{user.email || '—'}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[user.role]}</dd></div>
          </dl>
        </section>

        {!REMOTE ? (
          <div className="note blue">
            This is the sandbox: its accounts are fixed demo people, so names and passwords cannot be changed here. Every demo password is “demo”.
          </div>
        ) : (
          <div className="acct-grid">
            <section className="card">
              <div className="section-head"><h2>Display name</h2></div>
              <form className="stack" onSubmit={saveName} noValidate>
                <label className="field">
                  <span>Name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <small>Shown to organisers and coaches{user.role === 'student' ? ', and on your certificate' : ''}.</small>
                </label>
                {nameError && <div className="note red" role="alert">{nameError}</div>}
                <div><button className="btn btn-primary" type="submit" disabled={nameBusy || name.trim() === user.name}>{nameBusy ? 'Saving…' : 'Save name'}</button></div>
              </form>
            </section>

            <section className="card">
              <div className="section-head"><h2>Password</h2></div>
              {managed ? (
                <p className="soft">Your coach manages this sign-in. Ask them for a new password if you have lost it.</p>
              ) : (
                <form className="stack" onSubmit={savePassword} noValidate>
                  <label className="field">
                    <span>New password</span>
                    <input className="input" type="password" value={pw.next} onChange={(e) => { setPw({ ...pw, next: e.target.value }); setPwDone(false); }} autoComplete="new-password" />
                    <small>At least 8 characters.</small>
                  </label>
                  <label className="field">
                    <span>Type it again</span>
                    <input className="input" type="password" value={pw.again} onChange={(e) => { setPw({ ...pw, again: e.target.value }); setPwDone(false); }} autoComplete="new-password" />
                  </label>
                  {pwError && <div className="note red" role="alert">{pwError}</div>}
                  {pwDone && <div className="note green" role="status">Password changed. Use it next time you sign in.</div>}
                  <div><button className="btn btn-primary" type="submit" disabled={pwBusy || !pw.next}>{pwBusy ? 'Changing…' : 'Change password'}</button></div>
                </form>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
