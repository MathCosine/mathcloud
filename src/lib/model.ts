/**
 * The domain model. These types mirror the tables in
 * supabase/migrations/0001_core.sql; the demo store keeps them in the browser,
 * the real store will read them through Supabase.
 */

/** 'guest': signed in, but not yet an organiser, coach or student anywhere. */
export type Role = 'director' | 'staff' | 'grader' | 'proctor' | 'coach' | 'student' | 'guest';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Demo only. Real accounts live in Supabase Auth. */
  password: string;
  /** Graders and proctors: which rounds / rooms they work on. */
  roundIds?: string[];
  roomId?: string;
  /** Coaches: the teams they manage. */
  teamIds?: string[];
  /** Students: their competitor record. */
  competitorId?: string;
  /** Students too young for their own email sign in with a username. */
  managed?: boolean;
};

/**
 * How a team takes part. Chosen once, at registration, and it decides almost
 * everything after: where the rounds happen, how answers are collected, what
 * the student's portal shows, which times they see.
 */
export type DivisionMode = 'in_person' | 'online';

export type Division = {
  id: string;
  name: string;
  mode: DivisionMode;
  /** Who it is for, shown at registration: "Teams more than 100 miles away". */
  detail: string;
};

/** A room at the venue. In-person teams sit in one for the individual-style rounds. */
export type VenueRoom = { id: string; name: string; teamIds: string[] };

export type Venue = {
  name: string;
  address: string;
  /** The big room: opening, Guts and awards. */
  hall: string;
  rooms: VenueRoom[];
  bring: string[];
};

/**
 * One line of the day. Rounds come from `rounds`; this adds everything else
 * (check-in, lunch, awards) and says where each thing happens for each mode.
 */
export type AgendaItem = {
  id: string;
  at: string;
  title: string;
  roundId?: string;
  modes: DivisionMode[];
  /** In person: 'room' is the team's own room, 'hall' the venue's hall, or a place name. */
  where?: 'room' | 'hall' | string;
  note?: string;
};

export type RoundKind = 'individual' | 'team' | 'guts';

export type AnswerType = 'integer' | 'expression';

export type Problem = {
  id: string;
  number: number;
  /** Guts set, from 1. */
  set?: number;
  /** Markdown-ish text with $…$ maths. */
  text: string;
  /** Accepted answers, as typed in the key. */
  answers: string[];
  answerType: AnswerType;
  points: number;
};

export type IntegrityPolicy = 'log' | 'warn' | 'lock';

export type RoundStatus = 'scheduled' | 'open' | 'closed';

export type Round = {
  id: string;
  name: string;
  short: string;
  kind: RoundKind;
  minutes: number;
  /** Scheduled start, ISO. Every division starts together. */
  startsAt: string;
  status: RoundStatus;
  /** When the director opened it (demo: may differ from the schedule). */
  openedAt?: string;
  graceSeconds: number;
  /** Format hidden on public pages until the round starts. */
  mystery?: boolean;
  integrity: { policy: IntegrityPolicy; lockAfter: number };
  problems: Problem[];
  rules: string;
};

export type ScoringRecipe = {
  /** How a team's individual-round score is built from its members. */
  teamIndividual: { method: 'sum' | 'best' | 'average'; best: number; fillMissingTo: number };
  /** Weight of each round in the team total. Rounds missing here count 0. */
  weights: Record<string, number>;
  /** Break individual ties by who solved the harder problems. */
  harderFirst: boolean;
  awards: AwardRule[];
};

export type AwardRule = {
  id: string;
  scope: 'individual' | 'team';
  label: string;
  rule: 'top_n' | 'top_percent';
  value: number;
};

export type ZoomRoom = {
  id: string;
  name: string;
  url: string;
  proctorId?: string;
  teamIds: string[];
};

export type Contest = {
  id: string;
  orgId: string;
  name: string;
  short: string;
  slug: string;
  dateLabel: string;
  /** Where the contest happens; scheduled times are shown in this zone. */
  timeZone: string;
  divisions: Division[];
  rounds: Round[];
  recipe: ScoringRecipe;
  rooms: ZoomRoom[];
  /** Set when the contest has an in-person division. */
  venue: Venue | null;
  agenda: AgendaItem[];
  resultsPublished: boolean;
  /** The live Guts board: it freezes this many minutes before the end, until revealed. */
  board: { freezeMinutes: number; revealed: boolean };
  /**
   * coaches: false when the organisers enter every team themselves (imports,
   * their own sign-up form) and coaches never need an account. Absent means true.
   */
  registration: { open: boolean; closesLabel: string; teamMin: number; teamMax: number; coaches?: boolean };
  /**
   * A contest is in person or online. One that runs both at the same time is
   * two contests, each the other's edition: problems copied once, results apart.
   */
  linkedId?: string;
};

export type TeamStatus = 'pending' | 'confirmed' | 'withdrawn';

