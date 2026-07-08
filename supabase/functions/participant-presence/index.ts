/**
 * participant-presence
 * --------------------
 * Updates a participant's `is_logged_in` flag.
 *
 * Requires a per-participant session token (`participant_token`) minted at
 * login. The token is resolved server-side to the participant row, so no
 * client-supplied `participant_id` is trusted. This closes IDOR paths where
 * any visitor could flip another participant's login state (security
 * finding: self_update_idor).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { resolveParticipantToken } from "../_shared/participant-token.ts";

const BodySchema = z.object({
  participant_token: z.string().min(16).max(128),
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

    const who = await resolveParticipantToken(supabase, parsed.data.participant_token);
    if (!who) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const update: Record<string, unknown> = { is_logged_in: parsed.data.logged_in };
    if (parsed.data.logged_in) update.logged_in_at = new Date().toISOString();

    const { error } = await supabase
      .from("session_participants")
      .update(update)
      .eq("id", who.participant_id);

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
