/**
 * Issue #44: Upload an image to the public `event-images` bucket.
 *
 * Admin-only. Authorized via the same admin_token used by admin-action
 * (HMAC, verified by authorizeFacilitator). Service role performs the
 * upload so we don't need permissive anon write policies on the bucket.
 *
 * Request: { admin_token, file_base64, content_type, kind, ref_id, filename? }
 *   kind = 'session-hero' | 'participant'
 *   ref_id = session.id or participant.id (used in storage path)
 *
 * Response: { url: string }   // public URL ready to store on the row.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authorizeFacilitator } from "../_shared/admin-token.ts";
import { resolveParticipantToken } from "../_shared/participant-token.ts";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function safeFilename(name: string | undefined, contentType: string): string {
  const extFromType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extFromType[contentType] || "bin";
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const base = (name || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${stamp}-${rand}-${base}.${ext}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  // Authorize: either facilitator admin_token, OR participant self-upload
  // (participant token whose id matches ref_id, uploading their own image).
  // Previously the self-upload path trusted a client-supplied participant_id
  // alone, which allowed any visitor to overwrite another participant's
  // image by guessing their id (security finding: self_update_idor).
  let authorized = false;
  if (body?.admin_token) {
    const auth = await authorizeFacilitator(body.admin_token, supabase, serviceKey);
    if (auth) authorized = true;
  }
  if (!authorized && body?.participant_token) {
    const who = await resolveParticipantToken(supabase, body.participant_token);
    if (
      who &&
      body.kind === 'participant' &&
      who.participant_id === body.ref_id &&
      (who.role === 'startup' || who.role === 'facilitator')
    ) {
      authorized = true;
    }
  }
  if (!authorized) return jsonResponse({ error: "Unauthorized" }, 401);

  const { file_base64, content_type, kind, ref_id, filename } = body || {};
  if (!file_base64 || !content_type || !kind || !ref_id) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }
  if (!ALLOWED_TYPES.has(content_type)) {
    return jsonResponse({ error: "Unsupported image type" }, 400);
  }
  if (!["session-hero", "participant"].includes(kind)) {
    return jsonResponse({ error: "Invalid kind" }, 400);
  }
  if (!/^[a-f0-9-]{6,64}$/i.test(String(ref_id))) {
    return jsonResponse({ error: "Invalid ref_id" }, 400);
  }

  let bytes: Uint8Array;
  try { bytes = decodeBase64(file_base64); }
  catch { return jsonResponse({ error: "Invalid base64" }, 400); }
  if (bytes.byteLength === 0) return jsonResponse({ error: "Empty file" }, 400);
  if (bytes.byteLength > MAX_BYTES) return jsonResponse({ error: "File too large (max 5MB)" }, 413);

  const path = `${kind}/${ref_id}/${safeFilename(filename, content_type)}`;
  const { error: upErr } = await supabase.storage
    .from("event-images")
    .upload(path, bytes, { contentType: content_type, upsert: false });
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  const { data: pub } = supabase.storage.from("event-images").getPublicUrl(path);
  return jsonResponse({ url: pub.publicUrl, path });
});
