/**
 * Supabase rows → the app's DB shape. Pure, so it can be tested without a
 * server. What arrives has already been cut down by row level security, so
 * this never decides who sees what; it only rearranges.
 */
import type {
  Activity, AgendaItem, Attempt, Clarification, Competitor, Contest, DB, DivisionMode, EmailKey, EmailSend, EmailTemplate,
  IntegrityEvent, Org, Problem, PublishedResult, Role, Round, Ruling, ScoringRecipe, Team, User,
} from '../model';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Rows = {
  me: { id: string; email?: string | null } | null;
  organizations: Row[];
  memberships: Row[];
  contests: Row[];
  divisions: Row[];
  contest_roles: Row[];
  rounds: Row[];
  problems: Row[];
  answer_keys: Row[];
  teams: Row[];
  competitors: Row[];
  zoom_rooms: Row[];
  venue_rooms: Row[];
  agenda_items: Row[];
  attempts: Row[];
  responses: Row[];
  integrity_events: Row[];
  rulings: Row[];
  clarifications: Row[];
  email_templates: Row[];
  email_sends: Row[];
  email_keys: Row[];
  activity: Row[];
  results: Row[];
  profiles: Row[];
  /** Students: problems served by round_problems() for rounds they have started, by round id. */
  served: Record<string, Row[]>;
};

