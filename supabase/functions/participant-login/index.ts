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
    const { session_id, email, password } = await req.json();

    // Input validation
    if (!session_id || typeof session_id !== "string" || session_id.length > 100) {
      return new Response(
        JSON.stringify({ error: "Valid session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!email || typeof email !== "string" || email.length > 255) {
      return new Response(
        JSON.stringify({ error: "Valid email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!password || typeof password !== "string" || password.length > 255) {
      return new Response(
        JSON.stringify({ error: "Valid password is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the facilitator participant (only facilitators have passwords)
    const { data: participant, error: lookupErr } = await supabase
      .from("session_participants")
      .select("id, email, display_name, password_hash, role")
      .eq("session_id", session_id)
      .eq("email", email.toLowerCase().trim())
      .eq("role", "facilitator")
      .maybeSingle();

    if (lookupErr || !participant || !participant.password_hash) {
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify password using crypt() — works for both bcrypt hashes and (temporarily) plaintext
    // If password_hash is a bcrypt hash, crypt() will verify properly
    // If it's still plaintext (migration not yet run), fall back to direct comparison
    let passwordValid = false;

    if (participant.password_hash.startsWith("$2")) {
      // It's a bcrypt hash — verify with crypt()
      const { data: cryptResult } = await supabase.rpc("verify_participant_password", {
        _participant_id: participant.id,
        _password: password,
      });
      passwordValid = cryptResult === true;
    } else {
      // Legacy plaintext — direct comparison (will be removed after migration)
      passwordValid = participant.password_hash === password;
    }

    if (!passwordValid) {
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        participant: {
          id: participant.id,
          email: participant.email,
          display_name: participant.display_name,
          role: participant.role,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Login failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
