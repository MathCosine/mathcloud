import type { Competitor, Team, User } from './model';
import { getDB, setActiveContest, setSession, useDB, useSessionUserId } from './store';

export function useUser(): User | null {
  const db = useDB();
  const id = useSessionUserId();
  return db.users.find((u) => u.id === id) ?? null;
}

export function useStudent(): { user: User; competitor: Competitor; team: Team } | null {
  const db = useDB();
  const user = useUser();
  if (!user?.competitorId) return null;
  const competitor = db.competitors.find((c) => c.id === user.competitorId);
  const team = competitor && db.teams.find((t) => t.id === competitor.teamId);
  return competitor && team ? { user, competitor, team } : null;
}

export const ROLE_LABEL: Record<User['role'], string> = {
  director: 'Director',
  staff: 'Staff',
  grader: 'Grader',
  proctor: 'Proctor',
  coach: 'Coach',
  student: 'Student',
};

export function homeFor(user: User | null): string {
  if (!user) return '/sign-in';
  switch (user.role) {
    case 'director':
    case 'staff':
      return '/staff';
    case 'grader':
      return '/staff/grading';
    case 'proctor':
      return '/staff/live';
    case 'coach':
      return '/coach';
    case 'student':
      return '/me';
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Sign in as someone, and look at the contest their team is in. */
export function enterAs(userId: string | null) {
  setSession(userId);
  const db = getDB();
  const u = db.users.find((x) => x.id === userId);
  const teamId = u?.competitorId ? db.competitors.find((c) => c.id === u.competitorId)?.teamId : u?.teamIds?.[0];
  const team = teamId ? db.teams.find((t) => t.id === teamId) : undefined;
  if (team) setActiveContest(team.contestId);
  else if (u && u.role !== 'director' && u.role !== 'staff') setActiveContest('sfmo-2027');
}

/** "SFMO 2027" → "SF", "Bay Area Mini 2027" → "BA". */
export function contestInitials(short: string) {
  const words = short.split(/\s+/).filter((w) => w && !/^\d+$/.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}
