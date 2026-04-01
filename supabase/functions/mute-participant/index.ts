import { SignJWT } from "https://esm.sh/jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Mute or unmute a participant's microphone track server-side via LiveKit's
 * Twirp API. Only facilitators should call this (enforced client-side).
 *
 * Request body: { room_name: string, identity: string, muted: boolean }
 */
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { room_name, identity, muted } = await req.json();

    if (!room_name || !identity || typeof muted !== "boolean") {
      return new Response(
        JSON.stringify({ error: "room_name, identity, and muted (boolean) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build an admin JWT for the LiveKit server API
    const secret = new TextEncoder().encode(apiSecret);
    const adminToken = await new SignJWT({
      video: { roomAdmin: true, room: room_name },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(apiKey)
      .setNotBefore("0s")
      .setExpirationTime("1m")
      .sign(secret);

    // Derive the HTTP base URL from the WebSocket URL.
    // Edge Functions run inside Docker, so localhost won't reach the host.
    // Replace localhost/127.0.0.1 with host.docker.internal for Docker-to-host access.
    const httpBase = wsUrl
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:")
      .replace("localhost", "host.docker.internal")
      .replace("127.0.0.1", "host.docker.internal");

    // Step 1: List participants to find the target and their mic track SID
    const listRes = await fetch(
      `${httpBase}/twirp/livekit.RoomService/ListParticipants`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ room: room_name }),
      },
    );

    if (!listRes.ok) {
      const text = await listRes.text();
      return new Response(
        JSON.stringify({ error: `Failed to list participants: ${text}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { participants } = await listRes.json();
    const target = participants?.find((p: any) => p.identity === identity);

    if (!target) {
      return new Response(
        JSON.stringify({ error: `Participant '${identity}' not found in room` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Find the microphone track
    const micTrack = target.tracks?.find(
      (t: any) => t.source === "MICROPHONE" || t.source === 1,
    );

    if (!micTrack) {
      return new Response(
        JSON.stringify({ error: `No microphone track found for '${identity}'` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2: Mute/unmute the track
    const muteRes = await fetch(
      `${httpBase}/twirp/livekit.RoomService/MutePublishedTrack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          room: room_name,
          identity,
          track_sid: micTrack.sid,
          muted,
        }),
      },
    );

    if (!muteRes.ok) {
      const text = await muteRes.text();
      return new Response(
        JSON.stringify({ error: `Failed to mute track: ${text}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, identity, muted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
