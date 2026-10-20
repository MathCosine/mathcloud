import type { Attempt, Contest, DB, Round } from '../model';

export const ONLINE_ID = 'sfmo-2027-online';
const remap = (id: string) => `o-${id}`;

/**
 * SFMO runs in person and online at the same time, which MathCloud models as
 * two contests linked as editions: the in-person contest keeps its id, the
 * online one is its copy with its own rounds (same problems, copied), Zoom
 * rooms, teams, attempts and rulings. Built from the one-contest demo so the
 * two stay consistent with each other.
 */
export function splitEditions(db: DB): DB {
  const both = db.contests[0];
  if (db.contests.length !== 1 || both.divisions.length < 2) return db;
  const onlineDivision = both.divisions.find((d) => d.mode === 'online')!;
  const inPersonDivision = both.divisions.find((d) => d.mode === 'in_person')!;
  const onlineTeams = new Set(db.teams.filter((t) => t.divisionId === onlineDivision.id).map((t) => t.id));
  const onlineCompetitors = new Set(db.competitors.filter((c) => onlineTeams.has(c.teamId)).map((c) => c.id));
  const isOnline = (entrantId: string) => onlineTeams.has(entrantId) || onlineCompetitors.has(entrantId);

  const onlineRounds: Round[] = both.rounds.map((r) => ({ ...r, id: remap(r.id), problems: r.problems.map((p) => ({ ...p, id: remap(p.id), answers: [...p.answers] })) }));
  // SFMO's organisers enter every team; coaches never need an account.
  const registration = { ...both.registration, coaches: false };
  const inPerson: Contest = {
    ...both,
    registration,
    divisions: [inPersonDivision],
    rooms: [],
    agenda: both.agenda.filter((a) => a.modes.includes('in_person')).map((a) => ({ ...a, modes: ['in_person'] })),
    linkedId: ONLINE_ID,
  };
  const online: Contest = {
    ...both,
    id: ONLINE_ID,
    slug: ONLINE_ID,
    registration,
    divisions: [onlineDivision],
    rounds: onlineRounds,
    recipe: { ...both.recipe, weights: Object.fromEntries(Object.entries(both.recipe.weights).map(([k, v]) => [remap(k), v])), awards: both.recipe.awards.map((a) => ({ ...a, id: remap(a.id) })) },
    venue: null,
    agenda: both.agenda.filter((a) => a.modes.includes('online')).map((a) => ({ ...a, id: remap(a.id), modes: ['online'], roundId: a.roundId ? remap(a.roundId) : undefined, where: undefined })),
    linkedId: inPerson.id,
  };
  if (inPerson.venue) inPerson.venue = { ...inPerson.venue, rooms: inPerson.venue.rooms.map((r) => ({ ...r, teamIds: r.teamIds.filter((t) => !onlineTeams.has(t)) })) };

  const attempts: Attempt[] = db.attempts.map((a) => {
    if (!isOnline(a.entrantId)) return a;
    return { ...a, id: remap(a.id), roundId: remap(a.roundId), responses: Object.fromEntries(Object.entries(a.responses).map(([k, v]) => [remap(k), v])) };
  });

  return {
    ...db,
    contests: [inPerson, online],
    teams: db.teams.map((t) => (onlineTeams.has(t.id) ? { ...t, contestId: ONLINE_ID } : t)),
    attempts,
    rulings: [...db.rulings, ...db.rulings.map((r) => ({ ...r, roundId: remap(r.roundId), problemId: remap(r.problemId) }))],
    clarifications: db.clarifications.flatMap((c) => {
      if (c.fromCompetitorId) return [onlineCompetitors.has(c.fromCompetitorId) ? { ...c, roundId: remap(c.roundId) } : c];
      // Announcements to everyone were made in both rooms.
      return [c, { ...c, id: remap(c.id), roundId: remap(c.roundId) }];
    }),
    users: db.users.map((u) => (u.roundIds ? { ...u, roundIds: [...u.roundIds, ...u.roundIds.map(remap)] } : u)),
  };
}
