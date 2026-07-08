/**
 * livekit-token
 * -------------
 * Issues a LiveKit room-join JWT.
 *
 * Requires a per-participant session token (`participant_token`) minted at
 * login. The caller's session/identity/role are read from the resolved token,
 * NOT from the request body — this prevents anyone with the public roster
 * from calling this endpoint with another user's email to obtain a
 * publish-capable video/audio token (security finding: livekit_identity_spoof).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose@5";
import { resolveParticipantToken } from "../_shared/participant-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    const wsUrl = Deno.env.get("LIVEKIT_WS_URL");

    if (!apiKey || !apiSecret || !wsUrl) {
      return new Response(
        JSON.stringify({ error: "LiveKit not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { participant_token, name } = body || {};

    if (!participant_token || typeof participant_token !== "string") {
      return new Response(
        JSON.stringify({ error: "participant_token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const who = await resolveParticipantToken(supabase, participant_token);
    if (!who) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const identity = who.email;
    const role = who.role;
    const roomName = `session-${who.session_id}`;

    const secret = new TextEncoder().encode(apiSecret);
    const token = await new SignJWT({
      sub: identity,
      name: name || identity,
      metadata: JSON.stringify({ role }),
      video: {
        room: roomName,
        roomJoin: true,
        canPublish: role !== "investor",
        canSubscribe: true,
        canPublishData: true,
      },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(apiKey)
      .setNotBefore("0s")
      .setExpirationTime("6h")
      .sign(secret);

    return new Response(
      JSON.stringify({ token, ws_url: wsUrl, room: roomName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
