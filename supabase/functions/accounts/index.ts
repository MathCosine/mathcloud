// Sign-ins for students who have no email of their own.
//
// A coach (or an organiser) asks for logins for a team; each student
// without one gets a username like sfmo-05a and a short password, shown
// once to whoever asked, to hand out. Making accounts needs the service
// role, which is why this runs here and not in the browser.
//
//   { action: 'student_logins', team_id }
//   { action: 'reset_password', competitor_id }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY;
const STUDENT_DOMAIN = 'students.mathcloud.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const service = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

/** Read as the caller: if row level security lets them see the team, they are its coach or an organiser. */
async function asCaller(auth: string, path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  return res.ok ? res.json() : [];
}

const WORDS = ['maple', 'river', 'comet', 'prism', 'cedar', 'orbit', 'tulip', 'delta', 'ember', 'harbor', 'lunar', 'pixel', 'quartz', 'sable', 'tidal', 'vivid', 'willow', 'zephyr', 'atlas', 'bloom'];
function password() {
  const b = new Uint32Array(3);
  crypto.getRandomValues(b);
  return `${WORDS[b[0] % WORDS.length]}-${WORDS[b[1] % WORDS.length]}-${10 + (b[2] % 90)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const body = await req.json();

    if (body.action === 'student_logins') {
      const [team] = await asCaller(auth, `teams?id=eq.${body.team_id}&select=id,contest_id,code`);
      if (!team) return json({ error: 'Only the team’s coach or the organisers can do that.' }, 403);
      const [contest] = await (await fetch(`${SUPABASE_URL}/rest/v1/contests?id=eq.${team.contest_id}&select=slug`, { headers: service })).json();
      const prefix = String(contest?.slug ?? 'mc').split('-')[0];
      const students = await (await fetch(`${SUPABASE_URL}/rest/v1/competitors?team_id=eq.${team.id}&user_id=is.null&select=id,name,public_id`, { headers: service })).json();
      const accounts: { name: string; username: string; password: string }[] = [];
      for (const s of students) {
        const username = `${prefix}-${s.public_id}`.toLowerCase();
        const pw = password();
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: service,
          body: JSON.stringify({ email: `${username}@${STUDENT_DOMAIN}`, password: pw, email_confirm: true, user_metadata: { name: s.name, username, managed: true } }),
        });
        if (!res.ok) return json({ error: `${s.name}: ${await res.text()}`, accounts }, 400);
        const user = await res.json();
        await fetch(`${SUPABASE_URL}/rest/v1/competitors?id=eq.${s.id}`, { method: 'PATCH', headers: { ...service, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id }) });
        accounts.push({ name: s.name, username, password: pw });
      }
      return json({ accounts });
    }

    if (body.action === 'reset_password') {
      const [c] = await asCaller(auth, `competitors?id=eq.${body.competitor_id}&select=id,name,user_id,public_id`);
      if (!c?.user_id) return json({ error: 'That student has no username sign-in yet.' }, 400);
      const pw = password();
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${c.user_id}`, { method: 'PUT', headers: service, body: JSON.stringify({ password: pw }) });
      if (!res.ok) return json({ error: await res.text() }, 400);
      const u = await res.json();
      return json({ accounts: [{ name: c.name, username: String(u.email ?? '').split('@')[0], password: pw }] });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
