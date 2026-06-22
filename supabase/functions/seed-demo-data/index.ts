import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFacilitator } from "../_shared/admin-token.ts";

/** Well-known password seeded onto every demo facilitator row. */
export const DEMO_FACILITATOR_PASSWORD = "demo123";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Demo-data seeder.
 *
 * Tears down any existing `[DEMO]` sessions then rebuilds three sessions
 * (live / completed yesterday / completed two days ago). Each session has:
 *
 *   - a URL `slug`, public `description`, and `hero_image_url` so the public
 *     /event/:slug landing page renders something interesting,
 *   - facilitators with avatar `image_url`s,
 *   - 3 startups per session with `image_url`, `website_link`, `dd_room_link`,
 *     and `funding_goal`,
 *   - a mix of accredited investors and community supporters
 *     (`investor_class` on session_participants) — both kinds appear in every
 *     session so the auto-login shortcuts on /demo-logins can drop you into
 *     either flow with one click.
 *
 * All seeded rows have `approved=true` (column default) so they show up in
 * the event-landing attendee count and can log in immediately.
 *
 * Placeholder images come from picsum.photos with stable seeds so reruns
 * produce visually identical pages.
 */

type RoleLiteral = "facilitator" | "startup" | "investor";

interface SeededParticipant {
  session_id: string;
  email: string;
  display_name: string;
  role: RoleLiteral;
  password_hash?: string;
  presentation_order?: number;
  website_link?: string;
  dd_room_link?: string;
  funding_goal?: number;
  investor_class?: "accredited" | "community";
  image_url?: string;
}

