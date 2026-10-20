# Putting MathCloud online (GitHub Pages + Supabase)

This takes about 20 minutes the first time. At the end you have:

- the site at `https://<your-github-name>.github.io/mathcloud/`, rebuilt every time this branch changes;
- a Supabase project holding the real data (accounts, teams, answers, results), with the database rules that decide who sees what;
- the SFMO demo loaded in it, with demo accounts for each role, so you can test straight away.

Both are free for testing. Nothing here needs a credit card.

---

## How the pieces fit

```
 browser ──► GitHub Pages            the app itself: HTML, JS, CSS (static files)
    │
    └──────► Supabase
               ├─ Auth               sign-in (email + password, or a username for students)
               ├─ Postgres + rules   every table, with row level security
               ├─ Realtime           live updates: answers, the Guts board, questions
               └─ Edge functions     send-email (score reports, reminders) and accounts (student logins, staff)
```

The site only ever holds the **anon key**, which is meant to be public: the database rules decide what each
signed-in person can read and write. The **service role key** bypasses those rules, so it lives only in GitHub
secrets and inside Supabase, never in the site.

---

## 1. Make the Supabase project

1. Go to <https://supabase.com>, sign in with GitHub, **New project**.
2. Name it `mathcloud`, choose a strong **database password** and keep it (you need it in step 3),
   pick the region nearest your contest (e.g. West US for San Francisco). Free plan.
3. Wait a minute for it to start. Then open **Project Settings → API** and note:
   - **Project URL**: `https://abcdefghijkl.supabase.co`. The part before `.supabase.co` is the **project ref**.
   - **anon public** key.
   - **service_role** key (secret).
4. Make an access token for GitHub to use: your avatar (top right) → **Account preferences → Access Tokens →
   Generate new token**. Copy it now, it is shown once.

### Auth settings (Authentication in the Supabase sidebar)

- **Sign In / Providers → Email**: for testing, turn **Confirm email** off, so new accounts can sign in at once.
  (Supabase's built-in mailer only sends a few emails an hour; turn confirmations back on once you add your own SMTP
  under **Emails → SMTP settings**.)
- **URL Configuration**: set **Site URL** to `https://<your-github-name>.github.io/mathcloud/` and add the same
  address followed by `**` to **Redirect URLs**. Password-reset links come back here.

## 2. Tell GitHub about it

In the GitHub repository: **Settings → Secrets and variables → Actions**.

**Secrets** tab, **New repository secret**, one for each:

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | the access token from step 1.4 |
| `SUPABASE_DB_PASSWORD` | the database password from step 1.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |

