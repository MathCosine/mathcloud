import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { initials, ROLE_LABEL, useUser } from '../lib/session';
import { Mark } from '../components/ui';

export function PortalLayout({ children }: { children: ReactNode }) {
  const user = useUser();
  return (
    <>
      <header className="portal-top">
        <Link to="/" className="brand" style={{ color: 'var(--ink)', fontSize: 15 }}>
          <Mark />
          MathCloud
        </Link>
        <span className="spacer" />
        {user && (
          <span className="who">
            <span className="avatar">{initials(user.name)}</span>
            {user.name}
            <span className="tag" style={{ marginLeft: 2 }}>{ROLE_LABEL[user.role]}</span>
          </span>
        )}
      </header>
      <main className="portal-main">{children}</main>
    </>
  );
}
