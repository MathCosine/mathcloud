import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { contestOf } from '../lib/actions';
import { initials, useUser } from '../lib/session';
import { useDB } from '../lib/store';
import { DemoMenu } from '../components/DemoMenu';

export function PortalLayout({ children }: { children: ReactNode }) {
  const user = useUser();
  const db = useDB();
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">{contestOf(db).short}</Link>
        <span className="grow" />
        {user && (
          <span className="who">
            <span className="avatar">{initials(user.name)}</span>
            <span className="soft">{user.name}</span>
          </span>
        )}
        <DemoMenu placement="down" />
      </header>
      <main className="portal">{children}</main>
    </>
  );
}
