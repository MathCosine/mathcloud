/**
 * Fills a Supabase project with the SFMO 2027 demo and real demo accounts.
 *
 *   SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run seed
 *
 * Options (environment variables):
 *   MOMENT          before | morning | guts | after   (default: before)
 *   DEMO_PASSWORD   password for every demo account   (default: mathcloud-demo)
 *   DEMO_DOMAIN     email domain for demo staff       (default: mathcloud.test)
 *
 * Safe to run again: it removes the previous demo organisation and demo
 * accounts first. It never touches anything else in the project. The
 * service role key bypasses row level security, so keep it out of the
 * browser and out of git: pass it in the environment or as a GitHub secret.
 */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildDemo, type Moment } from '../src/lib/demo/seed';
import { normalize } from '../src/lib/scoring/answers';
import type { DB } from '../src/lib/model';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Both are in Supabase: Project Settings, API.');
  process.exit(1);
}
const moment = (process.env.MOMENT ?? 'before') as Moment;
const password = process.env.DEMO_PASSWORD ?? 'mathcloud-demo';
const domain = process.env.DEMO_DOMAIN ?? 'mathcloud.test';
const STUDENT_DOMAIN = 'students.mathcloud.app';
const ORG_SLUG = 'sfmi-demo';

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** The same demo id always becomes the same UUID, so a re-seed keeps links stable. */
function uuidFor(name: string): string {
  const h = createHash('sha1').update(`mathcloud-demo:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

type Account = { demoId: string; email: string; name: string; label: string; username?: string };
const ACCOUNTS: Account[] = [
  { demoId: 'u-director', email: `director@${domain}`, name: 'Jordan Lee', label: 'Director: runs the contest' },
  { demoId: 'u-grader', email: `grader@${domain}`, name: 'Sam Ortega', label: 'Grader: keys paper sheets' },
  { demoId: 'u-proctor', email: `proctor@${domain}`, name: 'Priya Nand', label: 'Proctor: Zoom Room 1' },
  { demoId: 'u-coach', email: `coach@${domain}`, name: 'Megan Hughes', label: 'Coach: teams 16 (online) and 21' },
  { demoId: 'u-c16A', email: `student@${domain}`, name: 'Carter Hughes', label: 'Student, online, team 16' },
  { demoId: 'u-c16B', email: `sfmo-16b@${STUDENT_DOMAIN}`, name: 'Valeria Ruiz', label: 'Student, online, team 16 (username sign-in)', username: 'sfmo-16b' },
  { demoId: 'u-c05A', email: `sfmo-05a@${STUDENT_DOMAIN}`, name: 'Hannah Kim', label: 'Student, in person, team 05 (username sign-in)', username: 'sfmo-05a' },
];

async function must<T>(what: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) await must(`insert ${table}`, sb.from(table).insert(rows.slice(i, i + 500)));
}

async function wipe() {
  await must('remove the old demo', sb.from('organizations').delete().eq('slug', ORG_SLUG));
  const emails = new Set(ACCOUNTS.map((a) => a.email));
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list accounts: ${error.message}`);
    for (const u of data.users) if (u.email && emails.has(u.email)) await sb.auth.admin.deleteUser(u.id);
    if (data.users.length < 200) break;
  }
}

async function accounts(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const a of ACCOUNTS) {
    const { data, error } = await sb.auth.admin.createUser({
      email: a.email, password, email_confirm: true,
      user_metadata: { name: a.name, ...(a.username ? { username: a.username, managed: true } : {}) },
    });
    if (error || !data.user) throw new Error(`create ${a.email}: ${error?.message}`);
    ids.set(a.demoId, data.user.id);
  }
  return ids;
}

