import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFacilitator } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data ?? { success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Admin mutation dispatcher.
 *
 * All session and session_participants writes flow through here so the
 * underlying RLS can stay locked down to service_role. The caller must
 * provide a valid admin_token issued by participant-login.
 *
 * Request body: { admin_token: string, action: string, payload?: object }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "Method not allowed");

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  const { admin_token, action, payload = {} } = body || {};
  const auth = await authorizeFacilitator(admin_token, supabase, serviceKey);
  if (!auth) return bad(401, "Unauthorized");

  try {
    switch (action) {
      // ── Sessions ───────────────────────────────────────────────────────────
      case "create_session": {
        const { name, start_time, end_time, timezone, status } = payload;
        if (!name || !start_time || !end_time || !timezone) return bad(400, "Missing required fields");
        const { data, error } = await supabase
          .from("sessions")
          .insert({ name, start_time, end_time, timezone, status: status || "scheduled" })
          .select()
          .single();
        if (error) throw error;
        return ok({ session: data });
      }
      case "update_session": {
        const { id, ...fields } = payload;
        if (!id) return bad(400, "id required");
        const allowed: Record<string, unknown> = {};
        for (const k of [
          "name", "start_time", "end_time", "timezone", "status",
          // Issue #44: landing-page fields
          "slug", "hero_image_url", "description", "max_attendees", "is_full",
        ]) {
          if (k in fields) allowed[k] = fields[k];
        }
        // Normalize slug to a URL-safe lower-case form.
        if (typeof allowed.slug === "string") {
          allowed.slug = (allowed.slug as string).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || null;
        }
        const { data, error } = await supabase.from("sessions").update(allowed).eq("id", id).select().single();
        if (error) throw error;
        return ok({ session: data });
      }

      case "delete_session": {
        const { id } = payload;
        if (!id) return bad(400, "id required");
        // Cascade related rows first (no FK cascades in this schema)
        await supabase.from("chat_messages").delete().eq("session_id", id);
        await supabase.from("investments").delete().eq("session_id", id);
        await supabase.from("session_logs").delete().eq("session_id", id);
        await supabase.from("session_participants").delete().eq("session_id", id);
        const { error } = await supabase.from("sessions").delete().eq("id", id);
        if (error) throw error;
        return ok({});
      }

      // ── Participants ───────────────────────────────────────────────────────
      case "add_participant": {
        const { session_id, email, role, display_name, password, presentation_order } = payload;
        if (!session_id || !email || !role) return bad(400, "session_id, email, role required");
        const insert: Record<string, unknown> = {
          session_id,
          email: String(email).toLowerCase().trim(),
          role,
          display_name: display_name || null,
          presentation_order: presentation_order ?? null,
        };
        const { data, error } = await supabase.from("session_participants").insert(insert).select().single();
        if (error) {
          if (error.code === "23505") return bad(409, "duplicate");
          throw error;
        }
        if (role === "facilitator" && password) {
          await supabase.rpc("set_participant_password", {
            _participant_id: data.id,
            _password: password,
          });
        }
        return ok({ participant: data });
      }
      case "update_participant": {
        const { id, ...fields } = payload;
        if (!id) return bad(400, "id required");
        const allowed: Record<string, unknown> = {};
        for (const k of [
          "display_name",
          "role",
          "presentation_order",
          "dd_room_link",
          "website_link",
          "funding_goal",
          "password_hash",
          "invite_sent_at",
          // Issue #44: landing-page signup workflow
          "approved",
          "image_url",
          "investor_class",
          // Per-role narrative metadata
          "description", // startups: short pitch summary (required for live sessions)
          "bio",         // facilitators: <=500 char bio
        ]) {

          if (k in fields) allowed[k] = fields[k];
        }
        if (typeof allowed.bio === "string" && (allowed.bio as string).length > 500) {
          return bad(400, "bio exceeds 500 characters");
        }
        const { data, error } = await supabase.from("session_participants").update(allowed).eq("id", id).select().single();
        if (error) throw error;
        return ok({ participant: data });
      }
      case "delete_participant": {
        const { id } = payload;
        if (!id) return bad(400, "id required");
        const { error } = await supabase.from("session_participants").delete().eq("id", id);
        if (error) throw error;
        return ok({});
      }
      case "bulk_update_participant_order": {
        const { updates } = payload as { updates: Array<{ id: string; presentation_order: number }> };
        if (!Array.isArray(updates)) return bad(400, "updates array required");
        for (const u of updates) {
          await supabase
            .from("session_participants")
            .update({ presentation_order: u.presentation_order })
            .eq("id", u.id);
        }
        return ok({});
      }

      // ── Demo data cleanup (used when toggling demo mode off) ───────────────
      case "cleanup_demo": {
        const { data: demos } = await supabase
          .from("sessions")
          .select("id")
          .like("name", "[DEMO]%");
        const ids = (demos || []).map((s: any) => s.id);
        if (ids.length > 0) {
          await supabase.from("chat_messages").delete().in("session_id", ids);
          await supabase.from("investments").delete().in("session_id", ids);
          await supabase.from("session_logs").delete().in("session_id", ids);
          await supabase.from("session_participants").delete().in("session_id", ids);
          await supabase.from("sessions").delete().in("id", ids);
        }
        return ok({ cleaned: ids.length });
      }

      // ── Investments ────────────────────────────────────────────────────────
      // Used by the Admin "Send all" / "Cancel all" commitment-email controls.
      // Flips email_status on rows owned by the given session. Allowed target
      // statuses: sent | cancelled | queued. RLS on investments blocks direct
      // updates from the browser, so this dispatch is the only write path.
      case "update_investment_email_status": {
        const { session_id, ids, status, from_statuses } = payload as {
          session_id?: string;
          ids?: string[];
          status: "sent" | "cancelled" | "queued";
          from_statuses?: string[];
        };
        if (!status || !["sent", "cancelled", "queued"].includes(status)) {
          return bad(400, "invalid status");
        }
        const timestampField =
          status === "sent" ? "email_sent_at" :
          status === "cancelled" ? "email_cancelled_at" :
          "email_queued_at";
        const update: Record<string, unknown> = {
          email_status: status,
          [timestampField]: new Date().toISOString(),
        };
        let q = supabase.from("investments").update(update);
        if (ids && ids.length > 0) {
          q = q.in("id", ids);
        } else if (session_id) {
          q = q.eq("session_id", session_id);
          if (from_statuses && from_statuses.length > 0) {
            q = q.in("email_status", from_statuses);
          }
        } else {
          return bad(400, "ids or session_id required");
        }
        const { error, data } = await q.select("id");
        if (error) throw error;
        return ok({ updated: data?.length ?? 0 });
      }

      default:
        return bad(400, `Unknown action: ${action}`);
    }
  } catch (err: any) {
    return bad(500, err?.message || "Action failed");
  }
});
