/**
 * facilitator-update-self
 * -----------------------
 * Lets a facilitator participant update their own short bio without granting
 * the anon role direct UPDATE on `session_participants`.
 *
 * Trust model matches `startup-update-self`/`participant-presence`: this app
 * has no Supabase Auth, so we accept a participant_id from the client and
 * verify server-side that the row is actually a facilitator before writing.
 * The only mutable column is `bio` (≤500 chars; nullable to allow clearing).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  participant_id: z.string().uuid(),
  bio: z.string().max(500).nullable().optional(),
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

    const { participant_id, ...fields } = parsed.data;

    // Verify the target row is a facilitator; refuse to mutate anything else.
    const { data: row, error: lookupErr } = await supabase
      .from("session_participants")
      .select("id, role")
      .eq("id", participant_id)
      .maybeSingle();

    if (lookupErr || !row) {
      return new Response(JSON.stringify({ error: "Participant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.role !== "facilitator") {
      return new Response(JSON.stringify({ error: "Only facilitators can self-update bio" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    if ("bio" in fields) updates.bio = fields.bio ?? null;

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ ok: true, updated: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await supabase
      .from("session_participants")
      .update(updates)
      .eq("id", participant_id);

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
