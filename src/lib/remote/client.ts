import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** The Supabase client. Only exists when the app is connected (see store.REMOTE). */
export const sb: SupabaseClient | null = url && anon
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export function client(): SupabaseClient {
  if (!sb) throw new Error('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return sb;
}

/**
 * Students too young for email sign in with a username. Their account's
 * email is made from it and never receives mail.
 */
export const STUDENT_DOMAIN = 'students.mathcloud.app';
export const loginEmail = (login: string) => {
  const l = login.trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${STUDENT_DOMAIN}`;
};
