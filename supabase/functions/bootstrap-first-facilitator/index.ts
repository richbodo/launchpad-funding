import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signAdminToken } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * First-run facilitator bootstrap.
 *
 * Used by the Admin page on a freshly remixed app where the
 * `session_participants` table has no facilitator rows yet. Without this
 * endpoint a new owner would be locked out of /admin and forced to use
 * demo mode or hand-craft a row in the database.
 *
 * Actions (POST body):
 *   { action: "check" }
 *     → { needs_bootstrap: boolean }
 *   { action: "create", email, password, display_name? }
 *     → { success: true, admin_token, session_id }
 *
 * Authorization model: this endpoint is only callable when the database
 * has ZERO facilitator rows. Once a single facilitator exists, every
 * `create` call returns 409 — so a stale page or a malicious caller can
 * never escalate by re-running bootstrap. The check is re-evaluated
 * server-side inside `create`, not relied upon from the client.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body?.action || "check";

  // Single source of truth for "is bootstrap available". Counts facilitator
  // rows across ALL sessions — demo seeds count too, because if a demo
  // facilitator exists the operator can already log in.
  const needsBootstrap = await computeNeedsBootstrap(supabase);

  if (action === "check") {
    return json({ needs_bootstrap: needsBootstrap });
  }

  if (action !== "create") {
    return json({ error: "Unknown action" }, 400);
  }

  if (!needsBootstrap) {
    return json(
      { error: "Bootstrap already complete — a facilitator already exists. Sign in normally." },
      409,
    );
  }

  const email = String(body?.email || "").toLowerCase().trim();
  const password = String(body?.password || "");
  const displayName = (body?.display_name ? String(body.display_name) : "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    return json({ error: "Valid email is required" }, 400);
  }
  if (password.length < 8 || password.length > 255) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Bootstrap creates a placeholder session so the facilitator row has a
  // valid session_id FK. The facilitator can rename/reschedule/delete it
  // immediately from the Admin UI once logged in.
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const { data: sessionRow, error: sessionErr } = await supabase
    .from("sessions")
    .insert({
      name: "My First Session",
      start_time: now.toISOString(),
      end_time: end.toISOString(),
      timezone: "UTC",
      status: "draft",
    })
    .select("id")
    .single();

  if (sessionErr || !sessionRow) {
    return json({ error: "Failed to create initial session" }, 500);
  }

  const { data: participantRow, error: insertErr } = await supabase
    .from("session_participants")
    .insert({
      session_id: sessionRow.id,
      email,
      role: "facilitator",
      display_name: displayName,
    })
    .select("id")
    .single();

  if (insertErr || !participantRow) {
    // Roll back the placeholder session so a retry can start clean.
    await supabase.from("sessions").delete().eq("id", sessionRow.id);
    return json({ error: "Failed to create facilitator account" }, 500);
  }

  // Store bcrypt'd password in the private credentials table.
  const { error: credErr } = await supabase.rpc("set_participant_password", {
    _participant_id: participantRow.id,
    _password: password,
  });
  if (credErr) {
    await supabase.from("session_participants").delete().eq("id", participantRow.id);
    await supabase.from("sessions").delete().eq("id", sessionRow.id);
    return json({ error: "Failed to create facilitator account" }, 500);
  }

  const adminToken = await signAdminToken(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  return json({ success: true, admin_token: adminToken, session_id: sessionRow.id });
});

async function computeNeedsBootstrap(supabase: any): Promise<boolean> {
  const { count, error } = await supabase
    .from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("role", "facilitator");
  if (error) return false; // fail closed — don't expose bootstrap on errors
  return (count ?? 0) === 0;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
