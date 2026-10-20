import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contestOf, signOut } from '../lib/actions';
import { enterAs, useUser } from '../lib/session';
import { setActiveContest, useAllDB, useDB } from '../lib/store';
import { Icon, type IconName } from './icons';

type Item = { id: string; group: string; label: string; hint?: string; code?: string; icon: IconName; words?: string; run: () => void };

const OPEN = 'mathcloud:cmdk';
/** Open the command bar from anywhere (the sidebar's search button does). */
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN));

export const STAFF_PAGES: { to: string; label: string; icon: IconName; group: string; roles: string[]; words?: string }[] = [
  { to: '/staff', label: 'Overview', icon: 'overview', group: '', roles: ['director', 'staff'], words: 'home dashboard today' },
  { to: '/staff/teams', label: 'Teams', icon: 'roster', group: 'Before', roles: ['director', 'staff'], words: 'roster registration' },
  { to: '/staff/people', label: 'People', icon: 'people', group: 'Before', roles: ['director', 'staff'], words: 'students coaches staff check-in id check duplicates' },
  { to: '/staff/waivers', label: 'Waivers', icon: 'waivers', group: 'Before', roles: ['director', 'staff'], words: 'guardians sign remind' },
  { to: '/staff/rounds', label: 'Rounds', icon: 'rounds', group: 'On the day', roles: ['director', 'staff'], words: 'problems answer key open close' },
  { to: '/staff/live', label: 'Live', icon: 'live', group: 'On the day', roles: ['director', 'staff', 'proctor'], words: 'questions zoom proctor locked' },
  { to: '/staff/grading', label: 'Grading', icon: 'grading', group: 'On the day', roles: ['director', 'staff', 'grader'], words: 'key sheets rulings paper' },
  { to: '/staff/results', label: 'Results', icon: 'results', group: 'After', roles: ['director', 'staff'], words: 'standings publish awards' },
  { to: '/staff/reports', label: 'Reports', icon: 'reports', group: 'After', roles: ['director', 'staff'], words: 'score reports certificates' },
  { to: '/staff/email', label: 'Email', icon: 'mail', group: 'After', roles: ['director', 'staff'], words: 'send keys templates log' },
  { to: '/staff/settings', label: 'Settings', icon: 'settings', group: 'Settings', roles: ['director', 'staff'], words: 'venue rooms zoom registration contest' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** ⌘K: every page, the common actions, and every team and student, one keystroke away. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const navigate = useNavigate();
  const user = useUser();
  const db = useDB();
  const all = useAllDB();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', key);
    window.addEventListener(OPEN, show);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener(OPEN, show);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setAt(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!user) return [];
    const go = (to: string) => () => navigate(to);
    const contest = contestOf(db) as ReturnType<typeof contestOf> | undefined;
    const director = user.role === 'director' || user.role === 'staff';
    const out: Item[] = STAFF_PAGES.filter((p) => p.roles.includes(user.role)).map((p) => ({ id: p.to, group: 'Go to', label: p.label, icon: p.icon, words: p.words, run: go(p.to) }));
    if (director && contest) {
      out.push(
        { id: 'a-team', group: 'Do', label: 'Add a team', icon: 'plus', words: 'register new', run: go(`/register/${contest.slug}`) },
        { id: 'a-import', group: 'Do', label: 'Import a spreadsheet', icon: 'upload', words: 'csv teams students problems answers', run: go('/staff/import') },
        { id: 'a-remind', group: 'Do', label: 'Remind guardians about waivers', icon: 'send', words: 'email', run: go('/staff/waivers') },
        { id: 'a-board', group: 'Do', label: 'Show the Guts board on a projector', icon: 'board', words: 'scoreboard live screen', run: go('/board') },
        { id: 'a-public', group: 'Do', label: 'Open the public contest page', icon: 'external', words: 'link share', run: go(`/c/${contest.slug}`) },
        { id: 'a-new', group: 'Do', label: 'Start a new contest', icon: 'plus', words: 'create', run: go('/staff/new') },
      );
      for (const c of all.contests.filter((x) => x.id !== contest.id)) {
        out.push({ id: `c-${c.id}`, group: 'Switch contest', label: c.name, hint: c.dateLabel, icon: 'switch', run: () => { setActiveContest(c.id); navigate('/staff'); } });
      }
      for (const t of db.teams) {
        out.push({ id: `t-${t.id}`, group: 'Teams', label: t.name, code: t.code, hint: [t.school, t.city].filter(Boolean).join(', '), icon: 'roster', words: `${t.contactName} ${t.contactEmail}`, run: go(`/staff/teams?team=${encodeURIComponent(t.id)}`) });
      }
      const teamName = new Map(db.teams.map((t) => [t.id, t.name]));
      for (const c of db.competitors) {
        out.push({ id: `s-${c.id}`, group: 'Students', label: c.name, code: c.publicId, hint: teamName.get(c.teamId), icon: 'student', words: `${c.guardianName} ${c.guardianEmail}`, run: go(`/staff/people?student=${encodeURIComponent(c.id)}`) });
      }
    }
    out.push({ id: 'a-account', group: 'You', label: 'Account and password', icon: 'user', run: go('/account') });
    out.push({ id: 'a-out', group: 'You', label: 'Sign out', icon: 'logout', run: () => { void signOut().then(() => { enterAs(null); navigate('/'); }); } });
    return out;
  }, [user, db, all.contests, navigate]);

  const shown = useMemo(() => {
    const words = norm(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return items.filter((i) => i.group === 'Go to' || i.group === 'Do').slice(0, 14);
    const scored = items
      .map((i) => {
        const hay = norm(`${i.code ?? ''} ${i.label} ${i.hint ?? ''} ${i.words ?? ''}`);
        if (!words.every((w) => hay.includes(w))) return null;
        const first = words[0];
        const score = (i.code && norm(i.code) === first ? 0 : norm(i.label).startsWith(first) ? 1 : 2) + (i.group === 'Go to' ? -0.5 : 0);
        return { i, score };
      })
      .filter((x): x is { i: Item; score: number } => !!x)
      .sort((a, b) => a.score - b.score);
    // At most six of each kind, so a common word does not bury the rest.
    const per = new Map<string, number>();
    return scored.filter(({ i }) => {
      const n = per.get(i.group) ?? 0;
      per.set(i.group, n + 1);
      return n < 6;
    }).map((x) => x.i);
  }, [items, q]);

  // Groups in a stable order, items in score order within each.
  const ordered = useMemo(() => {
    const groups: string[] = [];
    for (const i of shown) if (!groups.includes(i.group)) groups.push(i.group);
    return groups.flatMap((g) => shown.filter((i) => i.group === g));
  }, [shown]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  if (!open || !user) return null;
  const run = (i: Item | undefined) => {
    if (!i) return;
    setOpen(false);
    i.run();
  };

  return (
    <div className="cmdk-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and jump">
        <div className="cmdk-in">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Search pages, teams, students, IDs…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(ordered.length - 1, n + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(0, n - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(ordered[at]); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            aria-activedescendant={ordered[at] ? `cmdk-${ordered[at].id}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {ordered.length === 0 && <div className="cmdk-empty">Nothing matches “{q}”.</div>}
          {ordered.map((i, n) => (
            <div key={i.id}>
              {(n === 0 || ordered[n - 1].group !== i.group) && <div className="cmdk-group">{i.group}</div>}
              <div
                id={`cmdk-${i.id}`}
                role="option"
                aria-selected={n === at}
                className={`cmdk-item ${n === at ? 'on' : ''}`}
                onMouseMove={() => n !== at && setAt(n)}
                onClick={() => run(i)}
              >
                <Icon name={i.icon} size={16} />
                {i.code && <span className="mono">{i.code}</span>}
                <span>{i.label}</span>
                {i.hint && <small>{i.hint}</small>}
              </div>
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
          <span><span className="kbd"><Icon name="enter" size={11} /></span> open</span>
          <span><span className="kbd">⌘</span><span className="kbd">K</span> close</span>
        </div>
      </div>
    </div>
  );
}
