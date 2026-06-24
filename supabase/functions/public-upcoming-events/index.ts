import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Public list of upcoming events for the unauthenticated home page.
 *
 * Returns only sessions that:
 *  - have a public slug (so they have a /event/:slug landing page)
 *  - are scheduled or live
 *  - have not yet ended
 *
 * Exposes only fields safe for anonymous viewers (no participant emails, no
 * facilitator config). Mirrors the pattern in `event-landing/index.ts`.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("sessions")
      .select(
        "id, name, slug, description, start_time, end_time, timezone, status, hero_image_url",
      )
      .not("slug", "is", null)
      .in("status", ["scheduled", "live"])
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(20);

    if (error) throw error;

    return new Response(
      JSON.stringify({ events: data ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || "Failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
