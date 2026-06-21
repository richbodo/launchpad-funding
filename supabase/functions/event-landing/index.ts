import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Public read endpoint for the event landing page (issue #44).
 *
 * Request: GET ?slug=<slug>  or  POST { slug }
 * Returns: { session, startups[], facilitators[], approved_attendee_count, accepting_signups }
 *
 * Uses the service role so we can selectively return only the fields we want
 * to expose publicly. We never leak email addresses of attendees or pending
 * signups — only the names/links/images of startups and facilitators are
 * needed on the landing page.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let slug = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      slug = url.searchParams.get("slug") || "";
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      slug = String(body?.slug || "");
    } else {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    slug = slug.trim().toLowerCase();
    if (!slug || slug.length > 80) {
      return new Response(JSON.stringify({ error: "Valid slug required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select(
        "id, name, description, start_time, end_time, timezone, status, slug, hero_image_url, max_attendees, is_full",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (sErr || !session) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only expose presentable participant fields — no emails of attendees.
    const { data: participants } = await supabase
      .from("session_participants")
      .select("role, display_name, image_url, presentation_order, website_link, dd_room_link, funding_goal")
      .eq("session_id", session.id)
      .in("role", ["startup", "facilitator"])
      .order("presentation_order", { ascending: true, nullsFirst: false });

    const startups = (participants || [])
      .filter((p: any) => p.role === "startup")
      .map((p: any) => ({
        display_name: p.display_name,
        image_url: p.image_url,
        website_link: p.website_link,
        dd_room_link: p.dd_room_link,
        funding_goal: p.funding_goal,
      }));
    const facilitators = (participants || [])
      .filter((p: any) => p.role === "facilitator")
      .map((p: any) => ({
        display_name: p.display_name,
        image_url: p.image_url,
      }));

    // Cap check: count approved investor/community attendees.
    const { count: approvedCount } = await supabase
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("role", "investor")
      .eq("approved", true);

    const max = session.max_attendees ?? 100;
    const accepting_signups = !session.is_full && (approvedCount ?? 0) < max;

    return new Response(
      JSON.stringify({
        session,
        startups,
        facilitators,
        approved_attendee_count: approvedCount ?? 0,
        accepting_signups,
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
