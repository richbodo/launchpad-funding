/**
 * notify-facilitators-waiting
 * ---------------------------
 * Lets a startup who is sitting on the pre-session waiting screen ping every
 * facilitator on the session by email, saying "I'm here, please start the
 * session." Designed for the (very common) case where the facilitator is late
 * and the presenters land in an empty room.
 *
 * Trust model matches `participant-presence` / `startup-update-self`: we
 * accept a participant_id from the client and verify server-side that the row
 * is actually a startup on this session before sending anything.
 *
 * Rate-limit: at most one notification per (participant_id) every 60 seconds,
 * tracked in-memory per edge worker. Best-effort; the UI also disables the
 * button after a click.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const recentNotifies = new Map<string, number>();
const COOLDOWN_MS = 60_000;

function formatSessionTime(startUtc: string | null, endUtc: string | null, tz: string | null): string {
  if (!startUtc) return "";
  try {
    const start = new Date(startUtc);
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: tz || "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    };
    const startStr = start.toLocaleString("en-US", opts);
    if (!endUtc) return startStr;
    const endStr = new Date(endUtc).toLocaleString("en-US", {
      timeZone: tz || "UTC",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `${startStr} – ${endStr}`;
  } catch {
    return startUtc;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const participant_id = String(body?.participant_id || "");
    if (!participant_id) {
      return new Response(JSON.stringify({ error: "participant_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const last = recentNotifies.get(participant_id) || 0;
    if (now - last < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
      return new Response(
        JSON.stringify({ error: `Please wait ${wait}s before notifying again.` }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: me, error: meErr } = await supabase
      .from("session_participants")
      .select("id, session_id, role, email, display_name")
      .eq("id", participant_id)
      .maybeSingle();

    if (meErr || !me) {
      return new Response(JSON.stringify({ error: "Participant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (me.role !== "startup") {
      return new Response(JSON.stringify({ error: "Only startups can use this." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await supabase
      .from("sessions")
      .select("id, name, start_time, end_time, timezone, status")
      .eq("id", me.session_id)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: facilitators } = await supabase
      .from("session_participants")
      .select("email, display_name")
      .eq("session_id", me.session_id)
      .eq("role", "facilitator");

    if (!facilitators || facilitators.length === 0) {
      return new Response(JSON.stringify({ error: "No facilitators on this session." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    recentNotifies.set(participant_id, now);

    const sessionTime = formatSessionTime(
      session.start_time as any,
      session.end_time as any,
      session.timezone as any,
    );

    const results = await Promise.allSettled(
      facilitators.map((f: any) =>
        supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "startup-waiting",
            recipientEmail: f.email,
            // One ping per (startup, facilitator, minute) — re-clicks within the
            // minute are de-duped by the email infra.
            idempotencyKey: `startup-waiting-${participant_id}-${f.email}-${Math.floor(now / 60000)}`,
            templateData: {
              facilitatorName: f.display_name || null,
              startupName: me.display_name || me.email,
              startupEmail: me.email,
              sessionName: session.name,
              sessionTime,
            },
          },
        })
      ),
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.length - sent;
    return new Response(
      JSON.stringify({ success: true, sent, failed, total: facilitators.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Notify failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
