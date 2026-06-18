import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * One-time facilitator password creation, intended for the magic-link
 * onboarding flow. Authorization model mirrors the existing magic-link
 * auto-login: possession of the invite email (which is delivered only to the
 * registered facilitator) is what authorizes the action. To prevent
 * hijacking after onboarding, this endpoint refuses the call as soon as ANY
 * facilitator row for the same email already has a password_hash.
 *
 * Body: { session_id, email, password }
 * Returns: { success: true } | { error }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { session_id, email, password } = await req.json();

    if (!session_id || typeof session_id !== "string") {
      return json({ error: "Valid session_id is required" }, 400);
    }
    if (!email || typeof email !== "string" || email.length > 255) {
      return json({ error: "Valid email is required" }, 400);
    }
    if (!password || typeof password !== "string" || password.length < 8 || password.length > 255) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const normalizedEmail = email.toLowerCase().trim();

    // Find the facilitator row on the invited session.
    const { data: target, error: lookupErr } = await supabase
      .from("session_participants")
      .select("id, password_hash")
      .eq("session_id", session_id)
      .eq("email", normalizedEmail)
      .eq("role", "facilitator")
      .maybeSingle();

    if (lookupErr || !target) {
      return json({ error: "Facilitator invite not found for this session" }, 404);
    }

    // Refuse if this facilitator already has a password anywhere — they should
    // log in normally and use any reset flow we add later instead.
    const { data: existing } = await supabase
      .from("session_participants")
      .select("id")
      .eq("email", normalizedEmail)
      .eq("role", "facilitator")
      .not("password_hash", "is", null)
      .limit(1);

    if (existing && existing.length > 0) {
      return json({ error: "Password already set. Please log in." }, 409);
    }

    // The hash_participant_password() trigger converts the plain password to
    // a bcrypt hash on write, so we just store the raw value.
    const { error: updateErr } = await supabase
      .from("session_participants")
      .update({ password_hash: password })
      .eq("id", target.id);

    if (updateErr) {
      return json({ error: "Failed to set password" }, 500);
    }

    return json({ success: true });
  } catch (_err) {
    return json({ error: "Password setup failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
