/**
 * startup-update-self
 * -------------------
 * Lets a startup participant update their own funding_goal / dd_room_link /
 * website_link without granting the anon role direct UPDATE on
 * `session_participants`.
 *
 * Trust model matches `participant-presence`: this app has no Supabase Auth,
 * so we accept a participant_id from the client and verify server-side that
 * the row is actually a startup before writing. The only mutable columns are
 * the three listed above.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  participant_id: z.string().uuid(),
  funding_goal: z.number().nonnegative().nullable().optional(),
  dd_room_link: z.string().url().max(500).nullable().optional(),
  website_link: z.string().url().max(500).nullable().optional(),
  // Short pitch summary (~2 sentences). Required before going live, but the
  // edge function accepts null so the dialog can be cleared/edited freely.
  description: z.string().max(1000).nullable().optional(),
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

    // Verify the target row is a startup; refuse to mutate anything else.
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
    if (row.role !== "startup") {
      return new Response(JSON.stringify({ error: "Only startups can self-update" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    if ("funding_goal" in fields) updates.funding_goal = fields.funding_goal ?? null;
    if ("dd_room_link" in fields) updates.dd_room_link = fields.dd_room_link ?? null;
    if ("website_link" in fields) updates.website_link = fields.website_link ?? null;

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
