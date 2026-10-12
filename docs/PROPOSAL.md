# MathCloud: proposal

**Status:** a working demo of the core is built (see §6 and the README). Research
is in [`RESEARCH.md`](RESEARCH.md); the database, hosting and costs are in
[`STACK.md`](STACK.md).

### Decided on 12 October

- **Everyone has an account**: directors, staff, graders, proctors, coaches
  and students. Students too young for email get a **managed account** (a
  username their coach or guardian sets up).
- **SFMO's online division sits every round at the same moment** as the room
  in San Francisco, in the browser, **on Zoom with cameras on**.
- **Stack:** a Vite + React single-page app on Cloudflare Pages, with
  Supabase for the database, accounts, files and live updates.
  `mathcloud.replit.app` was an earlier test portal; this replaces it.

---

## In one paragraph

MathCloud runs a math contest from start to finish for whoever organises it:
registration, the roster, an online test portal or a paper-grading room,
scoring and rankings, results, and then certificates, prizes and emails. Each
organisation's contests are private to that organisation. It combines what
ContestDojo does for SMT and BMT (registration, teams, waivers, online tests)
with what your Cowconuts portal does (keying and scoring paper rounds, live
boards, score reports), and adds what neither does: scoring you can configure,
email you send from your own account, and certificates and prizes generated
automatically. SFMO 2027 is the first contest it has to run.

---

## 1. Who uses it

| Person | Signs in with | Can see |
| --- | --- | --- |
| **Owner / Director** | account | Everything in their organisation's contests |
| **Staff** | account | Roster, check-in, emails. Not the answer key unless granted. |
| **Grader** | own account, from an invite | Only the rounds they are assigned. No contact details. |
| **Proctor** | own account, from an invite | Live status, flags and questions for their Zoom room |
| **Problem writer** | account | Problems and solve statistics. No names. |
| **Coach** | account | Their own teams: rosters, waivers, invoices, score reports |
| **Competitor** | own account: email, or a managed username for under-13s | Their tests, results and certificates |
| **Guardian** | emailed link, no account needed | One waiver to sign |

**Students have accounts, and the youngest have managed ones.** A student 13
or older signs up with their own email or joins with a team code. For younger
students, the coach or guardian creates the account (`sfmo-16c` and a
password), so no email or other contact detail is collected from the child.
One account follows a student from contest to contest, so their history and
certificates stay in one place.

**Three ways to register**, chosen per contest:

