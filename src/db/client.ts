// ---------------------------------------------------------------------------
// Supabase client. URL + anon (publishable) key come from .env — never the service_role key.
// Security does not depend on this file: every rule (who may read what, masking, validation) is enforced inside the
// database (supabase/migrations). This key can only do what a signed-in user's role allows.
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** false when .env is missing / empty — the app then shows a setup message instead of failing obscurely */
export const dbConfigured = !!url && !!key;

export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** Turns any Supabase / PostgREST error into the plain message the database raised (same texts as the old ERPError). */
export function dbMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Unexpected error.';
}
