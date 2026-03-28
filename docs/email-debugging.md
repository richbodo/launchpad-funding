# Email Debugging Guide

## Architecture Overview

Outbound emails from FundFlow are sent via Lovable's built-in email infrastructure:

1. **Client** calls `send-transactional-email` Edge Function
2. Edge Function **enqueues** the email to a pgmq queue (`transactional_emails`)
3. A **cron dispatcher** (`process-email-queue`) runs every 5 seconds, dequeues messages, and sends them via the Lovable Email API
4. Delivery events (bounces, complaints) are reported back via the `handle-email-suppression` webhook

### Sender Domain

- **Sender subdomain**: `notify.pitch.globaldonut.com` (NS-delegated to Lovable nameservers)
- **From address**: `noreply@pitch.globaldonut.com` (display-from-root enabled)
- DNS authentication (SPF, DKIM, MX) is managed automatically by Lovable within the delegated zone

---

## Email Lifecycle & Statuses

Each email progresses through these statuses, logged as separate rows in `email_send_log` sharing the same `message_id`:

| Status | Meaning |
|--------|---------|
| `pending` | Enqueued locally in pgmq, waiting for dispatcher |
| `sent` | Accepted by the mail server (Mailgun via Lovable API) |
| `failed` | Send attempt failed (see `error_message` for details) |
| `rate_limited` | Hit provider rate limit; will auto-retry next cycle |
| `dlq` | Moved to dead-letter queue after 5 failed attempts |
| `bounced` | Mail server reported a bounce (hard or soft) |
| `complained` | Recipient marked email as spam |

### Interpreting Delivery Status

- **`sent` + no `bounced`/`complained` after 10+ minutes** → Likely delivered successfully
- **`sent` + `bounced`** → Email was rejected by recipient's mail server
- **`sent` + `complained`** → Recipient marked it as spam; address is now suppressed
- **`pending` with no follow-up** → Dispatcher may not be running (check cron job)

---

## Debugging Checklist

### 1. Email Never Left `pending`

- **Check cron job exists**:
  ```sql
  SELECT * FROM cron.job WHERE jobname = 'process-email-queue';
  ```
- **Check dispatcher logs**: In Lovable Cloud, view edge function logs for `process-email-queue`
- **Check `email_send_state`** for a `retry_after_until` timestamp in the future (rate-limit backoff):
  ```sql
  SELECT * FROM email_send_state WHERE id = 1;
  ```

### 2. Email Shows `failed`

- Check the `error_message` column in `email_send_log` for the specific error
- Check the `metadata` column — it contains the full API response from the mail server
- Common causes:
  - **"No email domain record found"**: `sender_domain` in the Edge Function doesn't match the verified subdomain
  - **Network/timeout errors**: Transient; the queue will auto-retry up to 5 times

### 3. Email Shows `sent` But Not Received

- Check recipient's **spam/junk folder**
- Check `suppressed_emails` table — the address may be suppressed from a prior bounce:
  ```sql
  SELECT * FROM suppressed_emails WHERE email = 'recipient@example.com';
  ```
- Verify DNS records are active: check domain status in Lovable Cloud → Emails
- Gmail-specific: search for `to:recipient@example.com` and also `from:noreply@pitch.globaldonut.com`

### 4. Email Shows `dlq` (Dead-Letter Queue)

- Email failed 5 consecutive times and was moved to the DLQ
- Check `error_message` on the `dlq` row for the final failure reason
- Check earlier `failed` rows with the same `message_id` for the progression of errors

### 5. Email Shows `rate_limited`

- The mail provider returned HTTP 429
- The dispatcher records the `Retry-After` duration in `email_send_state.retry_after_until`
- No action needed — emails will resume automatically after the backoff period

---

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `email_send_log` | Append-only audit trail of all email status changes |
| `email_send_state` | Single-row config: batch size, delay, TTL, rate-limit state |
| `suppressed_emails` | Addresses blocked from receiving (bounces, complaints, unsubscribes) |
| `email_unsubscribe_tokens` | One token per email address for one-click unsubscribe |

### Useful Queries

**View recent email activity:**
```sql
SELECT message_id, template_name, recipient_email, status, error_message, created_at
FROM email_send_log
ORDER BY created_at DESC
LIMIT 20;
```

**View full timeline for a specific email:**
```sql
SELECT status, error_message, metadata, created_at
FROM email_send_log
WHERE message_id = 'YOUR_MESSAGE_ID'
ORDER BY created_at ASC;
```

**Check suppressed addresses:**
```sql
SELECT email, reason, created_at FROM suppressed_emails ORDER BY created_at DESC;
```

**Check/tune dispatcher settings:**
```sql
SELECT batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes, retry_after_until
FROM email_send_state WHERE id = 1;
```

---

## Edge Functions Reference

| Function | Purpose |
|----------|---------|
| `send-transactional-email` | Entry point for all transactional sends; enqueues to pgmq |
| `process-email-queue` | Cron dispatcher; dequeues and sends via mail API |
| `handle-email-suppression` | Webhook for bounce/complaint events |
| `handle-email-unsubscribe` | JSON API for unsubscribe token validation |
| `email-logs` | Admin API for viewing logs (summary + per-message timeline) |

---

## Admin UI

The **Email Logs** tab in the admin panel (`/admin` → Email Logs tab) provides:

- **Summary view**: Deduplicated list of recent emails with status badges
- **Timeline view**: Click any row to see the full delivery timeline with contextual status labels
- Status context labels interpret delivery state (e.g., "Accepted by mail server — no bounce detected, likely delivered")

---

## Throughput Tuning

Default: ~120 emails/min. Adjust without redeploying:

```sql
-- Increase to ~600 emails/min
UPDATE email_send_state SET batch_size = 50, send_delay_ms = 50 WHERE id = 1;

-- Extend transactional TTL to 2 hours
UPDATE email_send_state SET transactional_email_ttl_minutes = 120 WHERE id = 1;
```