**Variables** tab, **New repository variable**, one for each:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | `abcdefghijkl` |
| `SUPABASE_URL` | `https://abcdefghijkl.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon public key |
| `SHOW_DEMO_ACCOUNTS` | `true` while testing (lists the demo logins on the sign-in page); delete it before the real contest |
| `DEMO_PASSWORD` | optional; the password of every demo account (default `mathcloud-demo`) |

## 3. Set up the database

**Actions** tab → **Set up Supabase** (left list) → **Run workflow**. Choose which moment of the demo to load:

| Choice | What you get |
|---|---|
| `before` | the week before: registration open, waivers coming in |
| `morning` | contest morning: the Individual round open |
| `guts` | Guts is live and the board is moving |
| `after` | everything handed in: grade, publish, send score reports |
| `none` | tables and functions only, no demo |

It creates every table, rule and function (`supabase/migrations`), deploys the two edge functions
(`supabase/functions`) and, unless you chose `none`, loads the demo. Run it again whenever you want a fresh demo
or a different moment; it replaces only the demo organisation, never anything else.

## 4. Turn on GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions** tab → **Deploy site** → **Run workflow** (after this, every push to the branch redeploys by itself).
3. When it finishes (about 2 minutes) the address is on the workflow run and under **Settings → Pages**.

If the run fails at "deploy" with a message about environment protection: **Settings → Environments →
github-pages → Deployment branches** and allow this branch.

## 5. Try it

Open the site and sign in with any of these (password `mathcloud-demo` unless you changed `DEMO_PASSWORD`):

| Sign in as | Login | Sees |
|---|---|---|
| Organiser | `director@mathcloud.test` | everything in SFMO 2027 |
| Grader | `grader@mathcloud.test` | keys paper sheets, rules on answers |
| Proctor | `proctor@mathcloud.test` | one Zoom room on the day |
| Coach | `coach@mathcloud.test` | their two teams |
| Online student | `student@mathcloud.test` | Carter Hughes, team 16, online |
| Online student (username) | `sfmo-16b` | Valeria Ruiz, no email of her own |
| In-person student (username) | `sfmo-05a` | Hannah Kim, team 05, in person |

Anyone can also **Create an account** and start their own organisation and contest; the demo is untouched.

Testing a live round: sign in as the organiser in one window and a student in another (a private window keeps
the sessions apart). Open the round in **Rounds**, take it as the student, watch it arrive in **Live** and **Grading**.

## 6. Email: score reports and reminders

Emails go out through [Resend](https://resend.com) using keys you add in the app, under **Email → Sending keys**.

1. Make a Resend account, **API Keys → Create API key** (sending access).
2. In MathCloud: **Email → Sending keys → Add key**: a label, the from address, the daily limit (`100` on Resend's
   free plan) and the key. The key is stored where only the email function can read it; the app never shows it again.
3. Until you verify a domain in Resend (**Domains**), Resend only delivers to your own address, from
   `onboarding@resend.dev`. That is enough to test. For the contest, verify your domain and use e.g.
   `results@sfmathopen.org` as the from address.

**More than 100 a day:** add a second key (from a second Resend account) and the app uses both: each key sends up to
its own limit, then the next takes over. Two keys, 200 a day; three, 300. Whatever does not fit today stays queued;
**Email → Log → Send queued now** sends it the next day. Keys that Resend rejects are switched off and marked with
the reason.

## 7. Staying inside the free plans

Free limits at the time of writing (check the pricing pages before the contest):

| | Free plan | MathCloud for SFMO (≈ 80 teams, 300 students) |
|---|---|---|
| Supabase database | 500 MB | a few MB |
| Supabase egress | 5 GB / month | well under 1 GB: each screen loads only the open contest, in about 15 small requests |
| Supabase realtime | 200 connections at once, 2 M messages / month | **one connection per open tab**: see below |
| Edge functions | 500 000 calls / month | a few hundred |
| GitHub Pages | 100 GB / month bandwidth | tiny; each screen downloads only its own code |
| Resend | 100 emails / day per account | add keys, see step 6 |

What the app does to keep usage low:

- it loads only the contest you are looking at, never every contest;
- live changes arrive as single rows over one realtime channel per contest, not by re-downloading;
- typing is saved after a short pause, not on every key; imports go in batches of 50 teams;
- students' Guts board comes from one small database call every 15 seconds while Guts is open, only while the tab is visible;
- a tab that was hidden for over 3 minutes catches up once when it comes back;
- the site is split by screen, so a student never downloads the organiser screens.

**The one limit to plan for is realtime connections.** If more than about 180 people will have MathCloud open at the
same moment (every online student plus staff), upgrade the project to Supabase Pro for the contest month
(about $25), then back to Free. In-person students only need it to see results, so they do not count on the day.

**Free projects pause after a week with no use, so the repository pings it.** The **Keep Supabase awake** workflow
(`.github/workflows/keep-alive.yml`) reads one row every third day, which counts as use. It needs nothing beyond the
`SUPABASE_URL` and `SUPABASE_ANON_KEY` variables from step 2. Check it once: **Actions → Keep Supabase awake → Run
workflow**; a green tick and "awake" in the log means it works. GitHub switches off scheduled workflows after 60 days
without a commit (it emails first); one click on **Enable workflow** turns it back on. If a project does pause, restore
it from the Supabase dashboard with one click, data intact.

## 8. Working on it locally

```bash
npm install
npm run dev                      # the in-browser sandbox: no Supabase needed, demo accounts in the account menu
```

Against your Supabase project, make `.env.local` (git ignores it):

```
VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SHOW_DEMO_ACCOUNTS=true
```

Checks: `npm test` (scoring and import logic), `npx tsc -b` (types), `./scripts/test-db.sh` (database rules, needs
Postgres; see the script).

## Troubleshooting

| You see | Do |
|---|---|
| The site is the sandbox ("Sandbox" in the account menu) | `SUPABASE_URL` / `SUPABASE_ANON_KEY` variables are missing; add them and rerun **Deploy site** |
| Blank page or 404 on a link | the site expects to live at `/<repository name>/`; with a custom domain, set the build's `VITE_BASE` to `/` in `.github/workflows/pages.yml` |
| "Invalid login credentials" for demo accounts | run **Set up Supabase** with a demo moment; check `DEMO_PASSWORD` |
| Sign-up says to confirm the email | turn off **Confirm email** (step 1) or set up SMTP |
| "Set up Supabase" fails at link / db push | wrong `SUPABASE_DB_PASSWORD` or `SUPABASE_PROJECT_REF`; reset the password under Project Settings → Database |
| Emails stay "queued" | no active key, or every key used its limit today; see **Email → Sending keys** |
| Project paused | Supabase dashboard → the project → **Restore**; then check **Keep Supabase awake** is enabled under Actions |