const heroImg = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/1600/900`;
const avatarImg = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/240/240`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Require a valid facilitator admin_token. Without this anyone hitting
    // the function URL could re-seed demo data (or use it as a way to
    // bulk-delete sessions whose names start with `[DEMO]`).
    let body: any = {};
    try { body = await req.json(); } catch { /* allow empty body */ }
    const auth = await authorizeFacilitator(body?.admin_token, supabase, serviceRoleKey);
    if (!auth) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: facilitator admin token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }



    const { data: modeSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "mode")
      .single();

    if (!modeSetting || modeSetting.value !== "demo") {
      return new Response(
        JSON.stringify({ error: "Not in demo mode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Tear down ---------------------------------------------------------
    const { data: demoSessions } = await supabase
      .from("sessions")
      .select("id")
      .like("name", "[DEMO]%");

    if (demoSessions && demoSessions.length > 0) {
      const ids = demoSessions.map((s: { id: string }) => s.id);
      await supabase.from("chat_messages").delete().in("session_id", ids);
      await supabase.from("investments").delete().in("session_id", ids);
      await supabase.from("session_logs").delete().in("session_id", ids);
      await supabase.from("session_participants").delete().in("session_id", ids);
      await supabase.from("sessions").delete().like("name", "[DEMO]%");
    }

    // ---- Sessions ----------------------------------------------------------
    const now = new Date();
    const alphaStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const alphaEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const betaStart = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const betaEnd = new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString();
    const gammaStart = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString();
    const gammaEnd = new Date(now.getTime() - 46 * 60 * 60 * 1000).toISOString();

    const { data: sessionsData, error: sessErr } = await supabase
      .from("sessions")
      .insert([
        {
          name: "[DEMO] Demo Day Alpha",
          slug: "demo-alpha",
          description:
            "A live demo of FundFlow's three-pane session experience — meet three startups raising their seed rounds.",
          hero_image_url: heroImg("demo-alpha-hero"),
          start_time: alphaStart,
          end_time: alphaEnd,
          status: "live",
          timezone: "America/New_York",
        },
        {
          name: "[DEMO] Demo Day Beta",
          slug: "demo-beta",
          description:
            "Yesterday's demo day, archived for replay. Browse the deck of presenters and chat archive.",
          hero_image_url: heroImg("demo-beta-hero"),
          start_time: betaStart,
          end_time: betaEnd,
          status: "completed",
          timezone: "America/New_York",
        },
        {
          name: "[DEMO] Demo Day Gamma",
          slug: "demo-gamma",
          description:
            "An older completed session — useful for testing chat archives and post-event flows.",
          hero_image_url: heroImg("demo-gamma-hero"),
          start_time: gammaStart,
          end_time: gammaEnd,
          status: "completed",
          timezone: "America/New_York",
        },
      ])
      .select();

    if (sessErr) {
      return new Response(
        JSON.stringify({ error: "Failed to create sessions", details: sessErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [alpha, beta, gamma] = sessionsData!;

    // ---- Participants ------------------------------------------------------
    // Shared facilitators (same credentials across every demo session).
    const facilitatorsFor = (session_id: string): SeededParticipant[] => [
      {
        session_id,
        email: "facilitator@demo.com",
        display_name: "Facilitator 1",
        role: "facilitator",
        password_hash: "demo123",
        image_url: avatarImg("facilitator-1"),
      },
      {
        session_id,
        email: "admin@demo.com",
        display_name: "Facilitator 2",
        role: "facilitator",
        password_hash: "demo123",
        image_url: avatarImg("facilitator-2"),
      },
    ];

    const alphaParticipants: SeededParticipant[] = [
      ...facilitatorsFor(alpha.id),
      { session_id: alpha.id, email: "acme@demo.com",  display_name: "AcmeTech",  role: "startup", presentation_order: 1, website_link: "https://acmetech.io",  dd_room_link: "https://drive.google.com/acme",  funding_goal: 2_000_000, image_url: avatarImg("acmetech") },
      { session_id: alpha.id, email: "nova@demo.com",  display_name: "NovaPay",   role: "startup", presentation_order: 2, website_link: "https://novapay.com",  dd_room_link: "https://drive.google.com/nova",  funding_goal: 5_000_000, image_url: avatarImg("novapay") },
      { session_id: alpha.id, email: "green@demo.com", display_name: "GreenGrid", role: "startup", presentation_order: 3, website_link: "https://greengrid.co", dd_room_link: "https://drive.google.com/green", funding_goal: 3_000_000, image_url: avatarImg("greengrid") },
      // Accredited investors.
      { session_id: alpha.id, email: "alice@investor.com", display_name: "Alice Chen (Accredited)",    role: "investor", investor_class: "accredited" },
      { session_id: alpha.id, email: "bob@investor.com",   display_name: "Bob Martinez (Accredited)",  role: "investor", investor_class: "accredited" },
      // Community supporters.
      { session_id: alpha.id, email: "carol@community.com", display_name: "Carol Nguyen (Community)", role: "investor", investor_class: "community" },
      { session_id: alpha.id, email: "dave@community.com",  display_name: "Dave Wilson (Community)",  role: "investor", investor_class: "community" },
    ];

    const betaParticipants: SeededParticipant[] = [
      ...facilitatorsFor(beta.id),
      { session_id: beta.id, email: "cloud@demo.com", display_name: "CloudSync", role: "startup", presentation_order: 1, website_link: "https://cloudsync.dev", dd_room_link: "https://drive.google.com/cloudsync", funding_goal: 1_500_000, image_url: avatarImg("cloudsync") },
      { session_id: beta.id, email: "forge@demo.com", display_name: "DataForge", role: "startup", presentation_order: 2, website_link: "https://dataforge.ai", dd_room_link: "https://drive.google.com/dataforge", funding_goal: 4_000_000, image_url: avatarImg("dataforge") },
      { session_id: beta.id, email: "pixel@demo.com", display_name: "PixelAI",   role: "startup", presentation_order: 3, website_link: "https://pixelai.co",  dd_room_link: "https://drive.google.com/pixelai",   funding_goal: 2_500_000, image_url: avatarImg("pixelai") },
      { session_id: beta.id, email: "eve@investor.com",   display_name: "Eve Park (Accredited)",  role: "investor", investor_class: "accredited" },
      { session_id: beta.id, email: "frank@community.com", display_name: "Frank Liu (Community)", role: "investor", investor_class: "community" },
    ];

    const gammaParticipants: SeededParticipant[] = [
      ...facilitatorsFor(gamma.id),
      { session_id: gamma.id, email: "solar@demo.com", display_name: "SolarWave", role: "startup", presentation_order: 1, website_link: "https://solarwave.energy", dd_room_link: "https://drive.google.com/solarwave", funding_goal: 6_000_000, image_url: avatarImg("solarwave") },
      { session_id: gamma.id, email: "finly@demo.com", display_name: "Finly",     role: "startup", presentation_order: 2, website_link: "https://finly.io",         dd_room_link: "https://drive.google.com/finly",     funding_goal: 1_000_000, image_url: avatarImg("finly") },
      { session_id: gamma.id, email: "mediq@demo.com", display_name: "MediQ",     role: "startup", presentation_order: 3, website_link: "https://mediq.health",     dd_room_link: "https://drive.google.com/mediq",     funding_goal: 8_000_000, image_url: avatarImg("mediq") },
      { session_id: gamma.id, email: "ivan@investor.com",   display_name: "Ivan Petrov (Accredited)",  role: "investor", investor_class: "accredited" },
      { session_id: gamma.id, email: "julia@community.com", display_name: "Julia Santos (Community)",  role: "investor", investor_class: "community" },
      { session_id: gamma.id, email: "kyle@community.com",  display_name: "Kyle Brown (Community)",    role: "investor", investor_class: "community" },
    ];

    const allParticipants = [...alphaParticipants, ...betaParticipants, ...gammaParticipants];

    const { error: partErr } = await supabase
      .from("session_participants")
      .insert(allParticipants);

    if (partErr) {
      return new Response(
        JSON.stringify({ error: "Failed to create participants", details: partErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          sessions_created: 3,
          participants_created: allParticipants.length,
          sessions: [
            { name: alpha.name, status: "live",      id: alpha.id, slug: "demo-alpha" },
            { name: beta.name,  status: "completed", id: beta.id,  slug: "demo-beta" },
            { name: gamma.name, status: "completed", id: gamma.id, slug: "demo-gamma" },
          ],
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
