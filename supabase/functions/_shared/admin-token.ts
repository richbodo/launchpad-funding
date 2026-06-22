/**
 * Admin token: short-lived HMAC-signed credential proving the bearer
 * authenticated as a facilitator via `participant-login`.
 *
 * Format: `base64url(payload).base64url(hmac-sha256(payload))`
 * Payload: { email, exp } (exp = unix seconds)
 * Secret: SUPABASE_SERVICE_ROLE_KEY (server-only)
 *
 * Why we don't use Supabase Auth here: this app uses a custom
 * session-based login (no auth.users), so we mint our own bearer.
 */

const ADMIN_TOKEN_TTL_SECONDS = 12 * 3600; // 12 hours

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signAdminToken(email: string, secret: string): Promise<string> {
  const payload = { email: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, "sign");
  const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)));
  return `${payloadB64}.${toBase64Url(sigBytes)}`;
}

export interface AdminTokenPayload {
  email: string;
  exp: number;
}

export async function verifyAdminToken(token: string | null | undefined, secret: string): Promise<AdminTokenPayload | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await importHmacKey(secret, "verify");
    const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(sigB64), new TextEncoder().encode(payloadB64));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as AdminTokenPayload;
    if (!payload?.email || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify the admin token AND confirm the email is still a registered facilitator.
 * Returns null if either check fails. Callers should respond 401 on null.
 *
 * NOTE: there is intentionally NO demo-mode bypass. Even when
 * `app_settings.mode === 'demo'`, all admin mutations must present a valid
 * admin_token minted by `participant-login`. Demo facilitators have real
 * (well-known) passwords seeded by `seed-demo-data`, and the /demo-logins
 * page exposes that password so the demo auto-login flow can perform a real
 * login handshake.
 */
export async function authorizeFacilitator(
  token: string | null | undefined,
  supabase: { from: (t: string) => any },
  secret: string,
): Promise<AdminTokenPayload | null> {
  const payload = await verifyAdminToken(token, secret);
  if (!payload) return null;
  const { data, error } = await supabase
    .from("session_participants")
    .select("id")
    .eq("email", payload.email)
    .eq("role", "facilitator")
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return payload;
}