export type Team = {
  id: string;
  contestId: string;
  code: string;
  name: string;
  divisionId: string;
  school: string;
  city: string;
  contactName: string;
  contactEmail: string;
  coachId?: string;
  status: TeamStatus;
  registeredAt: string;
  joinCode: string;
  /** Online teams: where they are, so their portal can show their own clock. */
  timeZone?: string;
  /** In person: allergies, access needs. Online: nothing extra. */
  notes?: string;
  pledge: number | null;
  wantsTeammates?: boolean;
  disqualified?: string;
  /** Its id in the system it was imported from. */
  externalId?: string;
};

export type Competitor = {
  id: string;
  teamId: string;
  slot: string;
  publicId: string;
  name: string;
  grade: number;
  guardianName: string;
  guardianEmail: string;
  waiverSignedAt: string | null;
  /** Who signed, or how it arrived ("Paper copy at check-in"). */
  waiverSignedBy?: string | null;
  reminderSentAt?: string | null;
  checkedInAt?: string | null;
  /** Online: when the student last passed the device check. */
  deviceCheckedAt?: string | null;
  disqualified?: string;
  /** Their id in the system they were imported from. */
  externalId?: string;
};

export type IntegrityKind =
  | 'hidden'
  | 'blur'
  | 'fullscreen_exit'
  | 'paste'
  | 'resize'
  | 'offline'
  | 'second_session'
  | 'warned'
  | 'locked'
  | 'unlocked';

export type IntegrityEvent = { at: string; kind: IntegrityKind; ms?: number; by?: string };

export type Response = {
  value: string;
  savedAt: string;
  /** Who typed it: a student's user id, or a grader's for paper sheets. */
  by: string;
};

export type Attempt = {
  id: string;
  roundId: string;
  /** Competitor id for individual rounds, team id for team and guts rounds. */
  entrantId: string;
  source: 'online' | 'paper';
  startedAt?: string;
  deadline?: string;
  submittedAt?: string;
  /** Guts: sets handed in, in order. */
  setsSubmitted?: number;
  /** Guts: when each set was handed in (online) or keyed (paper). Drives the live board and its freeze. */
  setTimes?: string[];
  responses: Record<string, Response>;
  events: IntegrityEvent[];
  locked?: boolean;
  honorName?: string;
};

/** A director's decision about one distinct answer to one problem. */
export type Ruling = { roundId: string; problemId: string; normalized: string; correct: boolean; by: string; at: string };

export type Clarification = {
  id: string;
  roundId: string;
  fromCompetitorId?: string;
  question: string;
  answer?: string;
  broadcast: boolean;
  at: string;
  answeredAt?: string;
};

export type EmailTemplate = {
  id: string;
  name: string;
  trigger: 'registered' | 'waiver_missing' | 'before_contest' | 'results' | 'manual';
  audience: 'contacts' | 'guardians' | 'students';
  subject: string;
  body: string;
};

export type EmailSend = {
  id: string;
  templateId?: string | null;
  /** 'template', 'score_report', 'waiver_reminder', ... */
  kind?: string;
  to: string;
  subject?: string;
  at: string;
  status: 'queued' | 'sent' | 'failed';
  keyId?: string | null;
  error?: string | null;
};

/** One provider API key. Several can share the sending, each up to its own daily limit. */
export type EmailKey = { id: string; label: string; from: string; dailyLimit: number; active: boolean; lastError?: string | null };

/** What a competitor or team sees once results are published. */
export type PublishedResult = { competitorId?: string; teamId?: string; data: ResultData };
export type ResultData = {
  name: string;
  publicId?: string;
  division: string;
  place: number | null;
  of: number;
  score: number;
  max?: number;
  award?: string | null;
  rounds?: { name: string; score: number; max: number }[];
  problems?: { number: number; status: 'correct' | 'incorrect' | 'blank' | 'unreviewed' }[];
  team?: { name: string; place: number | null; of: number; total: number };
};

export type Activity = { id: string; teamId?: string; at: string; text: string; tone: 'b' | 'g' | 'a' | '' };

export type Org = {
  id: string;
  name: string;
  short: string;
  emailProvider: { kind: 'resend' | 'smtp' | 'gmail_relay' | 'none'; from: string; dailyLimit: number };
  /** The pool of sending keys; sending uses each up to its limit, then the next. */
  emailKeys?: EmailKey[];
};

export type DB = {
  schema: number;
  /** Changes whenever the demo is reset or jumps to another moment. */
  gen: string;
  /** Sandbox only: which moment of the contest day this copy starts from. 'live' when connected to Supabase. */
  moment: 'before' | 'morning' | 'guts' | 'after' | 'live';
  seededAt: string;
  orgs: Org[];
  users: User[];
  contests: Contest[];
  teams: Team[];
  competitors: Competitor[];
  attempts: Attempt[];
  rulings: Ruling[];
  clarifications: Clarification[];
  templates: EmailTemplate[];
  sends: EmailSend[];
  activity: Activity[];
  /** Published results visible to this person (students and coaches, when connected). */
  results?: PublishedResult[];
};
