# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FundFlow** — a real-time startup funding/demo-day platform where facilitators run sessions, startups present, and investors submit soft investment commitments. Built as a single-page React app backed by Supabase.

Licensed under GPL. **Status**: Front-end demo complete; backend is Supabase (no custom API routes).

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite (port 8080), React Router v6
- **Styling**: Tailwind CSS 3, shadcn/ui (default style, slate base, CSS variables), Framer Motion for animations
- **State**: React Context (`SessionProvider`), component-level state
- **Backend**: Supabase (Postgres, Realtime subscriptions, Edge Functions, Storage)
- **Testing**: Vitest + jsdom + React Testing Library
- **Icons**: lucide-react

## Key Commands

```bash
npm run dev          # Start dev server (localhost:8080)
npm run build        # Production build
npm run test         # Run tests once (vitest run)
npm run test:watch   # Watch mode tests
npm run lint         # ESLint
```

Tests live in `src/**/*.{test,spec}.{ts,tsx}` and use jsdom environment with globals enabled. Setup file: `src/test/setup.ts`.

## Project Structure

```
src/
  pages/             # Route-level components (Index, Login, Session, Admin, DemoLogins, Unsubscribe, NotFound)
  components/        # Feature components (ChatPanel, DemoModeBanner, FundingMeter, HelpButton, InvestDialog, NavLink, SessionTimer, StageSelector, VideoPane)
  components/ui/     # shadcn/ui primitives (DO NOT manually edit — managed by shadcn CLI)
  hooks/             # Custom hooks (useDemoMode, useLiveKitToken, useSessionStages, use-mobile, use-toast)
  lib/               # sessionContext (auth context), utils (cn helper)
  integrations/
    supabase/        # Auto-generated Supabase client & types (client.ts, types.ts)
  test/              # Test setup
supabase/
  functions/         # Deno Edge Functions (archive-chat, email-logs, handle-email-suppression, handle-email-unsubscribe, livekit-token, mute-participant, participant-login, preview-transactional-email, process-email-queue, seed-demo-data, send-transactional-email)
  migrations/        # SQL migration files
```

## Architecture Notes

### Authentication
- No Supabase Auth — uses a custom session-based login via `session_participants` table
- Users log in with email + role selection; facilitators additionally need a password
- Session state stored in React Context (`SessionProvider`) — not persisted across page reloads
- `beforeunload` handler clears `is_logged_in` flag via sendBeacon/fetch keepalive

### Roles
- **facilitator**: Controls session flow (play/pause/next/prev stages), manages admin panel, password-protected
- **investor**: Views presentations, submits investment commitments
- **startup**: Presents in sessions, has presentation order

### Session Flow
- Sessions go through: `draft` → `scheduled` → `live` → `completed`
- The `useSessionStages` hook builds stages dynamically from startup list: Intro → (Presentation + Q&A per startup) → Outro
- Each stage has a countdown timer; facilitator controls playback
- During intro/outro, facilitators can "Take Stage" to mirror any participant's (facilitator or startup) video to the center pane (the stage). The `stageIdentity` originates in `Session.tsx` and is broadcast to all participants via Supabase Realtime; auto-clears when advancing to a presentation/Q&A stage.

### Real-time Features
- Stage sync: Facilitator broadcasts stage state (index, paused, remaining time, stage identity) to all participants via Supabase Realtime Broadcast + Presence. Late joiners read current state from Presence on first connection.
- Chat messages: Supabase Realtime postgres_changes on `chat_messages` table
- Investments: Supabase Realtime postgres_changes on `investments` table
- All subscribe per session ID

### Demo Mode
- Toggled via `app_settings` table (`key: 'mode'`, `value: 'demo'|'production'`)
- `seed-demo-data` Edge Function creates 3 demo sessions with test participants
- Demo credentials: `facilitator@demo.com` / `demo123`
- Demo sessions prefixed with `[DEMO]` for cleanup

## Database Tables

- `sessions` — funding sessions with status lifecycle
- `session_participants` — users per session (email, role, display_name, presentation_order, password_hash, dd_room_link, website_link, funding_goal, is_logged_in)
- `investments` — soft commitments (investor → startup, amount)
- `chat_messages` — real-time Q&A messages
- `session_logs` — audit trail (login, logout, investment events)
- `app_settings` — key-value config (demo mode flag)
- `email_send_log` — transactional email send history
- `email_send_state` — email queue state tracking
- `suppressed_emails` — suppressed/bounced email addresses
- `email_unsubscribe_tokens` — email unsubscribe token management

### Enums
- `participant_role`: facilitator, startup, investor
- `session_status`: draft, scheduled, live, completed

### Video Conferencing (LiveKit)
- All participants in a session join one LiveKit room (`session-{session_id}`)
- Tokens generated server-side by `livekit-token` Edge Function using `jose` JWT signing
- Token identity = user email, metadata contains `{ role }` for participant filtering
- `VideoPane` component renders a single participant's camera feed filtered by `participantIdentity` (email)
- Session.tsx wraps content in `<LiveKitRoom>` once token is fetched via `useLiveKitToken` hook
- Left pane: up to 3 facilitator VideoPanes stacked; Center pane: active startup VideoPane
- Graceful degradation: shows placeholder UI when LiveKit token unavailable

## Environment Variables

Required in `.env` or `.env.test` (Vite exposes via `import.meta.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Required as Supabase secrets (for `livekit-token` Edge Function):
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_WS_URL`

## Conventions

- Path alias: `@/` maps to `src/`
- TypeScript with relaxed settings: `noImplicitAny: false`, `strictNullChecks: false`
- shadcn/ui components live in `src/components/ui/` — add new ones via `npx shadcn-ui@latest add <component>`
- Supabase types in `src/integrations/supabase/types.ts` are auto-generated — regenerate with Supabase CLI, don't edit manually
- Toast notifications use `sonner` (via `toast()`) and Radix toast (via `useToast`)
- Edge Functions use Deno runtime with ESM imports from esm.sh

## Style & Config Notes

- ESLint disables `@typescript-eslint/no-unused-vars`
- Tailwind uses CSS variable theming with HSL colors and dark mode via class selector
- shadcn/ui components are configured via `components.json` with path aliases
