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

    // session_id is optional for facilitators — admins may sign in without
    // having an active session (e.g. all their sessions are completed and
    // RLS on session_participants hides them from anon reads).
    if (session_id !== undefined && session_id !== null && session_id !== "") {
      if (typeof session_id !== "string" || session_id.length > 100) {
        return new Response(JSON.stringify({ error: "Valid session_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    const normalizedEmail = email.toLowerCase().trim();

    // Look up any facilitator row for this email. If session_id was given,
    // prefer the matching row so the response participant reflects that session.
    let participantQuery = supabase
      .from("session_participants")
      .select("id, email, display_name, role, session_id")
      .eq("email", normalizedEmail)
      .eq("role", "facilitator");
    if (session_id) participantQuery = participantQuery.eq("session_id", session_id);
    const { data: participantRows, error: lookupErr } = await participantQuery.limit(1);
    const participant = participantRows?.[0];

    if (lookupErr || !participant) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Find a credentialed facilitator row for this email — credentials are
    // shared across all sessions a facilitator is invited to. We look up any
    // participant_credentials row whose participant has the same email and
    // role, then verify against that participant id.
    const { data: facilitatorRows } = await supabase
      .from("session_participants")
      .select("id")
      .eq("email", normalizedEmail)
      .eq("role", "facilitator");

    const candidateIds = (facilitatorRows || []).map((r: { id: string }) => r.id);
    if (candidateIds.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: credRows } = await supabase
      .from("participant_credentials")
      .select("participant_id")
      .in("participant_id", candidateIds)
      .limit(1);

    const credId = credRows?.[0]?.participant_id;
    if (!credId) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cryptResult } = await supabase.rpc("verify_participant_password", {
      _participant_id: credId,
      _password: password,
    });

    if (cryptResult !== true) {
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
