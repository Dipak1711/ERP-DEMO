// CORS + JSON helpers and the two Supabase clients the functions use.
//   userClient(jwt)  acts AS THE CALLER (their JWT): used only to ask "may this person send this PO?" (can_send_po) — database rules apply to them.
//   adminClient()    the service role: used only AFTER that check passes, to read the PO, write the PDF to storage and record the send.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export const bearer = (req: Request): string | null => (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim() || null;

// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided to every Edge Function by Supabase itself; nothing to set.
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const userClient = (jwt: string) =>
  createClient(url(), anonKey(), { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });

export const adminClient = () => createClient(url(), serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

/** Name shown as "sent by": the caller's full name, else their e-mail. */
export async function callerName(client: ReturnType<typeof userClient>, jwt: string): Promise<string> {
  const { data } = await client.auth.getUser(jwt);
  const u = data?.user;
  return (u?.user_metadata?.full_name as string | undefined) || u?.email || 'User';
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
