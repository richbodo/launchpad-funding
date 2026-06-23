# Email Setup

FundFlow sends transactional email for:

- Session invitations (with one-click login link + Google Calendar link)
- Investment / gift commitment confirmations to investors and startups
- Facilitator notifications when a startup is "waiting"
- Unsubscribe handling

All of this runs on **Lovable's built-in email infrastructure** — there's no
Resend, SendGrid, or Mailgun account to create. You do, however, need to
tell Lovable what domain emails should come from.

## Two paths

### Path A — Quickest: use Lovable's default sender

If you haven't configured an email domain, Lovable falls back to a default
sender. This is fine for evaluation and demos, but emails are more likely
to land in spam and the "From" address won't match your brand.

You don't have to do anything to use this path — emails just work after
remix.

### Path B — Recommended for real events: use your own domain

To send from `you@yourdomain.com`-style addresses, configure a sender
domain in Lovable. This takes ~5 minutes plus DNS propagation.

1. In your Lovable project, ask in chat: **"Set up email domain"** (or open
   **Cloud → Emails** and start the setup flow).
2. Enter a subdomain you control, for example `notify.yourdomain.com`.
   Lovable will delegate that subdomain to its own nameservers so it can
   manage SPF/DKIM/DMARC for you automatically.
3. Lovable shows you a small set of **NS records** to add at your DNS
   provider (the registrar where you bought your domain — e.g. Cloudflare,
   Namecheap, Google Domains, Route 53).
4. Add those NS records exactly as shown.
5. Wait for DNS to propagate. This usually takes a few minutes but can
   take up to 72 hours.
6. Once Lovable shows the domain as **Active** under Cloud → Emails, all
   future emails go out from your domain automatically — no code changes
   needed.

> If you already use the **root domain** (`yourdomain.com`) for email with
> another provider (Google Workspace, Microsoft 365, Fastmail, etc.) you
> can keep using it. Just pick a different subdomain like
> `notify.yourdomain.com` for Lovable — they won't conflict.

## Customizing email templates

The transactional email templates live in
`supabase/functions/_shared/transactional-email-templates/`. They're plain
React Email components — edit the copy, swap colors, add a logo, then ask
Lovable to redeploy the edge functions.

The facilitator's contact address and the per-role welcome blurbs used in
invitation emails are editable from the **Admin → Settings** tab.

## Troubleshooting

- **Emails enqueue but never send** — check **Cloud → Emails** for the
  domain status. If it shows `awaiting_dns`, DNS hasn't propagated yet.
- **Emails go to spam** — that's almost always a sign the domain status
  isn't yet `active`, or the recipient's provider hasn't seen enough mail
  from your domain to trust it yet.
- **Delivery timeline shows `bounced` / `complained`** — open **Admin →
  Email Logs**, click the row, and read the timeline. Bounced addresses
  are added to a suppression list automatically; you generally don't want
  to re-send to them.
