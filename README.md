# MathCloud

Run a math contest end to end: registration, the roster, online tests on Zoom
or paper grading in the room, scoring and rankings, results, certificates and
email. Each organisation's contests are private to it. SFMO 2027 is the first
contest it runs.

## Try it

```bash
npm install
npm run dev          # http://localhost:5173
```

The app opens on a demo of SFMO 2027 with invented teams. Pick an account
(every password is `demo`):

| Account | What to try |
| --- | --- |
| **Director** Jordan Lee | Live → *Show on projector* for the Guts board; roster, grading, results, certificates, email |
| **Grader** Sam Ortega | Key a Guts set: Guts, type `05`, Enter, then the four answers. It lands on the board |
| **Proctor** Priya Nand | Watch Zoom Room 1 live, answer questions, unlock a locked test |
| **Coach** Megan Hughes | Add a student with a managed account, chase a waiver |
| **Student** Carter Hughes | Take Guts online with the live scoreboard beside the questions |
| **Student** Hannah Kim | An in-person competitor signing in with a username |

The demo opens with **Guts under way**: the other teams hand in sets on their
own, so the board moves while you watch. **Open two tabs** (student in one,
the board or the proctor in the other): sets, flags and questions show up in
both as they happen. The **Demo** menu switches accounts and jumps between
three moments: *contest morning* (the Individual round just opened), *Guts is
live*, and *after the contest* (grading and results).

Everything runs in the browser; nothing is sent anywhere.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Scoring and email-template tests |
| `npm run build` | Type-check and build to `dist/` |
| `npm run build:demo` | Self-contained build (relative paths, hash routes) in `dist-demo/` |
| `./scripts/test-db.sh` | Runs the Supabase schema and its 37 rule checks on a throwaway Postgres |

## Where things live

```
src/
  lib/model.ts          the domain types; they mirror the SQL tables
  lib/scoring/          scoring engine and answer grading, with tests
  lib/actions.ts        every change the app makes, with the same rules as the SQL functions
  lib/store.ts          the demo's in-browser database, synced across tabs
  lib/demo/             SFMO 2027 demo data, problems, simulated competitors
  lib/templates.ts      email templates: {{fields}}, {{#if}}, {{#each}}
  pages/staff/          director, grader and proctor screens
  pages/student/        student home and the test portal
  pages/coach/          coach portal
  pages/BoardPage.tsx   the projector scoreboard
  styles/app.css        design tokens and every component style
supabase/
  migrations/           the real schema: tables, row level security, functions
  tests/                rule checks for each role
docs/
  PROPOSAL.md           what it does, decisions, what is built and next
  STACK.md              database, hosting and costs
  RESEARCH.md           ContestDojo taken apart, your existing tools
  mockups/roster.html   the first design mockup
```
