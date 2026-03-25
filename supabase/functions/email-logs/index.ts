import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let limit = 100
  try {
    const body = await req.json()
    if (body.limit) limit = Math.min(body.limit, 500)
  } catch { /* use default */ }

  // Fetch all recent logs, then deduplicate client-side by message_id
  // keeping only the latest row per message_id
  const { data, error } = await supabase
    .from('email_send_log')
    .select('id, message_id, template_name, recipient_email, status, error_message, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit * 2) // fetch extra to account for duplicates

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Deduplicate: keep only the latest row per message_id
  const seen = new Set<string>()
  const deduped: typeof data = []
  for (const row of data ?? []) {
    const key = row.message_id || row.id // fallback to id if no message_id
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }

  return new Response(
    JSON.stringify({ logs: deduped.slice(0, limit) }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
