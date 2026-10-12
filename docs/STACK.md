# Stack, hosting and cost

What MathCloud runs on, why, and what it costs. Prices checked 12 October 2026.

---

## The decision

| Part | Choice |
| --- | --- |
| App | **Vite + React + TypeScript**, a single-page app |
| Database, accounts, files, live updates | **Supabase** (Postgres with row level security, Auth, Storage, Realtime, Edge Functions, Queues, Cron, Vault) |
| Hosting | **Cloudflare Pages** |
| Email | Each organiser's own provider (Resend, SMTP or the Gmail relay), sent from Supabase Edge Functions. MathCloud's own account emails go through one Resend account on MathCloud's domain. |
| Zoom | Meeting links per proctor room. First pasted in by hand, later created through the organiser's own Zoom app (see below). |
| Payments (later) | Stripe Connect, paid into each organiser's own Stripe account |

### Why a single-page app, not Next.js

The first proposal said Next.js. A plain single-page app is the better fit:

- **There is no server to run or pay for.** Everything server-side happens in
  Postgres functions and Supabase Edge Functions, which is how SFMO and
  Cowconuts already work.
- **It builds to static files**, so it can be hosted for free, and every branch
  gets its own preview URL.
- **The whole app can run in a demo mode with no backend.** That is how the
  demo you can try right now works, and it doubles as a sandbox where
  organisers rehearse a contest without touching real data.
- **Cost:** public pages (registration, results) are less visible to search
  engines. If that matters, the few public routes can be pre-rendered, as SFMO
  does.

### Why Supabase

- **Privacy enforced in Postgres.** Every table carries `org_id` and
  `contest_id`, and row level security decides who reads each row. A grader's
  session cannot see guardians' emails, whatever the UI does.
- **Timing the client cannot cheat.** `start_attempt()` and `save_response()`
  are Postgres functions that compare against the database clock. A save after
  the deadline is refused by the database, not just hidden by the page.
- **Accounts for everyone** (directors, staff, graders, proctors, coaches,
  students, guardians) through Supabase Auth: email and password, magic links,
  Google sign-in. Students too young for their own email get **managed
  accounts**: a coach or guardian creates one, and the student signs in with a
  username and password. No email is collected from the child.
- **One vendor** for the database, files, live updates and background jobs,
  which you already know from SFMO.

### Why Cloudflare Pages

Free plan: 500 builds a month, 20,000 files, custom domains, and no stated
bandwidth cap on static files. Commercial use is allowed, unlike Vercel's free
tier. GitHub Pages also works, but needs SFMO's per-route HTML workaround for
deep links. Cloudflare serves single-page apps directly.

---

## Supabase limits that matter on contest day

From [supabase.com/pricing](https://supabase.com/pricing):

| | Free | Pro ($25/month) |
| --- | --- | --- |
| Database | 500 MB | 8 GB |
| Monthly active users | 50,000 | 100,000 |
| File storage | 1 GB | 100 GB |
| Egress | 5 GB | 250 GB |
| **Realtime, concurrent connections** | **200** | **500** |
| Realtime messages / month | 2 million | 5 million |
| Edge Function calls / month | 500,000 | 2 million |
| Pausing | after 1 week idle | never |
| **Backups** | **none** | **daily, kept 7 days** |

Two consequences:

1. **Competitors don't hold a live connection.** 150 online students, each
   with a socket open, would use most of the free plan's 200. Students' pages
   save through ordinary requests and check for clarifications every 15
   seconds. Live connections are kept for staff screens: the proctor dashboard,
   the grading room and projector boards.
2. **Run Pro from the month before a contest until results are out.** For the
   backups alone: a contest's answers are not something to lose. Pause it
   again afterwards if you like.

**SFMO 2027 sizing:** about 200 competitors. 200 × (20 + 24 + mystery)
answers, each saved a few times, comes to roughly 50,000 small writes over a
day. That is nothing for Postgres.

---

## Zoom proctoring

1. **Now:** the director creates the meetings in Zoom and pastes one link per
   proctor room. MathCloud assigns teams to rooms, shows each student their
   link when the test opens, and lists who is in which room on the proctor
   dashboard.
2. **Next:** the organiser creates a **Server-to-Server OAuth app in their own
   Zoom account** and pastes its three credentials into MathCloud, the same way
   they paste a Resend key. MathCloud then creates the meetings itself: one per
   room, waiting room on, named after the round. Because the app lives in the
   organiser's own account, nothing needs Zoom's Marketplace review.
   (Third-party docs note that Zoom renamed some write scopes in 2026, so check
   the scope names when building this.)

---

## What it costs

| Item | Cost |
| --- | --- |
| Cloudflare Pages | $0 |
| Supabase | $0 while building; **$25 a month** in contest season |
| Domain (e.g. `mathcloud.org`) | about $10–20 a year |
| MathCloud's own email (Resend free) | $0 up to 3,000 a month |
| Organisers' email, Zoom, Stripe | paid by each organiser, in their own accounts |

**About $25 a month during the season, and close to nothing otherwise.**

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173, demo mode, no backend needed
npm test           # scoring engine tests
npm run build      # static files in dist/
```

Connecting a real Supabase project: create a project, run
`supabase/migrations/*.sql` in the SQL editor, then set `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY`. Wiring the app to it is the next piece of work
(see `PROPOSAL.md` §6).
