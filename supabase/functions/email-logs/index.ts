import { createClient } from 'npm:@supabase/supabase-js@2'
import { authorizeFacilitator } from '../_shared/admin-token.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

/**
 * Returns transactional email delivery logs to the Admin UI.
 *
 * Requires a valid facilitator `admin_token`. Previously this endpoint was
 * open to anyone with the public anon key, exposing every recipient email
 * and internal send-provider errors across all sessions (security finding:
 * email_logs_open).
 */
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
  let messageIdFilter: string | null = null
  let recipientsFilter: string[] | null = null
  let templateFilter: string | null = null
  let adminToken: string | null = null
  try {
    const body = await req.json()
    adminToken = typeof body?.admin_token === 'string' ? body.admin_token : null
    if (body.limit) limit = Math.min(body.limit, 500)
    if (body.message_id) messageIdFilter = body.message_id
    if (Array.isArray(body.recipient_emails)) {
      recipientsFilter = body.recipient_emails
        .filter((e: unknown) => typeof e === 'string' && e.includes('@'))
        .map((e: string) => e.trim().toLowerCase())
    }
    if (typeof body.template_name === 'string') templateFilter = body.template_name
  } catch { /* use default */ }

  const auth = await authorizeFacilitator(adminToken, supabase, supabaseServiceKey)
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (recipientsFilter && recipientsFilter.length > 0) {
    let q = supabase
      .from('email_send_log')
      .select('recipient_email, status, error_message, created_at, template_name')
      .in('recipient_email', recipientsFilter)
      .order('created_at', { ascending: false })
      .limit(recipientsFilter.length * 20)
    if (templateFilter) q = q.eq('template_name', templateFilter)
    const { data, error } = await q
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const latest: Record<string, { status: string; error_message: string | null; created_at: string }> = {}
    for (const row of data ?? []) {
      const key = row.recipient_email.toLowerCase()
      if (!latest[key]) {
        latest[key] = {
          status: row.status,
          error_message: row.error_message,
          created_at: row.created_at,
        }
      }
    }
    return new Response(
      JSON.stringify({ latest_by_recipient: latest }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (messageIdFilter) {
    const { data, error } = await supabase
      .from('email_send_log')
      .select('id, message_id, template_name, recipient_email, status, error_message, metadata, created_at')
      .eq('message_id', messageIdFilter)
      .order('created_at', { ascending: true })

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ timeline: data ?? [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data, error } = await supabase
    .from('email_send_log')
    .select('id, message_id, template_name, recipient_email, status, error_message, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit * 2)

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const seen = new Set<string>()
  const deduped: typeof data = []
  for (const row of data ?? []) {
    const key = row.message_id || row.id
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }

  return new Response(
    JSON.stringify({ logs: deduped.slice(0, limit) }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
