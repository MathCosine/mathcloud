# Research notes

Background for [`PROPOSAL.md`](PROPOSAL.md). Three parts: what ContestDojo
actually is, what you have already built that MathCloud should absorb, and the
outside constraints (email limits, what a browser can detect) that shape the
design. Gathered 12 October 2026.

---

## 1. ContestDojo, taken apart

ContestDojo runs registration, team formation, waivers, online tests and score
reports for SMT, BMT/BmMT and ICMT. There are no public docs beyond what each
tournament's FAQ says, so most of this comes from its public API repository
and from the route list and UI strings in its production JavaScript bundle.

### Stack

- **Web app:** Next.js (pages router) with **Chakra UI** (`chakra-modal`,
  `chakra-button`, `chakra-form` classes in the bundle), backed by **Firebase**.
- **API:** Python/Starlette over Firestore, at
  [`github.com/contestdojo/api`](https://github.com/contestdojo/api). The repo
  is archived. Its last commit (June 2026) added an OAuth resource server:
  `GET /v1alpha1/me/events` with a `read:events` scope, which lets other sites
  sign people in with ContestDojo and read their registrations.

### Every page, by role

From the bundle's build manifest:

| Role | Pages |
| --- | --- |
| **Admin** (the contest) | entity → event → `orgs`, `students`, `teams`, `tests`, `settings`; per test: `clarifications`, `grade`, `submissions` |
| **Coach** | `coach/new`, org → event → `teams`, `reports`, `checkout-success`, `apply` |
| **Student** | event, `forms/[formId]`, `tests`, `tests/[testId]`, `tests/[testId]/results`, `checkout-success` |
| **Public** | event page, `tests/[testId]/scoreboard`, `waivers/[studentId]` |
| **Auth** | `login`, `register`, `token_login`, `oauth/authorize` |

### Data model

From `contestdojo_api/schemas.py`:

- **Entity** (the group running contests): name, admins, `stripeAccount`.
  Each entity takes payments into its own Stripe account.
- **Event**: name, date, `costPerStudent`, `costAdjustments` (rule + amount),
  `studentsPerTeam`, `maxTeams`, `billByTeam`, `frozen`, `hide`,
  `scoreReportsAvailable`, `waiver`, `addOns`, `studentRegistrationEnabled`,
  and three lists of **custom fields** (student, org, team). Each custom field
  has a label, choices, help text, a validation regex, and
  `required` / `editable` / `hidden` flags.
- **Organization** (a school or club, run by a coach): address, admin.
- **EventOrganization**: `maxStudents` (seats bought), join `code`, notes,
  custom field values, add-ons.
- **EventTeam**: name, org, `number`, `scoreReport`, `code`, `checkInPool`,
  `roomAssignments`, `isCheckedIn`.
- **EventStudent**: user, org, team, `number`, `waiver`, grade, custom field
  values, `checkInPool`, `roomAssignments`, `isCheckedIn`.

### What the screens do

UI strings from each page's bundle, grouped:

- **Admin tables** (orgs, students, teams): sort, a "Shown Fields" column
  picker, `[Custom]` columns for custom fields, **Download CSV**, and
  **Impersonate** (view the site as that coach). The orgs table shows
  `# Seats Purchased / # Students Added / # Students Assigned`.
- **Event settings:** students per team, base cost per student, a markdown cost
  description, **Freeze roster changes**, **Assign Team/Student Numbers**.
- **Tests:** mode **Standard** or **Guts** (with `# Problems Per Set`), **This
  is a team round**, total duration, **grace period**, **Open Test / Close
  Test**, and **Test Restrictions**, a small rules engine ("Deny by default,
  allow if ALL rules are met"; field equals / one of / matches regex) that
  decides who may take a test.
- **Grading:** grading is done **by distinct answer**. Every distinct
  submission is listed once; an admin marks it correct; **Mark Rest
  Incorrect**; **Re-grade Tests** after a key change. Then on submissions:
  **Re-grade All** and **Release Results** ("Students will be able to view
  their graded tests").
- **Clarifications:** an admin page per test, published to students during
  the test.
- **Student test page:** **Round Rules**, **Clarifications**, "Saving…",
  **Next Set** ("Once you move onto the next set, you cannot return"), "Time's
  up!".
- **Coach teams page:** drag students between teams ("Drag students here"),
  invite students by email (one per line), add students manually, add-ons,
  checkout, **Waiver Missing / Waiver Signed**, **Go to Check-in**, **Room
  Assignments**, **View Score Reports**.
- **Student event page:** join an organization by code, create or join a team,
  send a waiver request to a parent's email, forms, cancel registration,
  download the signed waiver, individual score report.
- **Public:** a scoreboard (Rank, Team, Organization, Progress, Score) and a
  waiver page where a guardian draws a signature ("Click to Sign").

### What the tournaments say about it

- **BMT:** an adult creates a coach account and an organization (just a label,
  so a family name works), registers it for the event, and gets a join code.
  Students make their own accounts and join with the code. The coach buys
  seats and assigns students to teams. Waivers are signed in the portal, and
  nobody competes without one.
  ([FAQ](https://berkeley.mt/faqs/))
- **BMT 2026 online:** $8 per student, teams of up to 6, students may form
  teams without a coach, rosters editable until tournament day. Guts is 9 sets
  of 3 with a live scoreboard. A team with fewer than 4 members has zeros added
  until it has 4 individual scores. Tiebreaks favour solving harder problems.
  ([event page](https://berkeley.mt/events/bmt-2026-online/))
- **BmMT 2025 score reports:** students download an individual report with
  their own round, their team's rounds, statistics, **scans of their answer
  sheets** and their certificate. Coaches get team reports with the overall
  score worked out. ([news](https://berkeley.mt/news/bmmt-2025-score-reports-released/))
- **SMT online:** a parent can form an org and register one student as a team
  of one, with an option to be merged with other incomplete teams.
  ([SMT 2024 Online](https://www.stanfordmathtournament.com/competitions/smt-2024-online))
- **ICMT 2026:** registration, team assignments, waivers and score reports all
  on ContestDojo, with a waitlist once full.
  ([ICMT](https://intercollegiatemathtournament.org/icmt-2026/))

### Where it stops

- **Paper grading.** BMT's reports contain scans of answer sheets, so paper
  rounds are graded somewhere, but no page in the public bundle keys paper
  answers or runs a grading room. That is the part your Cowconuts portal
  already does well.
- **Scoring is not configurable in the UI.** No page in the bundle sets round
  weights, best-k-of-n or award cutoffs. Score reports are uploaded files
  (`scoreReport` is a string on the team and student).
- **No email, certificate or prize tooling.** Tournaments send their own
  email, and certificates arrive inside the uploaded score report PDF.
- **Every student needs an account.** That is friction for families, and a
  problem for under-13s.
- **The look is stock Chakra.** It works, but it looks like the defaults.

---

## 2. What you have already built

Each of these is a working piece of MathCloud, written for one contest.

| Repo | What it is | What carries over |
| --- | --- | --- |
| [`sfmo`](https://github.com/MathCosine/sfmo) | SFMO 2027 site, team registration on Supabase, staff portal | RLS security model (anon key only, `register_team()` as a `SECURITY DEFINER` RPC, staff table); competitor IDs `07A`; divisions with the 100-mile rule; liability waiver and media release with typed signatures; optional donation pledge; one confirmation email per team, sent through AgentMail, Resend or a Gmail Apps Script relay; staff portal with status, CSV, printable check-in sheet, registration on/off |
| [`sfpoproofs`](https://github.com/MathCosine/sfpoproofs) | The **Cowconuts 2026** staff portal: answer entry and live scoring | Answer-sheet keypad entry checked against the key as you type; atomic locks so nobody keys the same sheet twice; guts entry by set; per-division keys; best 3 of 4 team score; combined score with a configurable multiplier; shared places on ties; pasted tiebreak lists; disqualification of a team or one contestant; contest clock and a public guts board that freezes in the last 10 minutes; printable score reports that never show anyone's answers; emailing each student their report via Gmail OAuth with a check that each PDF matches its recipient; `preflight.sql` readiness checks |
| [`certificatesending`](https://github.com/MathCosine/certificatesending) | Stamps names onto a Canva PDF and emails them | Name drawn as vector text on the original PDF (pdf-lib); calibration guides; auto-shrink for long names; font fallback, and holding back names no font can set; a sent-log so a re-run never double-sends; Resend idempotency keys |
| [`mailerbot`](https://github.com/MathCosine/mailerbot) | Concept and stack notes for templated mass email | Mass sending is a queue-and-worker job, not something an HTTP request waits on; Supabase with RLS for multi-tenant data; deterministic fields (IDs, scores) are never written by a model |
| [`sfmmm2026`](https://github.com/MathCosine/sfmmm2026), [`estimathon2026`](https://github.com/MathCosine/estimathon2026) | SF Mini Math Meet certificate page, Estimathon page | The certificate and estimation formats MathCloud has to support |

Your contests set the requirements:

- **SFMO 2027** (January, in person in SF, plus an online division for teams
  more than 100 miles away). Teams of 1 to 4. Individual (20 problems, 60 min),
  Mystery Dive (a team round whose format is revealed on the day), Guts (6 sets
  of 4, live scoreboard). Free entry with an optional pledge. Registration opens
  **24 October 2026** on the SFMO site.
- **SF Mini Math Meet** (August 2027, online, grades 3–12, three rounds, two
  divisions). The grades 3–12 range means children under 13.
- **SF Proof Open**: proof-based, graded by hand.

---

## 3. Outside constraints

### Email

- **Resend free plan:** 100 emails a day and 3,000 a month, 10 requests a
  second, up to 100 emails per batch call. Batch sends **cannot carry
  attachments**. Idempotency keys are supported.
  ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits),
  [batch](https://resend.com/docs/api-reference/emails/send-batch-emails))
  A 120-team contest emailing guardians outgrows the free plan in one day, so
  the sender has to pace itself across days or the organiser has to upgrade.
- **Gmail through Apps Script** (SFMO's relay): about 100 recipients a day on a
  free account. That is the figure in your own `Code.gs`.
- **Gmail through OAuth (`gmail.send`):** a sensitive scope. Until Google
  verifies the app, users see an "unverified app" screen and the project has a
  **100-user cap for its whole lifetime**. Verification takes weeks. Internal
  Workspace apps are exempt.
  ([Google OAuth FAQ](https://support.google.com/cloud/answer/13463817))
  That is fine for one organiser (Cowconuts does it) and not fine for a
  platform until it is verified.
- **SMTP with an app password** (Gmail, Workspace, Outlook, school mail) needs
  no verification and lets an organiser send from their own address. The
  provider's own daily limits apply. Your Cowconuts README gives 500 a day for
  personal Gmail and 2,000 for Workspace.

### What a browser can detect during an online test

Detectable: the tab hidden (`visibilitychange`), the window losing focus
(`blur`, which catches switching to another app), leaving fullscreen,
copy/paste, the window being resized (split screen), the same competitor signed
in twice, a change of network, and how long each absence lasted.

Not detectable: a phone or second computer, another person in the room, a
browser extension that suppresses the events above (such extensions exist), and
iPad Slide Over, where neither `blur` nor `visibilitychange` fires. iPhones
cannot go fullscreen at all.
([TestInvite fullscreen docs](https://www.testinvite.com/dy/en/pages/documentation/anticheat-screen-mode-fullscreen),
[Apple developer forum](https://developer.apple.com/forums/thread/824481))

So integrity signals are evidence for a person to review, never proof, and
never grounds for an automatic disqualification.

---

## Sources

- [contestdojo/api on GitHub](https://github.com/contestdojo/api)
- [contestdojo.com](https://contestdojo.com) (route list and UI strings from its production bundle)
- [Berkeley Math Tournament FAQ](https://berkeley.mt/faqs/)
- [BMT 2026 Online](https://berkeley.mt/events/bmt-2026-online/)
- [BmMT 2025 score reports released](https://berkeley.mt/news/bmmt-2025-score-reports-released/)
- [SMT 2024 Online](https://www.stanfordmathtournament.com/competitions/smt-2024-online)
- [ICMT 2026](https://intercollegiatemathtournament.org/icmt-2026/)
- [HMMT Online Tournament](https://hmmt.co/www/tournaments/online)
- [Resend quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Resend batch emails](https://resend.com/docs/api-reference/emails/send-batch-emails)
- [Google OAuth verification FAQ](https://support.google.com/cloud/answer/13463817)
- [TestInvite: fullscreen anti-cheat](https://www.testinvite.com/dy/en/pages/documentation/anticheat-screen-mode-fullscreen)
- [Apple developer forum: detecting Slide Over](https://developer.apple.com/forums/thread/824481)
