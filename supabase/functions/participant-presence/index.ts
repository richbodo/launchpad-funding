/**
 * participant-presence
 * --------------------
 * Updates a participant's `is_logged_in` flag using the service role,
 * so the client never needs a SECURITY DEFINER RPC or a permissive
 * UPDATE policy on `session_participants`.
 *
 * Anyone can call this (no auth in this app) — same trust model as the
 * previous public RPC. The only inputs are a participant UUID and a
 * boolean; we validate shape with Zod before writing.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  participant_id: z.string().uuid(),
  logged_in: z.boolean(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const json = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { participant_id, logged_in } = parsed.data;
    const update: Record<string, unknown> = { is_logged_in: logged_in };
    if (logged_in) update.logged_in_at = new Date().toISOString();

    const { error } = await supabase
      .from("session_participants")
      .update(update)
      .eq("id", participant_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
