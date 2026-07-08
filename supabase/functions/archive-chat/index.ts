import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFacilitator } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Archives (and clears) a session's chat history.
 *
 * Requires a valid facilitator `admin_token`. Previously this endpoint was
 * callable by anyone with the public anon key, letting arbitrary visitors
 * permanently delete any session's chat_messages (security finding:
 * archive_chat_open).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { session_id, admin_token } = body || {};
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const auth = await authorizeFacilitator(admin_token, supabase, serviceKey);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all chat messages for this session
    const { data: messages, error: fetchError } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (fetchError) throw fetchError;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ message: "No chat messages to archive" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await supabase
      .from("sessions")
      .select("name")
      .eq("id", session_id)
      .single();

    const sessionName = session?.name?.replace(/[^a-zA-Z0-9-_]/g, "_") || "session";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${sessionName}_${timestamp}.json`;
    const filePath = `${session_id}/${fileName}`;

    const archiveData = {
      session_id,
      session_name: session?.name,
      archived_at: new Date().toISOString(),
      message_count: messages.length,
      messages: messages.map((m) => ({
        sender: m.sender_name || m.sender_email,
        role: m.sender_role,
        message: m.message,
        timestamp: m.created_at,
      })),
    };

    const { error: uploadError } = await supabase.storage
      .from("chat-archives")
      .upload(filePath, JSON.stringify(archiveData, null, 2), {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { error: deleteError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("session_id", session_id);

    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({
        message: "Chat archived and cleared",
        file: filePath,
        count: messages.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
