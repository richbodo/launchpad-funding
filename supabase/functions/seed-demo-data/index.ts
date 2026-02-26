import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check mode
    const { data: modeSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "mode")
      .single();

    if (!modeSetting || modeSetting.value !== "demo") {
      return new Response(
        JSON.stringify({ error: "Not in demo mode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete previous demo data (cascade via participants first)
    const { data: demoSessions } = await supabase
      .from("sessions")
      .select("id")
      .like("name", "[DEMO]%");

    if (demoSessions && demoSessions.length > 0) {
      const ids = demoSessions.map((s: any) => s.id);
      await supabase.from("chat_messages").delete().in("session_id", ids);
      await supabase.from("investments").delete().in("session_id", ids);
      await supabase.from("session_logs").delete().in("session_id", ids);
      await supabase.from("session_participants").delete().in("session_id", ids);
      await supabase.from("sessions").delete().like("name", "[DEMO]%");
    }

    const now = new Date();

    // Session A: LIVE, started 1hr ago, ends in 2hrs
    const alphaStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const alphaEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    // Session B: COMPLETED, yesterday
    const betaStart = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const betaEnd = new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString();

    // Session C: COMPLETED, 2 days ago
    const gammaStart = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString();
    const gammaEnd = new Date(now.getTime() - 46 * 60 * 60 * 1000).toISOString();

    const { data: sessionsData, error: sessErr } = await supabase
      .from("sessions")
      .insert([
        { name: "[DEMO] Demo Day Alpha", start_time: alphaStart, end_time: alphaEnd, status: "live", timezone: "America/New_York" },
        { name: "[DEMO] Demo Day Beta", start_time: betaStart, end_time: betaEnd, status: "completed", timezone: "America/New_York" },
        { name: "[DEMO] Demo Day Gamma", start_time: gammaStart, end_time: gammaEnd, status: "completed", timezone: "America/New_York" },
      ])
      .select();

    if (sessErr) {
      return new Response(
        JSON.stringify({ error: "Failed to create sessions", details: sessErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [alpha, beta, gamma] = sessionsData!;

    // Shared facilitators
    const facilitators = [
      { email: "facilitator@demo.com", display_name: "Facilitator 1", password_hash: "demo123", role: "facilitator" as const },
      { email: "admin@demo.com", display_name: "Facilitator 2", password_hash: "demo123", role: "facilitator" as const },
    ];

    // Session A participants
    const alphaParticipants = [
      ...facilitators.map(f => ({ ...f, session_id: alpha.id })),
      { session_id: alpha.id, email: "acme@demo.com", display_name: "AcmeTech", role: "startup" as const, presentation_order: 1, website_link: "https://acmetech.io", dd_room_link: "https://drive.google.com/acme" },
      { session_id: alpha.id, email: "nova@demo.com", display_name: "NovaPay", role: "startup" as const, presentation_order: 2, website_link: "https://novapay.com", dd_room_link: "https://drive.google.com/nova" },
      { session_id: alpha.id, email: "green@demo.com", display_name: "GreenGrid", role: "startup" as const, presentation_order: 3, website_link: "https://greengrid.co", dd_room_link: "https://drive.google.com/green" },
      { session_id: alpha.id, email: "alice@investor.com", display_name: "Alice Chen", role: "investor" as const },
      { session_id: alpha.id, email: "bob@investor.com", display_name: "Bob Martinez", role: "investor" as const },
      { session_id: alpha.id, email: "carol@investor.com", display_name: "Carol Nguyen", role: "investor" as const },
      { session_id: alpha.id, email: "dave@investor.com", display_name: "Dave Wilson", role: "investor" as const },
    ];

    // Session B (completed yesterday) participants
    const betaParticipants = [
      ...facilitators.map(f => ({ ...f, session_id: beta.id })),
      { session_id: beta.id, email: "cloud@demo.com", display_name: "CloudSync", role: "startup" as const, presentation_order: 1, website_link: "https://cloudsync.dev", dd_room_link: "https://drive.google.com/cloudsync" },
      { session_id: beta.id, email: "forge@demo.com", display_name: "DataForge", role: "startup" as const, presentation_order: 2, website_link: "https://dataforge.ai", dd_room_link: "https://drive.google.com/dataforge" },
      { session_id: beta.id, email: "pixel@demo.com", display_name: "PixelAI", role: "startup" as const, presentation_order: 3, website_link: "https://pixelai.co", dd_room_link: "https://drive.google.com/pixelai" },
      { session_id: beta.id, email: "eve@investor.com", display_name: "Eve Park", role: "investor" as const },
      { session_id: beta.id, email: "frank@investor.com", display_name: "Frank Liu", role: "investor" as const },
    ];

    // Session C (completed 2 days ago) participants
    const gammaParticipants = [
      ...facilitators.map(f => ({ ...f, session_id: gamma.id })),
      { session_id: gamma.id, email: "solar@demo.com", display_name: "SolarWave", role: "startup" as const, presentation_order: 1, website_link: "https://solarwave.energy", dd_room_link: "https://drive.google.com/solarwave" },
      { session_id: gamma.id, email: "finly@demo.com", display_name: "Finly", role: "startup" as const, presentation_order: 2, website_link: "https://finly.io", dd_room_link: "https://drive.google.com/finly" },
      { session_id: gamma.id, email: "mediq@demo.com", display_name: "MediQ", role: "startup" as const, presentation_order: 3, website_link: "https://mediq.health", dd_room_link: "https://drive.google.com/mediq" },
      { session_id: gamma.id, email: "ivan@investor.com", display_name: "Ivan Petrov", role: "investor" as const },
      { session_id: gamma.id, email: "julia@investor.com", display_name: "Julia Santos", role: "investor" as const },
      { session_id: gamma.id, email: "kyle@investor.com", display_name: "Kyle Brown", role: "investor" as const },
    ];

    const allParticipants = [...alphaParticipants, ...betaParticipants, ...gammaParticipants];

    const { error: partErr } = await supabase
      .from("session_participants")
      .insert(allParticipants);

    if (partErr) {
      return new Response(
        JSON.stringify({ error: "Failed to create participants", details: partErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          sessions_created: 3,
          participants_created: allParticipants.length,
          sessions: [
            { name: alpha.name, status: "live", id: alpha.id },
            { name: beta.name, status: "completed", id: beta.id },
            { name: gamma.name, status: "completed", id: gamma.id },
          ],
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
