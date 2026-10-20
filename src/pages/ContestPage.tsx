import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../styles/public.css';
import type { Contest, DivisionMode, Round } from '../lib/model';
import { fetchPublicContest } from '../lib/public';
import { contestInitials, useUser } from '../lib/session';
import { REMOTE, useAllDB } from '../lib/store';
import { clockIn, roundState } from '../lib/time';
import { TopBar } from '../layouts/StaffLayout';
import { ArtEmpty } from '../components/art';
import { Icon } from '../components/icons';
import { ModeChip, Segmented, useNow } from '../components/ui';
import { PublicFooter, PublicTop } from './Landing';

type Loaded = { contest: Contest | null; orgName: string | null; error: string | null; twin?: { slug: string; mode: string } | null };

const KIND: Record<Round['kind'], string> = {
  individual: 'Each student on their own',
  team: 'The team works together on one paper',
  guts: 'Sets of problems against the clock, on a live board',
};

/** A contest's public page: when, where, how it runs, and the way to register. Anyone can open it. */
export function ContestPage() {
  const { slug = '' } = useParams();
  const all = useAllDB();
  const user = useUser();
  const cached = all.contests.find((c) => c.slug === slug) ?? null;
  const [fetched, setFetched] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!REMOTE || cached) return;
    let live = true;
    setFetched(null);
    void fetchPublicContest(slug).then((r) => live && setFetched(r));
    return () => {
      live = false;
    };
  }, [slug, cached]);

  const contest = cached ?? fetched?.contest ?? null;
  const orgName = (contest && all.orgs.find((o) => o.id === contest.orgId)?.name) || fetched?.orgName || null;
  const loading = REMOTE && !cached && !fetched;
  // Organisers always see their own page, public or not.
  const staffView = !!user && ['director', 'staff'].includes(user.role) && !!cached;

  return (
    <div className="pub">
      {user ? <TopBar /> : <PublicTop nav={false} />}
      <main className="lp-wrap cp">
        {loading ? (
          <p className="muted row" style={{ padding: '60px 0' }}><span className="spinner" />Loading the contest</p>
        ) : !contest ? (
          <div className="card cp-missing">
            <ArtEmpty kind="search" />
            <h1 className="page-title">No contest at this address</h1>
            <p className="soft">{fetched?.error ?? 'The link may be mistyped, or the organisers may have moved the page. Ask them for the current link.'}</p>
            <div><Link className="btn" to="/">MathCloud home</Link></div>
          </div>
        ) : (
          contest.details?.public === false && !staffView ? (
            <div className="card cp-missing">
              <ArtEmpty kind="search" />
              <h1 className="page-title">This event page is private</h1>
              <p className="soft">The organisers have not made this page public. If you are taking part, they will send you everything you need.</p>
              <div><Link className="btn" to="/">MathCloud home</Link></div>
            </div>
          ) : (
            <ContestBody contest={contest} orgName={orgName} remoteTwin={fetched?.twin} />
          )
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

function ContestBody({ contest, orgName, remoteTwin }: { contest: Contest; orgName: string | null; remoteTwin?: { slug: string; mode: string } | null }) {
  const now = useNow(15000);
  const modes = contest.divisions.map((d) => d.mode);
  const both = modes.includes('in_person') && modes.includes('online');
  const [view, setView] = useState<'all' | DivisionMode>('all');
  const reg = contest.registration;
  const all = useAllDB();
  const twin = contest.linkedId ? all.contests.find((c) => c.id === contest.linkedId) : undefined;
  const twinMode = twin?.divisions[0]?.mode;
  const organisersOnly = reg.coaches === false;
  const guts = contest.rounds.find((r) => r.kind === 'guts' && roundState(r, now) === 'open');
  const details = contest.details ?? {};
  const faq = (details.faq ?? []).filter((f) => f.q.trim() && f.a.trim());
  const website = details.website && /^https?:\/\//i.test(details.website) ? details.website : details.website ? `https://${details.website}` : '';
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const otherZone = local !== contest.timeZone;
  const localClock = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: local }).format(new Date(iso));

  const agenda = contest.agenda.length
    ? contest.agenda.filter((a) => view === 'all' || a.modes.includes(view))
    : contest.rounds.map((r) => ({ id: r.id, at: r.startsAt, title: r.name, roundId: r.id, modes: modes, where: undefined as string | undefined, note: undefined as string | undefined }));
  const roundOf = (id?: string) => contest.rounds.find((r) => r.id === id);

  return (
    <div className="stack-lg">
      <section className="cp-hero">
        <div className="cp-hero-main">
          <span className="tile cp-tile">{contestInitials(contest.short)}</span>
          <div className="stack" style={{ gap: 6 }}>
            {orgName && <span className="label">{orgName}</span>}
            <h1 className="page-title">{contest.name}</h1>
            <p className="cp-meta">
              <span className="row" style={{ gap: 6 }}><Icon name="calendar" size={15} />{contest.dateLabel}</span>
              {contest.divisions.map((d) => <ModeChip key={d.id} mode={d.mode} />)}
              {twin && twinMode && (
                <Link className="cp-twin" to={`/c/${twin.slug}`}>
                  Also {twinMode === 'online' ? 'online' : 'in person'}, at the same time<Icon name="arrow-up-right" size={13} />
                </Link>
              )}
              {!twin && remoteTwin && (
                <Link className="cp-twin" to={`/c/${remoteTwin.slug}`}>
                  Also {remoteTwin.mode === 'online' ? 'online' : 'in person'}, at the same time<Icon name="arrow-up-right" size={13} />
                </Link>
              )}
            </p>
          </div>
        </div>
        <div className="cp-hero-side">
          {guts && details.publicBoard !== false && (
            <Link className="live-pill" to={`/c/${contest.slug}/board`}>Guts is live: follow the leaderboard<Icon name="arrow-up-right" size={14} /></Link>
          )}
          {organisersOnly ? (
            <span className="cp-reg">Teams are entered by the organisers. Students get their sign-in details before the contest.</span>
          ) : reg.open ? (
            <>
              <span className="cp-reg ok">Registration open{reg.closesLabel ? `, closes ${reg.closesLabel}` : ''}</span>
              <Link className="btn btn-primary btn-lg" to={`/register/${contest.slug}`}>Register a team<Icon name="arrow" /></Link>
              <span className="small muted">Teams of {reg.teamMin === reg.teamMax ? reg.teamMax : `${reg.teamMin} to ${reg.teamMax}`} students</span>
            </>
          ) : (
            <span className="cp-reg">{contest.resultsPublished ? 'Results are out. Students and coaches see them after signing in.' : 'Registration is closed.'}</span>
          )}
        </div>
      </section>

      {details.about?.trim() && <p className="cp-about">{details.about.trim()}</p>}

      <div className="cp-grid">
        <div className="stack-lg">
        <section className="card flush">
          <div className="card-head">
            <h2><Icon name="calendar" size={16} />Schedule</h2>
            {both && contest.agenda.length > 0 && (
              <Segmented label="Show the schedule for" value={view} onChange={setView} items={[{ key: 'all', label: 'Both' }, { key: 'in_person', label: 'In person' }, { key: 'online', label: 'Online' }]} />
            )}
          </div>
          <p className="cp-zone small muted">
            Times in {contest.timeZone.split('/').pop()!.replace(/_/g, ' ')} time{otherZone ? <>, with yours ({local.split('/').pop()!.replace(/_/g, ' ')}) underneath</> : ''}. Online and in-person rounds start at the same moment.
          </p>
          <ol className="cp-sched">
            {agenda.map((a) => {
              const r = roundOf(a.roundId);
              const mystery = r?.mystery && roundState(r, now) === 'scheduled';
              return (
                <li key={a.id} className={r ? 'round' : ''}>
                  <time>
                    {clockIn(a.at, contest.timeZone)}
                    {otherZone && <small>{localClock(a.at)} yours</small>}
                  </time>
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="row wrap" style={{ gap: 8 }}>
                      <b>{a.title}</b>
                      {r && <span className="small muted">{mystery ? 'Format announced when it starts' : `${r.minutes} min`}</span>}
                    </span>
                    {a.note && <span className="small soft">{a.note}</span>}
                    {a.where && <span className="small muted">{a.where === 'room' ? 'Your team’s room' : a.where === 'hall' ? contest.venue?.hall || 'Main hall' : a.where}</span>}
                  </div>
                  {both && a.modes.length === 1 && <ModeChip mode={a.modes[0]} />}
                </li>
              );
            })}
            {agenda.length === 0 && <li><span /><span className="muted">The schedule has not been published yet.</span></li>}
          </ol>
        </section>

        {faq.length > 0 && (
          <section className="card">
            <div className="section-head"><h2><Icon name="help" size={16} />Questions</h2></div>
            <div className="cp-faq">
              {faq.map((f, i) => (
                <details key={i} open={i === 0}>
                  <summary>{f.q}</summary>
                  <p className="soft">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
        </div>

        <div className="stack-lg">
          <section className="card">
            <div className="section-head"><h2><Icon name="pin" size={16} />Where</h2></div>
            <div className="stack">
              {contest.divisions.map((d) => (
                <div key={d.id} className="cp-where">
                  <ModeChip mode={d.mode}>{d.name}</ModeChip>
                  {d.mode === 'in_person' ? (
                    <div className="small">
                      <b>{contest.venue?.name || 'Venue to be announced'}</b>
                      {contest.venue?.address && <span className="soft"> · {contest.venue.address}</span>}
                      {d.detail && !contest.venue?.address?.includes(d.detail) && <p className="muted">{d.detail}</p>}
                    </div>
                  ) : (
                    <div className="small">
                      <b>At home, on Zoom</b>
                      <p className="muted">{d.detail || 'Each student takes the rounds in the browser with their camera on in a proctored Zoom room.'}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="section-head"><h2><Icon name="rounds" size={16} />Rounds</h2><span className="label">{contest.rounds.length}</span></div>
            <ul className="cp-rounds">
              {contest.rounds.map((r) => {
                const hidden = r.mystery && roundState(r, now) === 'scheduled';
                return (
                  <li key={r.id}>
                    <b>{r.name}</b>
                    <span className="small soft">{hidden ? 'A mystery round: its format is revealed when it starts.' : `${KIND[r.kind]}. ${r.minutes} minutes.`}</span>
                  </li>
                );
              })}
              {contest.rounds.length === 0 && <li className="muted small">Rounds will be announced.</li>}
            </ul>
          </section>

          {(details.contactEmail || website) && (
            <section className="card">
              <div className="section-head"><h2><Icon name="mail" size={16} />Contact</h2></div>
              <div className="stack" style={{ gap: 8 }}>
                {details.contactEmail && <a className="row small" style={{ gap: 8 }} href={`mailto:${details.contactEmail}`}><Icon name="mail" size={14} />{details.contactEmail}</a>}
                {website && <a className="row small" style={{ gap: 8 }} href={website} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />{website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</a>}
              </div>
            </section>
          )}

          {contest.venue && contest.venue.bring.length > 0 && modes.includes('in_person') && (
            <section className="card">
              <div className="section-head"><h2><Icon name="checklist" size={16} />Bring</h2><ModeChip mode="in_person" /></div>
              <ul className="bring">{contest.venue.bring.map((b) => <li key={b}>{b}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
