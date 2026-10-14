// Sends queued email through the organisation's pool of provider keys.
//
// Each key has its own daily limit (Resend's free plan: 100 a day). This
// works through the contest's queue oldest first, giving each key as many
// messages as it has left today, in batches of up to 100 per request. A key
// the provider rejects is switched off with the reason, and the next key
// takes over. Whatever does not fit today stays queued for the next send.
//
// Called by the app with the signed-in organiser's token; no external
// imports, so it deploys anywhere Deno runs.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY;
const RESEND = Deno.env.get('RESEND_API_BASE') ?? 'https://api.resend.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

type Key = { id: string; label: string; from_address: string; daily_limit: number; secret?: string; sentToday?: number };
type Msg = { id: number; recipient: string; subject: string | null; html: string | null };

/** PostgREST as the service role (bypasses row level security: this function makes its own checks). */
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Is the caller on this contest's staff? Asked as the caller, so the database decides. */
async function isStaff(auth: string, contestId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/contest_staff`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ p_contest: contestId }),
  });
  return res.ok && (await res.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const { contest_id: contestId } = await req.json();
    if (!contestId || !(await isStaff(auth, contestId))) return json({ error: 'Only the organisers can send email for this contest.' }, 403);

    const [contest] = await rest(`contests?id=eq.${contestId}&select=org_id`);
    const keys: Key[] = await rest(`email_keys?org_id=eq.${contest.org_id}&active=eq.true&select=id,label,from_address,daily_limit&order=created_at`);
    if (!keys.length) return json({ sent: 0, waiting: await queuedCount(contestId), error: 'Add a sending key first (Email, Sending keys).' });
    const secrets: { key_id: string; secret: string }[] = await rest(`email_key_secrets?key_id=in.(${keys.map((k) => k.id).join(',')})&select=key_id,secret`);
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString();
    for (const k of keys) {
      k.secret = secrets.find((s) => s.key_id === k.id)?.secret;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/email_sends?key_id=eq.${k.id}&status=eq.sent&sent_at=gte.${since}&select=id`, {
        method: 'HEAD',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
      });
      k.sentToday = Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
    }

    const capacity = keys.reduce((n, k) => n + Math.max(0, k.daily_limit - (k.sentToday ?? 0)), 0);
    const queue: Msg[] = capacity
      ? await rest(`email_sends?contest_id=eq.${contestId}&status=eq.queued&select=id,recipient,subject,html&order=queued_at&limit=${capacity}`)
      : [];

    let sent = 0;
    const problems: string[] = [];
    for (const k of keys) {
      if (!k.secret) continue;
      let room = k.daily_limit - (k.sentToday ?? 0);
      while (room > 0 && queue.length) {
        const batch = queue.splice(0, Math.min(100, room));
        const res = await fetch(`${RESEND}/emails/batch`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${k.secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(batch.map((m) => ({ from: k.from_address, to: [m.recipient], subject: m.subject ?? '', html: m.html ?? '' }))),
        });
        if (!res.ok) {
          const reason = `${res.status}: ${(await res.text()).slice(0, 300)}`;
          problems.push(`${k.label}: ${reason}`);
          queue.unshift(...batch);
          // A rejected key (bad, revoked, unverified domain) is switched off so it is not tried on every send.
          if (res.status === 401 || res.status === 403 || res.status === 422) {
            await rest(`email_keys?id=eq.${k.id}`, { method: 'PATCH', body: JSON.stringify({ active: false, last_error: reason }), headers: { Prefer: 'return=minimal' } });
          } else {
            await rest(`email_keys?id=eq.${k.id}`, { method: 'PATCH', body: JSON.stringify({ last_error: reason }), headers: { Prefer: 'return=minimal' } });
          }
          break;
        }
        await rest(`email_sends?id=in.(${batch.map((m) => m.id).join(',')})`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), key_id: k.id, error: null }),
          headers: { Prefer: 'return=minimal' },
        });
        sent += batch.length;
        room -= batch.length;
        k.sentToday = (k.sentToday ?? 0) + batch.length;
      }
    }

    return json({
      sent,
      waiting: await queuedCount(contestId),
      keys: keys.map((k) => ({ label: k.label, sentToday: k.sentToday, limit: k.daily_limit })),
      error: problems.length ? problems.join('; ') : null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function queuedCount(contestId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/email_sends?contest_id=eq.${contestId}&status=eq.queued&select=id`, {
    method: 'HEAD',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
  });
  return Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
}
