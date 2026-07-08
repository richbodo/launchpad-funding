/**
 * startup-update-self
 * -------------------
 * Lets a startup update their own funding_goal / dd_room_link / website_link /
 * description / image_url.
 *
 * Requires a per-participant session token (`participant_token`) minted at
 * login. Resolved server-side to the acting participant row; the row must be
 * a startup. The client-supplied `participant_id` is ignored so anyone with
 * the public roster can't edit another startup's profile via a guessed id
 * (security finding: self_update_idor).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { resolveParticipantToken } from "../_shared/participant-token.ts";

const lenientUrl = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}, z.string().url().max(500).nullable().optional());

const BodySchema = z.object({
  participant_token: z.string().min(16).max(128),
  funding_goal: z.number().nonnegative().nullable().optional(),
  dd_room_link: lenientUrl,
  website_link: lenientUrl,
  description: z.string().max(1000).nullable().optional(),
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
    if (who.role !== "startup") {
      return new Response(JSON.stringify({ error: "Only startups can self-update" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    if ("funding_goal" in parsed.data) updates.funding_goal = parsed.data.funding_goal ?? null;
    if ("dd_room_link" in parsed.data) updates.dd_room_link = parsed.data.dd_room_link ?? null;
    if ("website_link" in parsed.data) updates.website_link = parsed.data.website_link ?? null;
    if ("description" in parsed.data) updates.description = parsed.data.description ?? null;
    if ("image_url" in parsed.data) updates.image_url = parsed.data.image_url ?? null;

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
