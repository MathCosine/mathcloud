import type { ReactNode } from 'react';
import { contestOf } from '../lib/actions';
import type { DivisionMode } from '../lib/model';
import { contestInitials } from '../lib/session';
import { useDB } from '../lib/store';
import { ModeChip } from '../components/ui';
import { TopBar } from './StaffLayout';
import '../styles/portal.css';

/**
 * Students, coaches and account pages: one bar on the grey frame, then the
 * page on a white sheet, like the organisers' but without the sidebar. A
 * student's bar says, always, which way they take part.
 */
export function PortalLayout({ children, mode, wide, bare }: { children: ReactNode; mode?: DivisionMode; wide?: boolean; bare?: boolean }) {
  const db = useDB();
  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
  return (
    <div className="app pt-frame">
      <TopBar>
        {contest && !bare && (
          <span className="ctx-chip hide-sm">
            <span className="tile" style={{ width: 24, height: 24, fontSize: 9, borderRadius: 999 }}>{contestInitials(contest.short)}</span>
            {contest.short}
          </span>
        )}
        {mode && <ModeChip mode={mode} />}
      </TopBar>
      <main className={`pt-main enter ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}
