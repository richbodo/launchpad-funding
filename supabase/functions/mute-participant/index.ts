import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose@5";
import { authorizeFacilitator } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Mute (or unmute) a participant's microphone via LiveKit's Twirp API.
 *
 * Requires a valid facilitator `admin_token`. Previously this endpoint had
 * NO authorization at all — any visitor could mute any participant in any
 * live session by guessing the room name and identity (security finding:
 * mute_participant_open).
 *
 * Request body: { admin_token, room_name, identity, muted }
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

    const body = await req.json().catch(() => ({}));
    const { admin_token, room_name, identity, muted } = body || {};

    if (!room_name || !identity || typeof muted !== "boolean") {
      return new Response(
        JSON.stringify({ error: "room_name, identity, and muted (boolean) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const auth = await authorizeFacilitator(admin_token, supabase, serviceKey);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const secret = new TextEncoder().encode(apiSecret);
    const adminJwt = await new SignJWT({
      video: { roomAdmin: true, room: room_name },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(apiKey)
      .setNotBefore("0s")
      .setExpirationTime("1m")
      .sign(secret);

    const httpBase = wsUrl
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:")
      .replace("localhost", "host.docker.internal")
      .replace("127.0.0.1", "host.docker.internal");

    const listRes = await fetch(
      `${httpBase}/twirp/livekit.RoomService/ListParticipants`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminJwt}`,
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

    const micTrack = target.tracks?.find(
      (t: any) => t.source === "MICROPHONE" || t.source === 1,
    );

    if (!micTrack) {
      return new Response(
        JSON.stringify({ error: `No microphone track found for '${identity}'` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const muteRes = await fetch(
      `${httpBase}/twirp/livekit.RoomService/MutePublishedTrack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminJwt}`,
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
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
