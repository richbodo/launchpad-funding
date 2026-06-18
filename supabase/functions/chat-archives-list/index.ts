import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFacilitator } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Facilitator-only listing of the `chat-archives` storage bucket for a given
 * session. Returns short-lived signed URLs (1h) so the Admin UI can download
 * the JSON archive without granting public read on the bucket.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const body = await req.json();
    const auth = await authorizeFacilitator(body?.admin_token, supabase, serviceKey);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_id } = body;
    if (!session_id || typeof session_id !== "string") {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: files, error } = await supabase.storage
      .from("chat-archives")
      .list(session_id, { sortBy: { column: "created_at", order: "desc" } });

    if (error) throw error;

    const enriched = await Promise.all(
      (files || []).map(async (f) => {
        const { data } = await supabase.storage
          .from("chat-archives")
          .createSignedUrl(`${session_id}/${f.name}`, 3600);
        return { name: f.name, url: data?.signedUrl || "" };
      }),
    );

    return new Response(JSON.stringify({ files: enriched.filter((f) => f.url) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