export const emptyRows = (): Rows => ({
  me: null, organizations: [], memberships: [], contests: [], divisions: [], contest_roles: [], rounds: [], problems: [], answer_keys: [],
  teams: [], competitors: [], zoom_rooms: [], venue_rooms: [], agenda_items: [], attempts: [], responses: [], integrity_events: [],
  rulings: [], clarifications: [], email_templates: [], email_sends: [], email_keys: [], activity: [], results: [], profiles: [], served: {},
});

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dateLabelOf(c: Row): string {
  if (c.date_label) return c.date_label;
  if (!c.starts_on) return 'Date to be announced';
  const [y, m, d] = String(c.starts_on).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function defaultRecipe(rounds: Round[]): ScoringRecipe {
  return {
    teamIndividual: { method: 'best', best: 3, fillMissingTo: 0 },
    weights: Object.fromEntries(rounds.map((r) => [r.id, 1])),
    harderFirst: true,
    awards: [
      { id: 'i1', scope: 'individual', label: '1st', rule: 'top_n', value: 1 },
      { id: 'i2', scope: 'individual', label: '2nd', rule: 'top_n', value: 2 },
      { id: 'i3', scope: 'individual', label: '3rd', rule: 'top_n', value: 3 },
      { id: 't1', scope: 'team', label: '1st', rule: 'top_n', value: 1 },
    ],
  };
}

export function problemOf(p: Row, keys: Map<string, Row>): Problem {
  return {
    id: p.id,
    number: p.number,
    set: p.set_no ?? undefined,
    text: p.body,
    answers: keys.get(p.id)?.accepted ?? [],
    answerType: p.answer_type,
    points: Number(p.points),
  };
}

// ------------------------------------------------------- single-row mappers

export function roundFields(r: Row): Omit<Round, 'problems'> {
  return {
    id: r.id,
    name: r.name,
    short: r.short_name || r.name.split(' ')[0],
    kind: r.kind,
    minutes: r.minutes,
    startsAt: r.starts_at,
    status: r.status,
    openedAt: r.opened_at ?? undefined,
    graceSeconds: r.grace_seconds,
    mystery: r.mystery,
    integrity: { policy: r.integrity?.policy ?? 'warn', lockAfter: Number(r.integrity?.lock_after ?? 4) },
    rules: r.rules ?? '',
  };
}

/** The parts of a contest row that change during a contest (and arrive by realtime). */
export function detailsOf(d: Row | null | undefined): Contest['details'] {
  if (!d) return {};
  return {
    about: d.about ?? undefined, contactEmail: d.contact_email ?? undefined, website: d.website ?? undefined,
    faq: Array.isArray(d.faq) ? d.faq.filter((x: Row) => x && typeof x.q === 'string').map((x: Row) => ({ q: String(x.q), a: String(x.a ?? '') })) : undefined,
    public: d.public !== false, publicBoard: d.public_board !== false,
  };
}

export function contestFlags(c: Row): Pick<Contest, 'resultsPublished' | 'board' | 'registration'> {
  const reg = c.registration ?? {};
  const board = c.board ?? {};
  return {
    resultsPublished: !!c.results_published,
    board: { freezeMinutes: Number(board.freeze_minutes ?? 10), revealed: !!board.revealed },
    registration: { open: !!reg.open, closesLabel: reg.closes_label ?? '', teamMin: Number(reg.team_min ?? 1), teamMax: Number(reg.team_max ?? 4), coaches: reg.coaches !== false },
  };
}

export function mapTeam(t: Row): Team {
  return {
    id: t.id,
    contestId: t.contest_id,
    code: t.code,
    name: t.name,
    divisionId: t.division_id,
    school: t.school ?? '',
    city: t.city ?? '',
    contactName: t.contact_name ?? '',
    contactEmail: t.contact_email ?? '',
    coachId: t.coach_id ?? undefined,
    status: t.status === 'waitlisted' ? 'pending' : t.status,
    registeredAt: t.registered_at,
    joinCode: t.join_code,
    timeZone: t.time_zone ?? undefined,
    notes: t.notes ?? undefined,
    pledge: t.fields?.pledge ?? null,
    wantsTeammates: t.fields?.wants_teammates ?? undefined,
    disqualified: t.disqualified ?? undefined,
    externalId: t.external_id ?? undefined,
  };
}

export function mapCompetitor(c: Row): Competitor {
  return {
    id: c.id,
    teamId: c.team_id,
    slot: c.slot,
    publicId: c.public_id,
    name: c.name,
    grade: c.grade ?? 0,
    guardianName: c.guardian_name ?? '',
    guardianEmail: c.guardian_email ?? '',
    waiverSignedAt: c.waiver_signed_at ?? null,
    waiverSignedBy: c.waiver_signed_by ?? null,
    reminderSentAt: c.reminder_sent_at ?? null,
    checkedInAt: c.checked_in_at ?? null,
    deviceCheckedAt: c.device_checked_at ?? null,
    disqualified: c.disqualified ?? undefined,
    externalId: c.external_id ?? undefined,
  };
}

/** An attempt row without its responses and events (those arrive separately). */
export function mapAttempt(a: Row): Attempt {
  return {
    id: a.id,
    roundId: a.round_id,
    entrantId: a.competitor_id ?? a.team_id,
    source: a.source,
    startedAt: a.started_at ?? undefined,
    deadline: a.deadline ?? undefined,
    submittedAt: a.submitted_at ?? undefined,
    setsSubmitted: a.sets_submitted ?? 0,
    setTimes: a.set_times ?? [],
    responses: {},
    events: [],
    locked: !!a.locked,
    honorName: a.honor_name ?? undefined,
  };
}

export const mapResponse = (r: Row) => ({ value: r.value, savedAt: r.saved_at, by: r.saved_by ?? '' });

export const mapEvent = (e: Row, nameOf: (uid?: string | null) => string | undefined): IntegrityEvent => ({ at: e.at, kind: e.kind, ms: e.ms ?? undefined, by: nameOf(e.by_user) });

export function mapClarification(q: Row): Clarification {
  return {
    id: q.id,
    roundId: q.round_id,
    fromCompetitorId: q.competitor_id ?? undefined,
    question: q.question ?? '',
    answer: q.answer ?? undefined,
    broadcast: !!q.broadcast,
    at: q.asked_at,
    answeredAt: q.answered_at ?? undefined,
  };
}

export const mapResult = (r: Row): PublishedResult => ({ competitorId: r.competitor_id ?? undefined, teamId: r.team_id ?? undefined, data: r.data });

// ------------------------------------------------------------------- whole

export function mapRows(rows: Rows): DB {
  const profile = new Map(rows.profiles.map((p) => [p.id, p]));
  const keys = new Map(rows.answer_keys.map((k) => [k.problem_id, k]));
  const nameOf = (uid?: string | null) => (uid ? profile.get(uid)?.name || 'Someone' : undefined);

  // ---------------------------------------------------------------- contests
  const contests: Contest[] = rows.contests.map((c) => {
    const rounds: Round[] = rows.rounds
      .filter((r) => r.contest_id === c.id)
      .sort((a, b) => a.position - b.position || String(a.starts_at).localeCompare(String(b.starts_at)))
      .map((r) => {
        const own = rows.problems.filter((p) => p.round_id === r.id);
        const served = rows.served[r.id] ?? [];
        const problems = (own.length ? own : served).map((p) => problemOf(p, keys)).sort((a, b) => a.number - b.number);
        return { ...roundFields(r), problems };
      });
    const venueRooms = rows.venue_rooms.filter((v) => v.contest_id === c.id).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    const recipe: ScoringRecipe = c.recipe && c.recipe.teamIndividual ? c.recipe : defaultRecipe(rounds);
    return {
      id: c.id,
      orgId: c.org_id,
      name: c.name,
      short: c.short_name,
      slug: c.slug,
      dateLabel: dateLabelOf(c),
      timeZone: c.time_zone,
      divisions: rows.divisions
        .filter((d) => d.contest_id === c.id)
        .sort((a, b) => (a.mode === 'in_person' ? -1 : 1) - (b.mode === 'in_person' ? -1 : 1))
        .map((d) => ({ id: d.id, name: d.name, mode: d.mode as DivisionMode, detail: d.detail ?? '' })),
      rounds,
      recipe,
      rooms: rows.zoom_rooms
        .filter((z) => z.contest_id === c.id)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
        .map((z) => ({ id: z.id, name: z.name, url: z.url, proctorId: z.proctor_id ?? undefined, teamIds: z.team_ids ?? [] })),
      venue: c.venue
        ? { name: c.venue.name ?? '', address: c.venue.address ?? '', hall: c.venue.hall ?? 'Main hall', bring: c.venue.bring ?? [], rooms: venueRooms.map((v) => ({ id: v.id, name: v.name, teamIds: v.team_ids ?? [] })) }
        : venueRooms.length
          ? { name: '', address: '', hall: 'Main hall', bring: [], rooms: venueRooms.map((v) => ({ id: v.id, name: v.name, teamIds: v.team_ids ?? [] })) }
          : null,
      agenda: rows.agenda_items
        .filter((a) => a.contest_id === c.id)
        .map((a): AgendaItem => ({ id: a.id, at: a.at, title: a.title, roundId: a.round_id ?? undefined, modes: a.modes, where: a.place ?? undefined, note: a.note ?? undefined }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      ...contestFlags(c),
      linkedId: c.linked_id ?? undefined,
      details: detailsOf(c.details),
    };
  });

  // ------------------------------------------------------------------ roster
  const teams: Team[] = rows.teams.map(mapTeam);

  const competitors: Competitor[] = rows.competitors.map(mapCompetitor);

  // ------------------------------------------------------------------ people
  const ids = new Set<string>(rows.profiles.map((p) => p.id));
  if (rows.me) ids.add(rows.me.id);
  const roleOf = (uid: string): Role => {
    const m = rows.memberships.filter((x) => x.user_id === uid);
    if (m.some((x) => x.role === 'owner' || x.role === 'director')) return 'director';
    if (m.some((x) => x.role === 'staff')) return 'staff';
    const cr = rows.contest_roles.filter((x) => x.user_id === uid);
    if (cr.some((x) => x.role === 'grader')) return 'grader';
    if (cr.some((x) => x.role === 'proctor') || rows.zoom_rooms.some((z) => z.proctor_id === uid)) return 'proctor';
    if (rows.teams.some((t) => t.coach_id === uid)) return 'coach';
    if (rows.competitors.some((c) => c.user_id === uid)) return 'student';
    return 'guest';
  };
  const users: User[] = [...ids].map((uid) => {
    const p = profile.get(uid);
    const cr = rows.contest_roles.filter((x) => x.user_id === uid);
    const room = cr.find((x) => x.role === 'proctor' && x.room_id)?.room_id ?? rows.zoom_rooms.find((z) => z.proctor_id === uid)?.id;
    const comp = rows.competitors.find((c) => c.user_id === uid);
    const coachTeams = rows.teams.filter((t) => t.coach_id === uid).map((t) => t.id);
    return {
      id: uid,
      email: p?.managed ? p.username ?? '' : p?.email ?? (uid === rows.me?.id ? rows.me.email ?? '' : ''),
      name: p?.name || (uid === rows.me?.id ? rows.me.email?.split('@')[0] ?? 'You' : 'Someone'),
      role: roleOf(uid),
      password: '',
      roundIds: cr.filter((x) => x.role === 'grader').flatMap((x) => x.round_ids ?? []),
      roomId: room ?? undefined,
      teamIds: coachTeams.length ? coachTeams : undefined,
      competitorId: comp?.id,
      managed: !!p?.managed,
    };
  });

  // ---------------------------------------------------------------- testing
  const responsesBy = new Map<string, Row[]>();
  for (const r of rows.responses) {
    const list = responsesBy.get(r.attempt_id) ?? [];
    list.push(r);
    responsesBy.set(r.attempt_id, list);
  }
  const eventsBy = new Map<string, Row[]>();
  for (const e of rows.integrity_events) {
    const list = eventsBy.get(e.attempt_id) ?? [];
    list.push(e);
    eventsBy.set(e.attempt_id, list);
  }
  const attempts: Attempt[] = rows.attempts.map((a) => ({
    ...mapAttempt(a),
    responses: Object.fromEntries((responsesBy.get(a.id) ?? []).map((r) => [r.problem_id, mapResponse(r)])),
    events: (eventsBy.get(a.id) ?? []).sort((x, y) => String(x.at).localeCompare(String(y.at))).map((e) => mapEvent(e, nameOf)),
  }));

  const roundOfProblem = new Map<string, string>();
  for (const p of rows.problems) roundOfProblem.set(p.id, p.round_id);
  for (const [roundId, served] of Object.entries(rows.served)) for (const p of served) roundOfProblem.set(p.id, roundId);
  const rulings: Ruling[] = rows.rulings
    .filter((r) => roundOfProblem.has(r.problem_id))
    .map((r) => ({ roundId: roundOfProblem.get(r.problem_id)!, problemId: r.problem_id, normalized: r.normalized, correct: r.correct, by: nameOf(r.ruled_by) ?? '', at: r.ruled_at }));

  const clarifications: Clarification[] = rows.clarifications.map(mapClarification);

  // ------------------------------------------------------------------- email
  const templates: EmailTemplate[] = rows.email_templates.map((t) => ({ id: t.id, name: t.name, trigger: t.trigger, audience: t.audience, subject: t.subject, body: t.body }));
  const sends: EmailSend[] = rows.email_sends.map((s) => ({
    id: String(s.id), templateId: s.template_id ?? null, kind: s.kind, to: s.recipient, subject: s.subject ?? undefined,
    at: s.sent_at ?? s.queued_at, status: s.status === 'sent' ? 'sent' : s.status === 'queued' ? 'queued' : 'failed', keyId: s.key_id ?? null, error: s.error ?? null,
  }));
  const keysByOrg = new Map<string, EmailKey[]>();
  for (const k of rows.email_keys) {
    const list = keysByOrg.get(k.org_id) ?? [];
    list.push({ id: k.id, label: k.label, from: k.from_address, dailyLimit: k.daily_limit, active: k.active, lastError: k.last_error });
    keysByOrg.set(k.org_id, list);
  }
  const orgs: Org[] = rows.organizations.map((o) => {
    const ks = keysByOrg.get(o.id) ?? [];
    const first = ks.find((k) => k.active) ?? ks[0];
    return {
      id: o.id,
      name: o.name,
      short: o.slug,
      emailProvider: { kind: ks.length ? 'resend' : 'none', from: first?.from ?? '', dailyLimit: ks.filter((k) => k.active).reduce((n, k) => n + k.dailyLimit, 0) },
      emailKeys: ks,
    };
  });

  const activity: Activity[] = rows.activity
    .map((a) => ({ id: String(a.id), teamId: a.team_id ?? undefined, at: a.at, text: a.text, tone: (a.tone || '') as Activity['tone'] }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const results: PublishedResult[] = rows.results.map(mapResult);

  return {
    schema: 4, gen: 'remote', moment: 'live', seededAt: new Date().toISOString(),
    orgs, users, contests, teams, competitors, attempts, rulings, clarifications, templates, sends, activity, results,
  };
}
