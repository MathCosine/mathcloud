import type { ReactNode } from 'react';
import { contestOf } from '../lib/actions';
import type { DivisionMode } from '../lib/model';
import { contestInitials } from '../lib/session';
import { useDB } from '../lib/store';
import { ModeChip } from '../components/ui';
import { TopBar } from './StaffLayout';

/** Students and coaches. A student's header says, always, which way they take part. */
export function PortalLayout({ children, mode, wide }: { children: ReactNode; mode?: DivisionMode; wide?: boolean }) {
  const db = useDB();
  const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
  return (
    <div className="app">
      <TopBar>
        {contest && (
          <span className="ctx-chip hide-sm">
            <span className="tile" style={{ width: 24, height: 24, fontSize: 9, borderRadius: 999 }}>{contestInitials(contest.short)}</span>
            {contest.short}
          </span>
        )}
        {mode && <ModeChip mode={mode} />}
      </TopBar>
      <main className={`page enter ${wide ? '' : 'narrow'}`}>{children}</main>
    </div>
  );
}
