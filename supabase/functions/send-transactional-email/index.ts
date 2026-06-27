import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'

// Configuration baked in at scaffold time — do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "FundFlow"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.pitch.globaldonut.com"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// When display_from_root is enabled, this can be the root domain for cleaner branding,
// even though actual sending uses the subdomain above.
const FROM_DOMAIN = "pitch.globaldonut.com"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth note: this function uses verify_jwt = true in config.toml, so Supabase's
// gateway validates the caller's JWT (anon or service_role) before the request
// reaches this code. No in-function auth check is needed.

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  // Optional extra recipients added to the To: line (e.g. cc the startup on
  // the investor's confirmation). Suppression is checked against each address;
  // if any are suppressed, those are dropped from the To: line.
  let additionalRecipients: string[] = []
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
    const extras = body.additionalRecipients || body.additional_recipients
    if (Array.isArray(extras)) {
      additionalRecipients = extras
        .filter((e: unknown) => typeof e === 'string' && e.includes('@'))
        .map((e: string) => e.trim())
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Build the deduplicated list of recipients to send to. The Lovable Email
  // API expects a single string in `to` and rejects both comma-joined strings
  // and arrays as "Invalid 'to' email address". To support `additionalRecipients`
  // we enqueue ONE message per recipient — each with its own message_id,
  // suppression check, and unsubscribe token. This also short-circuits invalid
  // addresses up front so the queue worker never burns 5 retries on them.
  const allRecipientsRaw = [effectiveRecipient, ...additionalRecipients]
  const seen = new Set<string>()
  const recipients: string[] = []
  for (const r of allRecipientsRaw) {
    if (typeof r !== 'string') continue
    const trimmed = r.trim()
    if (!trimmed || !trimmed.includes('@') || trimmed.length < 3) continue
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    recipients.push(trimmed)
  }

  if (recipients.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No valid recipient email addresses provided' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Render template once — the same HTML/text goes to every recipient.
  const html = await renderAsync(
    React.createElement(template.component, templateData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  type Outcome = { recipient: string; status: 'queued' | 'suppressed' | 'failed'; reason?: string }
  const outcomes: Outcome[] = []

  for (const recipient of recipients) {
    const normalizedEmail = recipient.toLowerCase()
    // Each recipient gets its own message_id so logs and idempotency stay
    // 1:1 with actual sends. Derive a per-recipient idempotency key when more
    // than one recipient, so retries are still deduped per (caller, recipient).
    const perMessageId = crypto.randomUUID()
    const perIdempotencyKey =
      recipients.length === 1 ? idempotencyKey : `${idempotencyKey}:${normalizedEmail}`

    // 1. Suppression check (fail-closed: skip on error)
    const { data: suppressed, error: suppressionError } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (suppressionError) {
      console.error('Suppression check failed — skipping recipient', {
        error: suppressionError, recipient,
      })
      outcomes.push({ recipient, status: 'failed', reason: 'suppression_check_failed' })
      continue
    }

    if (suppressed) {
      await supabase.from('email_send_log').insert({
        message_id: perMessageId,
        template_name: templateName,
        recipient_email: recipient,
        status: 'suppressed',
      })
      outcomes.push({ recipient, status: 'suppressed' })
      continue
    }

    // 2. Get-or-create unsubscribe token for this recipient
    let unsubscribeToken: string | null = null
    const { data: existingToken, error: tokenLookupError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token, used_at')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (tokenLookupError) {
      console.error('Token lookup failed', { error: tokenLookupError, recipient })
      await supabase.from('email_send_log').insert({
        message_id: perMessageId,
        template_name: templateName,
        recipient_email: recipient,
        status: 'failed',
        error_message: 'Failed to look up unsubscribe token',
      })
      outcomes.push({ recipient, status: 'failed', reason: 'token_lookup_failed' })
      continue
    }

    if (existingToken && existingToken.used_at) {
      // Already unsubscribed but not in suppression list — treat as suppressed.
      await supabase.from('email_send_log').insert({
        message_id: perMessageId,
        template_name: templateName,
        recipient_email: recipient,
        status: 'suppressed',
        error_message: 'Unsubscribe token used but email missing from suppressed list',
      })
      outcomes.push({ recipient, status: 'suppressed' })
      continue
    }

    if (existingToken) {
      unsubscribeToken = existingToken.token
    } else {
      const newToken = generateToken()
      const { error: tokenError } = await supabase
        .from('email_unsubscribe_tokens')
        .upsert(
          { token: newToken, email: normalizedEmail },
          { onConflict: 'email', ignoreDuplicates: true }
        )
      if (tokenError) {
        console.error('Failed to create unsubscribe token', { error: tokenError, recipient })
        await supabase.from('email_send_log').insert({
          message_id: perMessageId,
          template_name: templateName,
          recipient_email: recipient,
          status: 'failed',
          error_message: 'Failed to create unsubscribe token',
        })
        outcomes.push({ recipient, status: 'failed', reason: 'token_create_failed' })
        continue
      }
      const { data: storedToken } = await supabase
        .from('email_unsubscribe_tokens')
        .select('token')
        .eq('email', normalizedEmail)
        .maybeSingle()
      if (!storedToken) {
        await supabase.from('email_send_log').insert({
          message_id: perMessageId,
          template_name: templateName,
          recipient_email: recipient,
          status: 'failed',
          error_message: 'Failed to confirm unsubscribe token storage',
        })
        outcomes.push({ recipient, status: 'failed', reason: 'token_read_failed' })
        continue
      }
      unsubscribeToken = storedToken.token
    }

    // 3. Log pending BEFORE enqueue so we have a record even if enqueue crashes
    await supabase.from('email_send_log').insert({
      message_id: perMessageId,
      template_name: templateName,
      recipient_email: recipient,
      status: 'pending',
    })

    // 4. Enqueue — `to` is always a single string, never an array.
    const { error: enqueueError } = await supabase.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: perMessageId,
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: resolvedSubject,
        html,
        text: plainText,
        purpose: 'transactional',
        label: templateName,
        idempotency_key: perIdempotencyKey,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      console.error('Failed to enqueue email', { error: enqueueError, templateName, recipient })
      await supabase.from('email_send_log').insert({
        message_id: perMessageId,
        template_name: templateName,
        recipient_email: recipient,
        status: 'failed',
        error_message: 'Failed to enqueue email',
      })
      outcomes.push({ recipient, status: 'failed', reason: 'enqueue_failed' })
      continue
    }

    outcomes.push({ recipient, status: 'queued' })
  }

  const queuedCount = outcomes.filter(o => o.status === 'queued').length
  console.log('Transactional email batch enqueued', {
    templateName,
    total: outcomes.length,
    queued: queuedCount,
    suppressed: outcomes.filter(o => o.status === 'suppressed').length,
    failed: outcomes.filter(o => o.status === 'failed').length,
  })

  return new Response(
    JSON.stringify({
      success: queuedCount > 0,
      queued: queuedCount > 0,
      outcomes,
    }),
    {
      status: queuedCount > 0 ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})

