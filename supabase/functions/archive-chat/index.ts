import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Get session name for the filename
    const { data: session } = await supabase
      .from("sessions")
      .select("name")
      .eq("id", session_id)
      .single();

    const sessionName = session?.name?.replace(/[^a-zA-Z0-9-_]/g, "_") || "session";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${sessionName}_${timestamp}.json`;
    const filePath = `${session_id}/${fileName}`;

    // Format as readable JSON
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

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("chat-archives")
      .upload(filePath, JSON.stringify(archiveData, null, 2), {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Delete chat messages from DB
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
