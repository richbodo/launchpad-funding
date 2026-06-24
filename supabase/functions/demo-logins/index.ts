import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEMO_FACILITATOR_PASSWORD } from "../_shared/demo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Public demo-credential listing.
 *
 * Returns demo facilitator passwords (and participant rosters) ONLY when the
 * app's `mode` setting is `demo`. Otherwise responds 403. This is how the
 * /demo-logins page gets credentials now that password_hash is no longer
 * readable from the client.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: modeRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "mode")
      .maybeSingle();

    if (modeRow?.value !== "demo") {
      return new Response(JSON.stringify({ error: "Demo mode is not active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, name, status, start_time, end_time, slug, description, hero_image_url")
      .like("name", "[DEMO]%")
      .order("start_time", { ascending: true });

    const ids = (sessions || []).map((s) => s.id);
    let participants: any[] = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from("session_participants")
        .select("id, email, display_name, role, session_id, investor_class, image_url")
        .in("session_id", ids)
        .order("role", { ascending: true });
      participants = data || [];
    }


    return new Response(
      JSON.stringify({
        sessions: sessions || [],
        participants,
        // The bcrypt'd hash in `password_hash` is unreadable plaintext, so we
        // expose the well-known demo password explicitly. The /demo-logins
        // page shows it, and the facilitator jump-in link uses it to perform
        // a real participant-login handshake (no demo-mode auth bypass).
        demo_facilitator_password: DEMO_FACILITATOR_PASSWORD,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
