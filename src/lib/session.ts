import type { Competitor, Team, User } from './model';
import { useDB, useSessionUserId } from './store';

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
      return '/staff/proctoring';
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
