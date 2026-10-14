# MathCloud

Run a math contest end to end: registration, the roster, online tests on Zoom
or paper grading in the room, scoring and rankings, results, certificates and
email. Each organisation's contests are private to it. SFMO 2027 is the first
contest it runs.

## Try it

**Online, with real accounts:** follow [docs/DEPLOY.md](docs/DEPLOY.md) to put it on GitHub Pages with a
free Supabase project. The setup workflow loads the SFMO 2027 demo with one account per role
(`director@mathcloud.test`, `grader@`, `proctor@`, `coach@`, `student@`, and the usernames `sfmo-16b`,
`sfmo-05a`; password `mathcloud-demo`).

**On your machine, no setup:**

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Supabase settings the app runs as a sandbox in the browser: the same SFMO 2027 demo, kept in
local storage and synced between tabs. Sign in with any demo account on the sign-in page; the account
menu (top right) switches people and jumps between four moments of the contest: *the week before*,
*contest morning*, *Guts is live*, *after the contest*.

| Account | What to try |
| --- | --- |
| **Organiser** Jordan Lee | *Teams*: open a team and edit anything. *People → ID check*: duplicates and broken IDs, with fixes. *Import*: teams, students, problems or paper answers from a CSV, with duplicate handling. *Waivers*: remind everyone missing. *Reports*: score reports, printed or emailed |
| **Grader** Sam Ortega | Key a Guts set: Guts, type `05`, Enter, then the four answers. It lands on the board |
| **Proctor** Priya Nand | Watch Zoom Room 1 live, answer questions, unlock a locked test |
| **Coach** Megan Hughes | Edit the roster, chase waivers, make student logins, switch in person or online |
| **Student** Carter Hughes | Online: device check, the day in his own time zone, tests in the browser, Guts with the live board |
| **Student** Hannah Kim | In person: a pass with her ID and room, the day with a place for every line |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Scoring and email-template tests |
| `npm run build` | Type-check and build to `dist/` |
| `npm run build:demo` | Self-contained sandbox build in `dist-demo/` |
| `npm run seed` | Loads the demo and demo accounts into a Supabase project (see docs/DEPLOY.md) |
| `./scripts/test-db.sh` | Runs the Supabase schema and its 98 rule checks on a throwaway Postgres |

## Where things live

```
src/
  lib/model.ts          the domain types; they mirror the SQL tables
  lib/scoring/          scoring engine and answer grading, with tests
  lib/actions.ts        every change the app makes, with the same rules as the SQL functions
  lib/store.ts          the in-memory database: the sandbox copy, or a cache of the open contest from Supabase
  lib/remote/           Supabase: loading a contest, live updates, writes
  lib/demo/             SFMO 2027 demo data, problems, simulated competitors
  lib/templates.ts      email templates: {{fields}}, {{#if}}, {{#each}}
  pages/staff/          director, grader and proctor screens
  pages/student/        student home and the test portal
  pages/coach/          coach portal
  pages/BoardPage.tsx   the projector scoreboard
  pages/Register.tsx    the registration form: in person or online first
  pages/staff/Import.tsx   imports: teams, students, problems, paper answers, with duplicate checks
  lib/csv.ts            reading a CSV of teams, with tests
  styles/app.css        design tokens and every component style
supabase/
  migrations/           the real schema: tables, row level security, functions
  functions/            edge functions: send-email (the key pool), accounts (student logins, staff)
  tests/                rule checks for each role
docs/
  DEPLOY.md             putting it online: GitHub Pages + Supabase, step by step
  PROPOSAL.md           what it does, decisions, what is built and next
  STACK.md              database, hosting and costs
  RESEARCH.md           ContestDojo taken apart, your existing tools
  mockups/roster.html   the first design mockup
```