1. **Team captain** registers the whole team (SFMO's current model).
2. **Coach organisation** with a join code and seats, students added or
   invited (ContestDojo's model, for schools and clubs).
3. **Individual**, with a "put me on a team" pool the director merges into
   teams later. SMT and ICMT do this merging by hand.

**Privacy is enforced in the database.** Every row carries an organisation
and a contest, and Postgres row level security decides who reads it. This is
the model SFMO's `schema.sql` already uses. A grader's session cannot read
guardian emails, however the UI is written.

---

## 2. The modules

### 2.1 Contest setup

- **Contest:** one edition, e.g. *SFMO 2027*. **Duplicate last year** copies
  divisions, rounds, scoring, templates and certificates and leaves the people
  behind.
- **Divisions:** each has a mode (*in person*, *online*), an eligibility rule,
  team size limits and its own answer keys. SFMO: *In person* and *Online*.
  Cowconuts: *A* and *B*.
- **ID scheme**, set by a template:
  `{team:2}{slot}` gives `07A` (SFMO); `{division}{team:2}{member}` gives
  `A011` (Cowconuts). IDs are assigned at registration, or all at once with
  **Assign numbers** when the roster freezes, as ContestDojo does.
- **Rounds:** type, mode (online or paper), problems, a key per division,
  timing. Types:
  - *Standard*: all problems, any order.
  - *Guts*: sets released one at a time; you cannot go back.
  - *Team*: one answer sheet shared by the whole team.
  - *Relay*: each answer feeds the next problem.
  - *Estimation*: Estimathon-style intervals with limited attempts.
  - *Proof / Power*: written solutions graded by hand against a rubric.
  - *Mystery*: any of the above, with its type hidden from the public pages
    until the round starts. This is SFMO's Mystery Dive.

### 2.2 Registration

- **Form builder** with fields at three levels (team, competitor, guardian),
  like ContestDojo's custom fields: label, type, choices, help text,
  validation, and *required / editable after submit / hidden from registrant*.
  Fields can depend on each other: SFMO's distance attestation only appears
  when the division is *Online*.
- **Built-in blocks:** roster editor, waiver (typed or drawn signature, signed
  by the guardian through an emailed link), media release, policies, fee or
  donation.
- **Fees:** free; a pledge (SFMO); or paid through **Stripe Connect** into the
  organiser's own Stripe account (ContestDojo gives each entity its own
  `stripeAccount`). Per student or per team, with early-bird prices and
  fee-waiver codes.
- **Windows:** opens, closes, capacity, waitlist, roster freeze.
- **Where the form lives:** a hosted page on MathCloud in the contest's own
  colours and logo, or headless through the API so an organiser's own site
  keeps its design (SFMO, section 3).
- **Look up and edit** with team code and contact email (SFMO's
  `lookup_team`), until the roster freezes.

### 2.3 Roster: "who registered"

The screen organisers spend the most time on. The mockup shows it.

- Tables for **Teams, Competitors, Guardians, Coaches**. Each has sorting,
  search, filters (division, status, waiver), a column picker, and **Export
  CSV**.
- **Status:** *Pending → Confirmed → Checked in*, plus *Waitlisted* and
  *Withdrawn*. Each change is logged with who made it.
- **Waivers per competitor**, shown as a small row of pips. One click sends the
  missing guardians a reminder.
- **Bulk actions** on selected rows: confirm, move division, resend
  confirmation, email.
- **View as coach** (ContestDojo's *Impersonate*) for support calls. Each use
  is logged.
- **Check-in:** a QR code in every confirmation email. The desk scans it with
  a phone. Room assignments, a printed check-in sheet (SFMO already prints
  one), name badges.

### 2.4 Online test portal

**Same time as the room.** For SFMO the online division starts each round at
the same moment as the paper room in San Francisco: the director opens the
round and one clock starts for everyone. Online competitors see their Zoom
room on their home page and in the test, and are asked to join 20 minutes
early with cameras showing them and their desk.

**Flow:** open the link → device check (browser, fullscreen, connection) →
waiting room with countdown and round rules → test → submit → results when the
director releases them.

**Timing is enforced by the server.** The start time is recorded in the
database. The deadline is the window end or start + duration, whichever comes
first, plus a grace period. A save after the deadline is rejected by the
database function, not just hidden by the page. Two schedules: everyone starts
at 10:00, or a window (start any time between 9:00 and 12:00, then 60
minutes). Extra time per competitor for accommodations.

**Answers save on every change**, with a visible "Saved 10:42:07". If the wifi
drops, answers queue in the browser and sync when it returns, and the gap is
logged.

**Problems are not in the page.** They are fetched only after the round
starts, through a function that checks the window. Images use short-lived
links. The competitor's ID is watermarked faintly across the problem text, so
a screenshot posted in a Discord server identifies who posted it.

**Team rounds:** one shared sheet. Teammates see who is editing which box.
Edits are last-write-wins, with the history kept.

**Guts:** set *n*+1 unlocks when set *n* is submitted (ContestDojo's "Next
Set"). Each submitted set appears on the live board at once.

**Clarifications:** a competitor asks; a proctor replies to them alone or
broadcasts to everyone, and the broadcast appears as a banner on every screen.

**Answer boxes:** an integer keypad mode (the Cowconuts grid behaviour),
expressions with a live rendered preview (KaTeX), multiple choice.

#### Integrity: "it tracks if you go to other websites"

What a browser can and cannot see is in `RESEARCH.md` §3. In short, it can
tell when the test tab is hidden, the window loses focus, fullscreen ends,
someone pastes, the window shrinks to split screen, or the same competitor
opens the test twice. It cannot see a phone.

So:

- **Every event is logged** with a timestamp and how long the competitor was
  away: *"Left the test for 14 s at 10:23:05."*
- **A proctor dashboard** shows each competitor's flags live.
- **A policy per round:** *Log only*, *Warn* (a dialog: "You left the test.
  This has been recorded."), or *Lock after N*, after which a proctor has to
  unlock them, and the unlock is logged too.
- **An honour code** typed at the start.
- **After the contest, a collision report:** competitors or teams sharing the
  same *rare wrong* answers are flagged. It is cheap, and it catches what
  browser events miss.
- **Never an automatic disqualification.** The director reviews the evidence.
- **Zoom proctoring** (SFMO uses it): teams are assigned to rooms of about
  four teams each, every room has a proctor account, and the proctor's screen
  lists exactly the students in their room with their flags and questions.
  Meeting links are pasted in at first and created through the organiser's
  own Zoom app later (`STACK.md`).

### 2.5 Grading portal (paper rounds)

The Cowconuts portal, made general:

- **Key in the sheet, not the score.** The keypad grid turns each box green or
  red as it is typed. Locks stop two graders keying one sheet. A scorer
  register shows who keyed what. Progress shows per team.
- **Optional double entry:** two graders key the same sheet independently and
  disagreements go to a queue. This catches the typo a single grader would
  save.
- **Grading by distinct answer** for online short answers (ContestDojo's grade
  page). Exact matches to the key grade themselves. Every other distinct answer
  (`0.5`, `1/2`, `\frac12`) is listed once with how many people gave it. The
  director rules once and all of them update. **Re-grade** reruns everything
  after the key changes. This is more dependable than trying to judge
  equivalence automatically.
- **Proofs:** a rubric per problem; graders work by problem, not by paper;
  scans have names removed; two graders per proof, and a gap larger than a
  threshold goes to a third.
- **Later:** printed answer sheets with a QR code per competitor and round;
  scans are uploaded, split by QR code, and graders see the cropped boxes.

### 2.6 Scoring and rankings: "the system computes everything"

A **scoring recipe** made of blocks, with every result traceable to its
inputs.

| Block | Options |
| --- | --- |
| Problem points | equal · per-problem weights · guts set values that rise by set |
| Round score | sum · Estimathon formula · rubric total |
| Team from individuals | sum · **best k of n** · average · fill missing members with zero (BMT) |
| Combined | weighted sum of rounds (Cowconuts: `3 × individual + guts`) · optional scaling of each round to 100 |
| Tiebreak chain | harder problems first, weighted by how few solved them (BMT) · a chosen round · earliest final submission (online) · a pasted list (Cowconuts) · a tiebreak round |
| Ranking | shared places, 1, 1, 3 (the default and the right one) · per division / combined / per grade |
| Awards | top N · top % (BMT online: 10 / 25 / 50 %) · score cutoff · special awards defined as a filter plus a rank (best grade 8, best new team) |

- **An expression box** for formats the blocks cannot express:
  `3 * best(individual, 3) + guts`. It is parsed by a small safe evaluator,
  never `eval`, and shown next to the blocks it replaces.
- **Hover any score to see the sum behind it** (Cowconuts does this).
- **Results are versioned.** Draft, then *Published v1*. Before *v2* is
  published, a diff shows who moved and why: "07A: 14 → 15 (P17 regraded),
  4th → 3rd". A grading correction that changes an award cannot slip through
  unnoticed.
- **Disqualify** a team or one competitor, with a reason that appears in the
  exports (Cowconuts).

### 2.7 On the day

Contest clock with start, pause and ±1 minute (Cowconuts). Projector boards
that freeze in the last 10 minutes. A public scoreboard URL. Banner
announcements to online competitors. A preflight page that turns `preflight.sql`
into a checklist: key filled in, roster loaded, clock parked, test data
cleared.

### 2.8 Email

**The organiser chooses how mail is sent**, and MathCloud sends through their
account:

| Way | Good for | Catch |
| --- | --- | --- |
| **Resend API key** + their verified domain | Best delivery, from `registration@theircontest.org` | Free plan: 100 a day, 3,000 a month; batch sends can't attach files |
| **SMTP** (Gmail app password, Workspace, Outlook, school mail) | "Send from my own email" with no setup on our side | The provider's daily limit |
| **Gmail relay** (SFMO's Apps Script) | Free, from a personal Gmail | About 100 a day |
| **Sign in with Google** (OAuth) | The easiest setup for organisers | MathCloud needs Google's verification first (weeks; 100-user lifetime cap until then). Later. |

- **Keys are write-only.** Once saved, they show as `re_…4f2a · last used 3 h
  ago` and are never sent back to the browser. They are stored encrypted
  (Supabase Vault). A **Send test to me** button sits next to them.
- **Templates:** paste your own HTML or use the editor, with a plain-text
  version. Variables come from any field (`{{team.name}}`, `{{competitor.id}}`,
  `{{guardian.first_name}}`). Conditions: `{{#if division == "online"}}`.
  Loops for team emails: `{{#each members}}`. Preview against a real
  registrant before saving.
- **Triggers:** registered; waiver still missing N days before; N days before
  the contest (logistics, or the online test link); results published;
  certificates ready. Plus a one-off email to any filtered set of the roster.
- **The sender is a queue with a ledger** (the `certificatesending` sent-log
  as a table). One idempotency key per template, recipient and trigger, so
  nobody gets the same email twice. It knows its quota: *"142 queued. 100 go
  today; the rest go tomorrow at 00:00 UTC, or upgrade Resend to send them
  now."* Bounces from Resend webhooks mark the address on the roster.
- **Every attachment is checked before it goes:** the PDF must show the
  recipient's own name and ID, or that email is held (the Cowconuts rule).

### 2.9 Certificates and prizes

**Certificates**

- Upload a PDF or PNG per award: Participation, Honourable Mention,
  Distinguished HM, 1st / 2nd / 3rd, special awards.
- **Place fields by dragging them on a preview:** name, award, division,
  place, score, date. Font, size, colour, auto-shrink for long names. This is
  `certificatesending`'s calibrate step with a mouse instead of
  `--name-y 0.60`. Font fallback and the hold-back for names no font can set
  are already solved there.
- **Each certificate has a short verification code and QR code** linking to a
  public page: *"Issued to … for Distinguished HM, SFMO 2027."* Students put
  these on applications; this makes them checkable.
- **Delivery:** attached to an email (single sends), or a download link
  (batch sends, since Resend batches cannot attach files). Also on the
  competitor's results page and in the coach's team download.

**Prizes**

- A prize table per award: cash, gift card, sponsor code, physical item.
- **Code pools:** paste a sponsor's list of coupon codes (AoPS, Brilliant…).
  They are handed out by award automatically and go in the results email.
  Most contest prizes are these.
- **Physical or cash prizes:** a form sent only to winners collects a shipping
  address or payout handle. A tracker follows each prize: *assigned → details
  received → shipped / paid*.
- Automatic payouts through a rewards API (Tremendous, for example) are
  possible later. They need a funded account and some tax care, so they are
  not in the first versions.

### 2.10 Wrap-up

One **Close the contest** checklist:

1. Publish results. Choose what is public: the top N names, the full table, or
   nothing.
2. Release score reports. Per competitor and per team, in the Cowconuts
   format, showing right / wrong / blank and never the answers themselves.
3. Statistics for problem writers: solve rate, how well each problem separated
   strong and weak scorers, score distributions.
4. Send certificates.
5. Hand out prizes.
6. Send the thank-you and feedback survey.
7. Archive. The results page stays up.
8. Export everything: one zip of CSVs and PDFs.
9. Data retention: delete guardian contacts and minors' details after N
   months; keep the anonymous statistics.

### 2.11 In-person and online divisions in one contest

- Each division has a mode. Both feed the same scoring recipe and results.
- **Same paper or separate papers** per division (Cowconuts keys each division
  separately).
- **When the online round runs** relative to the in-person one:
  - *concurrently*, on the same clock;
  - *after*, with the online window opening once the in-person papers are
    collected, so problems cannot leak;
  - *on another date* (BMT: November in person, December online).
- **Embargo:** problems are never shown anywhere until every division has
  finished.
- **Rankings separate by default.** An optional unofficial combined ranking
  carries a note that conditions differed.
- **One division per competitor.** BMT's rule; checked at registration by
  name and email.
- **Eligibility:** SFMO's 100-mile rule becomes a form rule: choosing *Online*
  requires the distance attestation. It already exists in `register_team()`.

### 2.12 Making it easy for any contest to run on MathCloud

What a small student-run contest is missing is usually not software but
experience. These features turn what SFMO, BMT and SMT have learned into
defaults.

**Starting**

- **Contest templates.** Start from a format: SFMO (Individual, Mystery, Guts),
  BMT-style (Individual, Team, Guts, Power), HMMT-style, a Cowconuts-style two
  division meet, a mini meet for grades 3–8, an Estimathon, an Integration
  Bee, a proof contest. Rounds, scoring, awards and email templates arrive
  filled in.
- **A plan worked back from the date.** Enter the contest date and get a
  timeline: open registration 10 weeks before, problems final 3 weeks before,
  waiver reminders a week before, dress rehearsal 5 days before, results
  within 48 hours. Each step links to the screen that does it.
- **Duplicate last year** with one click.

**Writing the contest**

- **Write each problem once.** It becomes the online test, a printable test
  booklet, answer sheets with competitor IDs printed on, and the graders' key.
- **Problem bank** across years, with solve rates from every time a problem
  was used, so writers can calibrate difficulty.
- **Test-solver mode:** a writer sits the paper as a student would, timed, and
  their answers check the key before the day.

**People**

- **Volunteer sign-up link** for graders and proctors, with roles assigned
  on one screen and access that expires after the contest.
- **Rehearsal sandbox:** a copy of the contest filled with simulated students
  (like the demo), so proctors and graders practise on contest week without
  touching real data.
- **Grader practice** on last year's anonymised sheets.

**Competitors and coaches**

- **One account across contests**, with a history of results and every
  certificate, and managed accounts for the youngest.
- **Device check** students run days before: browser, fullscreen, connection,
  clock, and a practice question.
- **Local time everywhere** for international teams, and the test pages in
  more than one language.
- **Accommodations:** extra time or large print per student, set by the
  director.
- **Teammate matching** for solo registrants.

**On the day**

- **Staff alerts in Discord or Slack**: a locked test, a question waiting more
  than a minute, a grader who has gone quiet.
- **Projector boards** for Guts with a freeze before the end.
- **Offline-tolerant answers:** saved locally and synced when the connection
  returns, with the gap logged.

**After**

- **Appeals window:** students ask for a regrade within 48 hours, the director
  rules, and results are re-versioned with the diff from §2.6.
- **Public results and archive** page per contest, with problems and
  solutions released once every division has finished.
- **Sponsors** on registration, results and certificates, with their coupon
  codes handed out as prizes.

**Running it as a platform**

- **Discover page:** an opt-in list of upcoming contests on MathCloud, so a new
  contest can find competitors.
- **Co-hosting:** two organisations run one contest together.
- **Fees** through Stripe Connect into the organiser's own account, fee
  waivers, refunds and a payout report. Donation pledges, as SFMO uses, for
  free contests.
- **API, webhooks, CSV in and out**, and an embeddable registration form for
  organisers with their own site.
- **Privacy controls:** export or delete a contest's personal data, and an
  automatic clean-up of minors' details after a set number of months.

---

## 3. Connecting the SFMO registration

SFMO registration opens **24 October** on the SFMO site, which is too soon for
MathCloud, and it should not wait for MathCloud. So the connection is built in
three steps, and the first changes nothing in the live registration path.

**Step 1 (this season): sync.** SFMO's Supabase sends each new or changed team
and member to MathCloud.

```
SFMO site ──register_team()──▶ SFMO Supabase ──database webhook──▶ MathCloud
                                (unchanged)      on teams,           /api/v1/contests/
                                                 team_members        sfmo-2027/ingest
```

- A Supabase **database webhook** (or a trigger using `pg_net`) on `teams` and
  `team_members` POSTs every insert and update, signed with a contest API key.
- MathCloud upserts by SFMO's own `team_code` and `competitor_id`, so `07A`
  stays `07A`. The field mapping is set once in MathCloud.
- If MathCloud is down, registration carries on and the webhook retries. The
  staff portal keeps working. A CSV import from the staff portal's existing
  export is the fallback.
- On SFMO's side: one migration and one secret. MathCloud never holds SFMO's
  service key.
- MathCloud then runs everything after registration for SFMO 2027: online
  division tests, grading, scoring, results, certificates, emails.

**Step 2 (SFMO 2028): headless.** SFMO's `RegisterPage` calls MathCloud's
registration API instead of its own RPC:
`POST /v1/contests/sfmo-2028/registrations` with a publishable key that only
works from `sfmathopen.org`. SFMO keeps its design and MathCloud holds the
data. SFMO's own Supabase project can then be retired.

**Step 3 (later): Sign in with MathCloud.** OAuth, so any contest site can show
a family their registrations. ContestDojo shipped exactly this in June 2026
(`/v1alpha1/me/events`). Not needed early.

For organisers without a site of their own: the hosted page, or an embed
snippet.

---

## 4. Design direction

ContestDojo's **structure** is right and its **finish** is not. The structure
is a sidebar of plain nouns (Organizations, Students, Teams, Tests, Settings),
dense tables with a column picker and *Download CSV*, labelled forms, and
confirmations that say what they destroy. It reads as a tool because it is
mostly tables. The finish is stock Chakra: default blue, default radii,
default shadows.

MathCloud keeps the structure and replaces the finish: **light, structured,
quietly premium, with small animations that each explain something.** The rule
is that every choice has a *because*. The mockup is annotated with them.

### Colour: blue acts, green confirms

Two accents, each with one job, so colour always means something:

| Token | Hex | Job |
| --- | --- | --- |
| `--blue` | `#1D5BD6` | **Things you can act on:** buttons, links, selection, focus, where you are |
| `--green` | `#0E8A5F` | **Things that are done:** confirmed, signed, correct, sent |
| `--amber` | `#B4690E` | Waiting on someone: pending, waiver missing |
| `--red` | `#C2362B` | Wrong or failed. Never decorative. |
| Neutrals | blue-tinted greys | Text, lines, surfaces. A slight blue tint so the greys sit with the accents rather than against them |

- **Light mode first.** Organisers work in daylight at a desk or a check-in
  table, and print what they see.
- **Status is never colour alone.** Every pip and chip has a word or a shape,
  for colour-blind graders and for black-and-white printouts.
- **No gradients, no glass, no glow.** Depth comes from 1 px hairlines and a
  single soft shadow on whatever floats (drawer, menu, dialog). Floating is the
  only thing a shadow means.

### Type

- **Instrument Sans** for the interface. It is already the face of your
  Cowconuts score reports, so the app and the PDFs it produces look like one
  product, and it is not Inter, the default that makes interfaces look
  generated.
- **IBM Plex Mono** for anything that is an identifier or a number someone
  copies: `07A`, scores, codes. Tabular figures, so columns of scores line up.
- One scale: 12 / 13 / 14 / 16 / 20 / 28. Tables are 13. Nothing is larger
  than it needs to be.

### Structure

- **Tables are the product.** 40 px rows, sticky headers, right-aligned
  numbers, keyboard navigation (`j` / `k`, `x` to select, `/` to search).
- **A side drawer, not a new page,** for a row's detail, so the table and your
  place in it stay visible.
- **A 4 px grid**, 6 px radius on controls and 10 px on panels, and the same
  values everywhere.
- **The contest's branding on public pages** (registration, results,
  certificates), MathCloud's on the tools. A family should see the contest,
  not the platform.

### Motion: small, fast, and always telling you something

| Animation | Why it exists |
| --- | --- |
| The tab underline slides to the new division | Shows where you came from |
| The row count rolls to its new number on filtering | Draws the eye to the result of the filter |
| A checkbox tick draws itself in | Confirms the click landed |
| The bulk-action bar rises from the bottom when rows are selected | It only appears when it has something to act on |
| The drawer slides in from the right, its sections following 30 ms apart | Keeps the table in view; reveals the detail in reading order |
| A waiver pip fills green with a slight pop when a signature arrives live | A change that happened while you watched gets noticed |
| "Saved" pulses once | Answers "did that save?" without a dialog |
| Buttons press to 98 % | Physical feedback on click |

120–260 ms, ease-out, no bounce, and all of it switched off under
`prefers-reduced-motion`. Nothing moves on its own except the live dot,
which breathes slowly while the page is connected.

### Words

Nouns and verbs from the contest: *Key the sheet*, *Release results*, *Freeze
roster*. Numbers in sentences: *"3 waivers missing. Send reminders."*. No
adjectives in the interface and no emoji. A destructive button names what it
destroys: *"Delete team 07, Krill Seekers, and its 4 competitors."*

---

## 5. How to build it

Decided and costed in [`STACK.md`](STACK.md): a Vite + React + TypeScript
single-page app on Cloudflare Pages, Supabase for Postgres (with row level
security), accounts, files, live updates, background jobs and encrypted
secrets, and each organiser's own Resend, SMTP or Gmail for email. About
$25 a month in contest season, close to nothing otherwise.

The interface is plain CSS on the design tokens in §4, with hand-built
components, so nothing looks like a component library. KaTeX renders maths.
The scoring engine and the email template engine are pure TypeScript with
tests; the database rules are SQL functions with their own test script.

**Data model, first sketch:**

```
organizations      id, name, slug, branding
memberships        org_id, user_id, role                 -- owner | director | staff | writer
contests           id, org_id, name, slug, dates, status, settings
divisions          id, contest_id, name, mode, eligibility, team_min, team_max, id_template
contest_roles      contest_id, user_id | grader_name, role, scope   -- grader / proctor scoped to rounds
form_fields        id, contest_id, level, label, type, choices, rules, flags
coaches_orgs       id, contest_id, name, join_code, seats                 -- coach model only
teams              id, contest_id, division_id, number, name, status, fields jsonb, external_id
competitors        id, team_id, slot, public_id ('07A'), name, grade, fields jsonb, access_code_hash
guardians          id, competitor_id, name, email
waivers            id, competitor_id, document_version, signed_name, signed_at, ip
rounds             id, contest_id, type, mode, timing, rules, integrity_policy
problems           id, round_id, division_id, number, set_no, body, answer_type, points
answer_keys        problem_id, accepted[]                -- directors only
attempts           id, round_id, competitor_id | team_id, started_at, deadline, submitted_at
responses          attempt_id, problem_id, value, saved_at, graded, correct, points
answer_rulings     problem_id, normalized_answer, correct     -- grade by distinct answer
paper_entries      round_id, sheet_id, grader, values, entered_at  -- keyed paper sheets
integrity_events   attempt_id, kind, at, duration_ms, detail
clarifications     round_id, from_competitor, question, answer, broadcast
scoring_recipes    contest_id, version, recipe jsonb
results            contest_id, version, published_at, standings jsonb
awards / prizes    contest_id, rule, prize, code_pool
certificates       id, competitor_id, award, template_id, verify_code, pdf_path
email_providers    org_id, kind, secret_ref (vault), from, daily_limit
email_templates    contest_id, trigger, subject, html, text
email_ledger       template_id, recipient, idempotency_key, status, provider_id, sent_at
audit_log          org_id, actor, action, target, before, after, at
```

---

## 6. What is built, and what is next

**Built now** (try it: see the README):

- Accounts and sign-in for every role, each seeing only what they should.
- Director: overview with a readiness checklist, roster with drawer and bulk
  actions, check-in, people and access, rounds with live answer-key editing,
  proctoring, grading, results with an editable scoring recipe, certificates
  with drag-to-place fields and verification codes, emails with templates,
  live preview and daily-limit pacing.
- Online test portal: honour code, fullscreen, one shared clock, autosave,
  Guts sets that lock behind you, a shared team sheet, integrity logging
  (tab, window, fullscreen, paste, split screen, connection, second device)
  with warn and lock policies, proctor unlock, questions and announcements.
- Grading: Cowconuts-style keypad entry with live green/red, and grading by
  distinct answer, where a fraction or decimal with the wrong value is marked
  wrong automatically and an equal value in another form waits for a ruling.
- Scoring engine: best k of n, round weights, shared places, the
  harder-problems tiebreak, award rules, problem statistics and
  rare-shared-wrong-answer detection. 19 unit tests.
- Coach portal: teams, managed student accounts, waiver reminders, results.
- Guardian waiver page from an emailed link.
- Database: `supabase/migrations/0001_core.sql`, with 37 rule checks in
  `supabase/tests/rules.sql` that pass on Postgres 16.

**Next, in order:**

1. Wire the app to Supabase (the demo store's actions map one-to-one onto the
   SQL functions), with Supabase Auth for sign-in and managed accounts.
2. The SFMO sync from §3, as a Supabase Edge Function receiving the SFMO
   database webhook.
3. Sending email for real through the organiser's provider, from a queue.
4. Certificate PDFs stamped server-side with pdf-lib, as in
   `certificatesending`.
5. A full dress rehearsal of SFMO 2027 in mid-December.

## 7. Phases, against the real calendar

| When | Phase | Target |
| --- | --- | --- |
| **Now → mid-December 2026** | **1. SFMO-shaped** | Run everything after registration for **SFMO 2027**: organisations, contests, divisions, rounds; SFMO sync; roster; grading portal (Cowconuts made general); online portal for the online division with Individual, Mystery and Guts, plus integrity logging and clarifications; the scoring recipe for SFMO's format; results; score reports; certificates; email through Resend or SMTP. Mid-December leaves time for a full dress rehearsal before a January contest. |
| **Spring 2027** | **2. Open to other contests** | Registration builder and hosted pages; guardian waiver links; coach organisations with join codes; Stripe Connect; check-in QR; prizes and code pools; public results pages; contest templates. |
| **By August 2027** | **3. SF Mini Math Meet and after** | Under-13-safe defaults (guardian registers, no child accounts); headless registration API (SFMO 2028 moves over); scanned answer sheets; proof grading at scale; Sign in with MathCloud; Google OAuth sending once verified; prize payouts. |

---

## 8. Risks, plainly

- **Scope.** This is ContestDojo plus a small Gradescope plus a small Mailchimp
  plus a certificate service. ContestDojo is years of SMT volunteers' work.
  Phase 1 has to stay SFMO-shaped, or nothing will be ready in January.
- **Online integrity is evidence, not proof.** Say so on the proctor
  dashboard, so nobody treats a flag as a verdict.
- **Children's data.** SF Mini Math Meet starts at grade 3. In the US,
  collecting personal information online from children under 13 falls under
  COPPA. The design (a guardian or coach creates a managed account, no email
  or contact details from the child, minimal fields, deletion after the
  contest) is built to keep MathCloud on the right side of it. As with the SFMO waiver, have an adult with legal
  knowledge review it before it carries real data.
- **Email limits are low on free plans.** 100 a day on both Resend free and
  the Gmail relay. The pacing in §2.8 handles this; organisers should still
  know it in advance.
- **Money.** With Stripe Connect, MathCloud becomes a payments platform, with
  refunds and disputes to handle. Free and pledge contests come first.

---

## 9. Questions for you

1. **Other contests:** free forever, free for nonprofits, or paid? This
   decides whether Stripe Connect and a paid Supabase tier are needed year
   round.
2. **SFMO 2027 date and Zoom rooms:** how many proctors do you have? Rooms of
   four teams need one proctor each.
3. **A domain:** `mathcloud.org`, `mathcloud.app`, or under
   `sfmathopen.org` for now?
4. **Mystery Dive:** what format is it this year? The portal needs to support
   it before the rehearsal.
