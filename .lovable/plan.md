## Goal
Show you exactly what the "Community Gift Pledge" email looks like when received by Tania (the supporter) and Adiraj (the startup) for the $50 pledge from this morning's session.

## What I'll do
1. Pull the real values from the database for that specific pledge:
   - Supporter: Tania Jones / tania@clearthinkingcoaching.co.nz
   - Startup: Adiraj Gupta / adirajgupta@gmail.com
   - Amount: $50
   - Session: NZ Tech Startups - Community Raise
   - Plus the current admin "welcome message" blurb (if configured)
2. Render the `commitment-gift-pledge` template (from `supabase/functions/_shared/transactional-email-templates/commitment-gift-pledge.tsx`) with that data, using the existing `preview-transactional-email` edge function pattern so the output matches what recipients would actually see.
3. Reply in chat with:
   - **Subject line** (exactly as it would appear in their inbox)
   - **From / To** (both Tania and Adiraj are on the same email — reply-all design)
   - **Rendered body** as readable text/markdown showing the heading, intro, the yellow detail box (Startup / Supporter / Gift Pledge), the "What this means" section, and the footer
   - A note about the auto-appended unsubscribe footer
4. No code changes, no actual send — preview only.

## Notes
- The template is the same for both recipients (single email, both addresses in To), so there's just one body to show.
- This pledge currently has status `draft` in `email_send_log` — meaning the email was **never actually sent**. I'll flag that at the end so you can decide whether to queue it for delivery after reviewing.
