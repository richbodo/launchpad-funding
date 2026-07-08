/**
 * facilitator-update-self
 * -----------------------
 * Lets a facilitator update their own bio and profile image.
 *
 * Requires a per-participant session token (`participant_token`) minted at
 * login via `mint_participant_token_by_password`. The token is resolved
 * server-side to the acting participant row and its `role` must be
 * `facilitator`. The client-supplied `participant_id` is ignored so
 * attackers can't overwrite another facilitator's profile via a guessed id
 * (security finding: self_update_idor).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { resolveParticipantToken } from "../_shared/participant-token.ts";

const BodySchema = z.object({
  participant_token: z.string().min(16).max(128),
  bio: z.string().max(500).nullable().optional(),
  image_url: z.string().url().max(1000).nullable().optional(),
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
    if (who.role !== "facilitator") {
      return new Response(JSON.stringify({ error: "Only facilitators can self-update" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bio, image_url } = parsed.data;
    const updates: Record<string, unknown> = {};
    if ("bio" in parsed.data) updates.bio = bio ?? null;
    if ("image_url" in parsed.data) updates.image_url = image_url ?? null;

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ ok: true, updated: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await supabase
      .from("session_participants")
      .update(updates)
      .eq("id", who.participant_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, updated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
