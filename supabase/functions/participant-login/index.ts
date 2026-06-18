import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signAdminToken } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Verify a facilitator's email + password.
 *
 * On success returns:
 *   { success: true, participant: {...}, admin_token: "<hmac jwt-ish>" }
 *
 * The admin_token is a short-lived HMAC bearer used to authorize subsequent
 * admin edge function calls (admin-action, admin-settings, chat-archives-list).
 * It is ONLY issued when the verified row's role === 'facilitator'.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, email, password } = await req.json();

    if (!session_id || typeof session_id !== "string" || session_id.length > 100) {
      return new Response(JSON.stringify({ error: "Valid session_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || typeof email !== "string" || email.length > 255) {
      return new Response(JSON.stringify({ error: "Valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string" || password.length > 255) {
      return new Response(JSON.stringify({ error: "Valid password is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const { data: participant, error: lookupErr } = await supabase
      .from("session_participants")
      .select("id, email, display_name, password_hash, role")
      .eq("session_id", session_id)
      .eq("email", email.toLowerCase().trim())
      .eq("role", "facilitator")
      .maybeSingle();

    if (lookupErr || !participant) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Facilitators added to a new session start with no password_hash on that
    // row. Fall back to any other facilitator row for the same email that does
    // have a hash — facilitator credentials are shared across sessions.
    let credId = participant.id;
    let credHash = participant.password_hash;
    if (!credHash) {
      const { data: fallback } = await supabase
        .from("session_participants")
        .select("id, password_hash")
        .eq("email", email.toLowerCase().trim())
        .eq("role", "facilitator")
        .not("password_hash", "is", null)
        .limit(1)
        .maybeSingle();
      if (!fallback?.password_hash) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      credId = fallback.id;
      credHash = fallback.password_hash;

      // Backfill the hash onto this session's row so future logins are
      // single-query and `verify_participant_password` works against it directly.
      await supabase
        .from("session_participants")
        .update({ password_hash: credHash })
        .eq("id", participant.id);
    }

    let passwordValid = false;
    if (credHash.startsWith("$2")) {
      const { data: cryptResult } = await supabase.rpc("verify_participant_password", {
        _participant_id: credId,
        _password: password,
      });
      passwordValid = cryptResult === true;
    } else {
      passwordValid = credHash === password;
    }

    if (!passwordValid) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin_token = await signAdminToken(participant.email, serviceKey);

    return new Response(
      JSON.stringify({
        success: true,
        participant: {
          id: participant.id,
          email: participant.email,
          display_name: participant.display_name,
          role: participant.role,
        },
        admin_token,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Login failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
