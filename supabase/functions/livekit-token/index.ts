import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose@5";

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

    const { session_id, identity, name, role } = await req.json();

    if (!session_id || !identity || !role) {
      return new Response(
        JSON.stringify({ error: "session_id, identity, and role are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify participant exists in this session
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: participant, error: partErr } = await supabase
      .from("session_participants")
      .select("id")
      .eq("session_id", session_id)
      .eq("email", identity)
      .eq("role", role)
      .maybeSingle();

    if (partErr || !participant) {
      return new Response(
        JSON.stringify({ error: "Participant not found in session" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Room name scoped to session
    const roomName = `session-${session_id}`;

    // Build LiveKit JWT
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