async function main() {
  console.log(`Seeding the SFMO 2027 demo (${moment}) into ${url}`);
  await wipe();
  const users = await accounts();
  const db: DB = buildDemo(moment);
  const c = db.contests[0];
  const id = (kind: string, demo: string) => uuidFor(`${kind}:${demo}`);
  const roundId = (r: string) => id('round', r);
  const teamId = (t: string) => id('team', t);
  const compId = (x: string) => id('comp', x);
  const isComp = (x: string) => db.competitors.some((k) => k.id === x);
  const userFor = (demoUser?: string) => (demoUser ? users.get(demoUser) ?? null : null);
  const director = users.get('u-director')!;

  const orgId = id('org', ORG_SLUG);
  await insert('organizations', [{ id: orgId, name: 'SF Math Initiative', slug: ORG_SLUG }]);
  await insert('memberships', [{ org_id: orgId, user_id: director, role: 'owner' }]);

  const contestId = id('contest', c.id);
  const recipe = { ...c.recipe, weights: Object.fromEntries(Object.entries(c.recipe.weights).map(([k, v]) => [roundId(k), v])) };
  await insert('contests', [{
    id: contestId, org_id: orgId, name: c.name, short_name: c.short, slug: c.slug, time_zone: c.timeZone, starts_on: '2027-01-23', date_label: c.dateLabel,
    registration: { open: c.registration.open, closes_label: c.registration.closesLabel, team_min: c.registration.teamMin, team_max: c.registration.teamMax },
    recipe, results_published: c.resultsPublished, board: { freeze_minutes: c.board.freezeMinutes, revealed: c.board.revealed },
    venue: c.venue ? { name: c.venue.name, address: c.venue.address, hall: c.venue.hall, bring: c.venue.bring } : null,
  }]);
  await insert('divisions', c.divisions.map((d) => ({ id: id('division', d.id), contest_id: contestId, name: d.name, mode: d.mode, detail: d.detail })));
  await insert('rounds', c.rounds.map((r, i) => ({
    id: roundId(r.id), contest_id: contestId, name: r.name, short_name: r.short, kind: r.kind, minutes: r.minutes, starts_at: r.startsAt, status: r.status, opened_at: r.openedAt ?? null,
    grace_seconds: r.graceSeconds, mystery: !!r.mystery, integrity: { policy: r.integrity.policy, lock_after: r.integrity.lockAfter }, rules: r.rules, position: i,
  })));
  const problems = c.rounds.flatMap((r) => r.problems.map((p) => ({ r, p })));
  await insert('problems', problems.map(({ r, p }) => ({ id: id('problem', p.id), round_id: roundId(r.id), number: p.number, set_no: p.set ?? null, body: p.text, answer_type: p.answerType, points: p.points })));
  await insert('answer_keys', problems.map(({ p }) => ({ problem_id: id('problem', p.id), accepted: p.answers, normalized: p.answers.map((a) => normalize(a, p.answerType)) })));

  await insert('teams', db.teams.map((t) => ({
    id: teamId(t.id), contest_id: contestId, division_id: id('division', t.divisionId), code: t.code, name: t.name, school: t.school, city: t.city,
    contact_name: t.contactName, contact_email: t.contactEmail, coach_id: userFor(t.coachId), status: t.status, join_code: t.joinCode, registered_at: t.registeredAt,
    time_zone: t.timeZone ?? null, notes: t.notes ?? null, fields: { pledge: t.pledge, wants_teammates: t.wantsTeammates ?? false },
  })));
  const studentUser = new Map(db.users.filter((u) => u.competitorId).map((u) => [u.competitorId!, u.id]));
  await insert('competitors', db.competitors.map((k) => ({
    id: compId(k.id), team_id: teamId(k.teamId), slot: k.slot, public_id: k.publicId, name: k.name, grade: k.grade, user_id: userFor(studentUser.get(k.id) ?? (k.id === 'c16B' ? 'u-c16B' : undefined)),
    guardian_name: k.guardianName, guardian_email: k.guardianEmail, waiver_signed_at: k.waiverSignedAt, waiver_signed_by: k.waiverSignedAt ? k.guardianName : null,
    checked_in_at: k.checkedInAt ?? null, device_checked_at: k.deviceCheckedAt ?? null, reminder_sent_at: k.reminderSentAt ?? null,
  })));

  const proctorOf = (demo?: string) => (demo === 'u-proctor' ? users.get('u-proctor') : demo === 'u-director' ? director : null);
  await insert('zoom_rooms', c.rooms.map((z) => ({ id: id('zoom', z.id), contest_id: contestId, name: z.name, url: z.url, proctor_id: proctorOf(z.proctorId), team_ids: z.teamIds.map(teamId) })));
  if (c.venue) await insert('venue_rooms', c.venue.rooms.map((v) => ({ id: id('venue', v.id), contest_id: contestId, name: v.name, team_ids: v.teamIds.map(teamId) })));
  await insert('agenda_items', c.agenda.map((a) => ({ id: id('agenda', a.id), contest_id: contestId, at: a.at, title: a.title, round_id: a.roundId ? roundId(a.roundId) : null, modes: a.modes, place: a.where ?? null, note: a.note ?? null })));
  await insert('contest_roles', [
    { contest_id: contestId, user_id: users.get('u-grader'), role: 'grader', round_ids: c.rounds.map((r) => roundId(r.id)) },
    { contest_id: contestId, user_id: users.get('u-proctor'), role: 'proctor', round_ids: [], room_id: id('zoom', 'room-1') },
  ]);

  const problemOf = new Map(problems.map(({ p }) => [p.id, p]));
  await insert('attempts', db.attempts.map((a) => ({
    id: id('attempt', a.id), round_id: roundId(a.roundId), competitor_id: isComp(a.entrantId) ? compId(a.entrantId) : null, team_id: isComp(a.entrantId) ? null : teamId(a.entrantId),
    source: a.source, started_at: a.startedAt ?? null, deadline: a.deadline ?? null, submitted_at: a.submittedAt ?? null, sets_submitted: a.setsSubmitted ?? 0,
    set_times: a.setTimes ?? [], locked: !!a.locked, honor_name: a.honorName ?? null,
  })));
  await insert('responses', db.attempts.flatMap((a) => Object.entries(a.responses).map(([pid, r]) => ({
    attempt_id: id('attempt', a.id), problem_id: id('problem', pid), value: r.value, normalized: normalize(r.value, problemOf.get(pid)!.answerType), saved_at: r.savedAt, saved_by: userFor(r.by),
  }))));
  await insert('integrity_events', db.attempts.flatMap((a) => a.events.map((e) => ({ attempt_id: id('attempt', a.id), kind: e.kind, ms: e.ms ?? null, at: e.at }))));
  if (db.rulings.length) await insert('rulings', db.rulings.map((r) => ({ problem_id: id('problem', r.problemId), normalized: r.normalized, correct: r.correct, ruled_by: director, ruled_at: r.at })));
  await insert('clarifications', db.clarifications.map((q) => ({
    id: id('clar', q.id), round_id: roundId(q.roundId), competitor_id: q.fromCompetitorId ? compId(q.fromCompetitorId) : null, question: q.question, answer: q.answer ?? null,
    broadcast: q.broadcast, asked_at: q.at, answered_at: q.answeredAt ?? null,
  })));
  await insert('email_templates', db.templates.map((t) => ({ id: id('template', t.id), contest_id: contestId, name: t.name, trigger: t.trigger, audience: t.audience, subject: t.subject, body: t.body })));
  await insert('activity', db.activity.map((a) => ({ contest_id: contestId, team_id: a.teamId ? teamId(a.teamId) : null, text: a.text, tone: a.tone, at: a.at })));

  console.log(`\nDone: ${db.teams.length} teams, ${db.competitors.length} competitors, ${db.attempts.length} attempts.\n`);
  console.log('Demo accounts (password for all: ' + password + ')');
  for (const a of ACCOUNTS) console.log(`  ${(a.username ?? a.email).padEnd(36)} ${a.name.padEnd(16)} ${a.label}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
