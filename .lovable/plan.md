# Issue #41 — Gifts / non-equity pledges

Split investors into two classes at login and let non-accredited supporters pledge a small "gift" amount instead of equity. Equity investors can do both.

## User-visible changes

- **Login (investor role)** — A new sub-choice appears once "Investor" is selected:
  - **Accredited Investor (Equity)** — can both invest for equity and pledge gifts.
  - **Community Supporter (Gift)** — can only pledge gifts, capped at **$100**.
- **Session page (during a presentation)**:
  - Accredited investors see two buttons: **Invest** (equity, no cap) and **Pledge** (gift, ≤ $100).
  - Community supporters see only **Pledge a Gift** (≤ $100).
- **InvestDialog** — Re-used for both flows; title, copy, and validation switch on the pledge type. Gift dialog enforces the $100 max and explains it's a non-binding best-effort gift from the startup.
- **Chat social-proof banner** (issue #40 sentinel) — Distinguishes "committed $X (equity)" vs "pledged $X (gift)" with slightly different wording; still emerald styling.
- **FundingMeter** — Continues to sum committed equity only (gifts shown as a small secondary line: "+ $X in community gifts"). Equity goal logic unchanged.

## Backend changes

1. **Migration** on `public.investments`:
   - Add `pledge_type text not null default 'equity'` with a check constraint `pledge_type in ('equity','gift')`.
   - Existing rows backfill to `'equity'` (the default).
2. **Migration** on `public.session_participants`:
   - Add `investor_class text` nullable with check `investor_class in ('accredited','community')`. Only meaningful when `role = 'investor'`.
3. RLS unchanged; existing GRANTs cover the new columns.
4. `participant-login` Edge Function: accept an optional `investor_class` and persist it on the participant row when role = investor. Return it in the login response.

## Frontend changes

- `src/lib/sessionContext.tsx` — Extend the `user` shape with `investorClass?: 'accredited' | 'community'`.
- `src/pages/Login.tsx` — When role is investor, render a radio for the two classes (default: accredited). Pass through to `participant-login`. Persist on the session user.
- `src/pages/Session.tsx` — Replace the single Invest button on each startup card with the role-appropriate buttons. Hide Invest for community.
- `src/components/InvestDialog.tsx` — Add `pledgeType: 'equity' | 'gift'` prop. Title, descriptions, the chat sentinel (`__COMMIT__::amt::startup::type`), and the max-amount validation switch on it.
- `src/components/ChatPanel.tsx` — Parse new sentinel form and render slightly different wording for gifts.
- `src/components/FundingMeter.tsx` — Sum gifts separately and show a secondary "+ $N in community gifts" line under the main amount; equity-only goal logic unchanged.

## Tests

- Unit: `InvestDialog` gift mode rejects amounts > 100 (form button disabled, friendly hint).
- Unit: `ChatPanel.parseCommitment` handles both `__COMMIT__::amt::name` and `__COMMIT__::amt::name::gift`.
- Unit: `FundingMeter` ignores gift-type investments in goal calculation.

## Out of scope (for this change)

- Startups defining gift tiers/descriptions in-app — issue explicitly defers this to out-of-band.
- Email template variants for gift confirmations (existing equity template will be reused with a small conditional). Can be a follow-up if needed.

## Files touched

- `supabase/migrations/<new>.sql`
- `supabase/functions/participant-login/index.ts`
- `src/lib/sessionContext.tsx`
- `src/pages/Login.tsx`
- `src/pages/Session.tsx`
- `src/components/InvestDialog.tsx`
- `src/components/ChatPanel.tsx`
- `src/components/FundingMeter.tsx`
- New tests under `src/components/__tests__/`
