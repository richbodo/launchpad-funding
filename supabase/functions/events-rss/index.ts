import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Public RSS 2.0 feed of upcoming events.
 *
 * Feed readers cannot easily send custom headers, so we accept the project's
 * publishable apikey either via header (Supabase gateway default) or via a
 * `?apikey=...` query string. The publishable key is safe to expose — it's
 * the same one shipped in the front-end bundle.
 *
 * Each <item> links to the public /event/:slug landing page. The `siteOrigin`
 * is taken from the Origin/Referer header when present, otherwise falls back
 * to a `?site=` query parameter, otherwise to the request URL's origin.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Escape a string for safe inclusion in XML text/CDATA-free content. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Resolve the public web origin to use when building absolute event URLs. */
function resolveSiteOrigin(req: Request): string {
  const url = new URL(req.url);
  const siteParam = url.searchParams.get("site");
  if (siteParam) {
    try { return new URL(siteParam).origin; } catch { /* ignore */ }
  }
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin; } catch { /* ignore */ }
  }
  return url.origin;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("sessions")
      .select("id, name, slug, description, start_time, end_time, timezone, hero_image_url, updated_at")
      .not("slug", "is", null)
      .in("status", ["scheduled", "live"])
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(50);

    if (error) throw error;

    const siteOrigin = resolveSiteOrigin(req);
    const feedSelf = `${siteOrigin}/rss.xml`;
    const buildDate = new Date().toUTCString();

    const items = (data ?? []).map((s: any) => {
      const link = `${siteOrigin}/event/${encodeURIComponent(s.slug)}`;
      const pubDate = new Date(s.start_time).toUTCString();
      const desc = (s.description || "").toString();
      const tzLabel = s.timezone ? ` (${s.timezone})` : "";
      const when = `${new Date(s.start_time).toUTCString()}${tzLabel}`;
      const body = `<p><strong>When:</strong> ${xmlEscape(when)}</p>\n${xmlEscape(desc)}`;
      return `    <item>
      <title>${xmlEscape(s.name || "Upcoming event")}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${body}</description>
    </item>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Upcoming pitch sessions</title>
    <link>${xmlEscape(siteOrigin)}</link>
    <atom:link href="${xmlEscape(feedSelf)}" rel="self" type="application/rss+xml" />
    <description>Future startup pitch and community funding events.</description>
    <language>en</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
${items}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err: any) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<error>${xmlEscape(err?.message || "Failed")}</error>`,
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/xml" } },
    );
  }
});
