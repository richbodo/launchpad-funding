import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Public self-signup for the event landing page (issue #44).
 *
 * Request: POST { slug, email, display_name, investor_class }
 *   - investor_class: 'accredited' | 'community'
 *
 * Behavior:
 *   - Inserts a session_participants row with role='investor' and approved=false.
 *     The admin must explicitly approve and then send the magic-link invite
 *     from the admin panel — NO email is sent from this endpoint.
 *   - Enforces a hard cap: if the count of approved investors already meets
 *     max_attendees OR is_full is set, the signup is rejected with
 *     "Session is full".
 *   - Idempotent on (session_id, email): a repeat signup returns the
 *     existing row instead of erroring, so a confused user re-submitting
 *     doesn't see a scary duplicate-key error.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim().toLowerCase();
    const email = String(body?.email || "").trim().toLowerCase();
    const display_name = body?.display_name ? String(body.display_name).trim().slice(0, 120) : null;
    const investor_class = body?.investor_class === "community" ? "community" : "accredited";

    if (!slug || slug.length > 80) {
      return new Response(JSON.stringify({ error: "Invalid event link" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return new Response(JSON.stringify({ error: "Valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session } = await supabase
      .from("sessions")
      .select("id, name, max_attendees, is_full")
      .eq("slug", slug)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow the same email to "re-sign-up" without error.
    //
    // The (session_id, email) unique constraint means we can't insert a
    // separate investor row if the same address is already registered as
    // a facilitator or startup. Surface that conflict explicitly so the
    // signup user knows to use a different email — otherwise the toast
    // would say "you're on the list" but no pending row would ever appear
    // in the admin panel, leaving everyone confused.
    const { data: existing } = await supabase
      .from("session_participants")
      .select("id, role, approved")
      .eq("session_id", session.id)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      if (existing.role !== "investor") {
        return new Response(
          JSON.stringify({
            error: `This email is already registered for this event as a ${existing.role}. Please use a different email to sign up as an investor.`,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          already_registered: true,
          approved: existing.approved,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // Hard cap check (admin toggle OR approved-attendee count).
    if (session.is_full) {
      return new Response(JSON.stringify({ error: "Sorry, the session is full." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { count: approvedCount } = await supabase
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("role", "investor")
      .eq("approved", true);
    if ((approvedCount ?? 0) >= (session.max_attendees ?? 100)) {
      return new Response(JSON.stringify({ error: "Sorry, the session is full." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await supabase
      .from("session_participants")
      .insert({
        session_id: session.id,
        email,
        role: "investor",
        display_name,
        investor_class,
        approved: false,
      });
    if (insErr) {
      // Race-condition: another request inserted the same email concurrently.
      if (insErr.code === "23505") {
        return new Response(
          JSON.stringify({ success: true, already_registered: true, approved: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw insErr;
    }

    return new Response(
      JSON.stringify({ success: true, already_registered: false, approved: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Signup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
