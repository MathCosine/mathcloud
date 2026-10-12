import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import type { DivisionMode } from '../lib/model';
import { contestInitials, initials, useUser } from '../lib/session';
import { useDB } from '../lib/store';
import { DemoMenu } from '../components/DemoMenu';
import { ModeChip } from '../components/ui';

/** Students and coaches. A student's header says, always, which way they take part. */
export function PortalLayout({ children, mode }: { children: ReactNode; mode?: DivisionMode }) {
  const user = useUser();
  const db = useDB();
  const contest = contestOf(db);
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">
          <span className="tile" style={{ width: 30, height: 30, fontSize: 11, borderRadius: 8 }}>{contestInitials(contest.short)}</span>
          {contest.short}
        </Link>
        {mode && <ModeChip mode={mode} />}
        <span className="grow" />
        {user && (
          <span className="who">
            <span className="avatar">{initials(user.name)}</span>
            <span className="soft hide-sm">{user.name}</span>
          </span>
        )}
        <DemoMenu placement="down" />
      </header>
      <main className="portal">{children}</main>
    </>
  );
}
